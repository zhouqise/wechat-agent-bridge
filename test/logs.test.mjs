import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {readLogs,clearLogs} from '../logs.mjs';
test('日志读尾、更新时间、清除后原 append 描述符继续写入',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'wxlogs-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const p={log:path.join(dir,'service.log')};
 assert.equal((await readLogs(p)).updatedAt,null);await fs.writeFile(p.log,'旧'.repeat(6000)+'\n最新记录\nBearer SECRET\n');await fs.writeFile(p.log+'.1','轮转');
 const tail=await readLogs(p);assert.equal(tail.truncated,true);assert.match(tail.text,/最新记录/);assert.ok(!tail.text.includes('SECRET'));assert.ok(tail.updatedAt);
 const writer=await fs.open(p.log,'a');try{assert.equal((await clearLogs(p)).cleared,2);await writer.write('清除后日志\n');assert.equal((await readLogs(p)).text,'清除后日志\n');}finally{await writer.close();}
 await fs.rm(p.log);await fs.symlink(p.log+'.1',p.log);await assert.rejects(clearLogs(p),/普通文件/);await assert.rejects(readLogs(p),/普通文件/);
});
test('清理期间轮转不能报告全部成功',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'wxrotate-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const p={log:path.join(dir,'service.log')};await fs.writeFile(p.log,'old');await fs.writeFile(p.log+'.1','older');
 await assert.rejects(clearLogs(p,{afterTruncate:async name=>{if(name===p.log+'.1'){await fs.rm(p.log+'.1');await fs.rename(p.log,p.log+'.1');await fs.writeFile(p.log,'new');}}}),/轮转/);
});
