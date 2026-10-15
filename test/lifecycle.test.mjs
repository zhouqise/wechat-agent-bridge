import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {paths,privateDir,writeJSON,readJSON,acquireLock,releaseLock} from '../paths.mjs';
import {serve,control} from '../service.mjs';

async function fixture(t) {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'wxc-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  return paths({WX_CODEX_HOME:dir});
}
test('平台默认数据位置与显式覆盖',()=>{
  assert.equal(paths({},'darwin','/u').dir,'/u/Library/Application Support/wx-codex');
  assert.equal(paths({},'linux','/u').dir,'/u/.local/share/wx-codex');
  assert.equal(paths({XDG_DATA_HOME:'/data'},'linux','/u').dir,'/data/wx-codex');
  assert.equal(paths({WX_CODEX_HOME:'/primary',BRIDGE_STATE_DIR:'/old'}).dir,'/primary');
});
test('凭据使用私有目录和文件权限，损坏内容不回显',async t=>{
  const p=await fixture(t);await privateDir(p.dir);await writeJSON(p.session,{token:'test-only'});
  assert.equal((await fs.stat(p.dir)).mode & 0o777,0o700);
  assert.equal((await fs.stat(p.session)).mode & 0o777,0o600);
  assert.equal((await readJSON(p.session)).token,'test-only');
  await fs.writeFile(p.session,'secret-invalid-json');
  await assert.rejects(readJSON(p.session),e=>!e.message.includes('secret-invalid-json'));
});
test('并发抢锁仅一个成功，不删除其他实例的锁',async t=>{
  const p=await fixture(t);
  const results=await Promise.allSettled(Array.from({length:12},()=>acquireLock(p)));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(Number(await fs.readFile(p.lock,'utf8')),process.pid);
  await releaseLock(p);await acquireLock(p);await releaseLock(p);
});
test('损坏的锁拒绝覆盖',async t=>{
  const p=await fixture(t);await fs.writeFile(p.lock,'invalid');
  await assert.rejects(acquireLock(p),/损坏/);
  assert.equal(await fs.readFile(p.lock,'utf8'),'invalid');
});
test('管理接口返回状态、拒绝未知命令并执行停止回调',async t=>{
  const p=await fixture(t);let stopped;
  const done=new Promise(resolve=>stopped=resolve);
  const server=await serve(p,()=>({pid:123,task:'空闲'}),stopped);
  t.after(()=>server.close());
  assert.equal((await fs.stat(p.socket)).mode&0o777,0o600);
  assert.deepEqual(await control(p),{service:'wx-codex',pid:123,task:'空闲'});
  assert.equal((await control(p,'unrecognized')).error,'unknown command');
  assert.equal((await control(p,'stop')).stopping,true);
  await done;
});
