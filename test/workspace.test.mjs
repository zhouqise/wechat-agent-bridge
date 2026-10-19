import net from 'node:net';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {prepareWorkspace,absoluteWorkspacePath} from '../projects.mjs';
import {workspace} from '../workspace.mjs';
import {paths,writeJSON,readJSON,acquireLock,releaseLock} from '../paths.mjs';
const fixture=async t=>{const dir=await fs.mkdtemp(path.join(os.tmpdir(),'wxdir-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return dir;};
test('完整目录校验、已登记目录复用、同目录与项目冲突',async t=>{
 const dir=await fixture(t),other=path.join(dir,'中文 space');await fs.mkdir(other);const real=await fs.realpath(other),config={workspace:dir};
 const result=await prepareWorkspace(config,dir,other);assert.equal(result.cwd,real);assert.equal(result.config.workspace,dir);assert.equal(result.config.projects[result.project],real);assert.equal(config.projects,undefined);
 assert.equal((await prepareWorkspace(result.config,dir,other)).project,result.project);
 assert.equal((await prepareWorkspace({workspace:dir,projects:{known:other}},dir,other)).project,'known');
 await assert.rejects(prepareWorkspace(config,dir,path.join(dir,'missing')));await fs.writeFile(path.join(dir,'file'),'x');await assert.rejects(prepareWorkspace(config,dir,path.join(dir,'file')));
 for(const v of ['', '../relative', 'x\nfoo','a'.repeat(1025)])await assert.rejects(prepareWorkspace(config,dir,v));
 assert.equal(absoluteWorkspacePath('C:\\Work Folder','win32'),'C:\\Work Folder');
 for(const v of ['C:foo','\\foo','relative'])assert.throws(()=>absoluteWorkspacePath(v,'win32'));
 const key='dir-'+createHash('sha256').update(real).digest('hex').slice(0,20);await assert.rejects(prepareWorkspace({workspace:dir,projects:{[key]:dir}},dir,other),/冲突/);
 const link=path.join(dir,'link');await fs.symlink(other,link,process.platform==='win32'?'junction':'dir');assert.equal((await prepareWorkspace(result.config,dir,link)).project,result.project);
});
test('停止状态保存，下次启动生效；锁占用拒绝且不同用户不串配置',async t=>{
 const base=await fixture(t),p=paths({WX_CODEX_HOME:base}),other=path.join(base,'target');await fs.mkdir(other);await writeJSON(p.config,{workspace:base,engine:'codex'});
 const r=await workspace(p,other);assert.equal(r.applied,'next-start');assert.equal(r.conversation,null);assert.equal((await workspace(p)).workspace,await fs.realpath(other));
 const before=await fs.readFile(p.config,'utf8');await acquireLock(p);try{await assert.rejects(workspace(p,base));}finally{await releaseLock(p);}assert.equal(await fs.readFile(p.config,'utf8'),before);
 const second=paths({WX_CODEX_HOME:base,WX_AGENT_USER:'second'});await fs.mkdir(second.dir,{recursive:true});await writeJSON(second.config,{workspace:base});await workspace(second,other);assert.equal(await fs.readFile(p.config,'utf8'),before);assert.equal((await readJSON(second.config)).currentProject,r.project);
});

test('状态请求结果不确定时不得回退离线保存，即使没有存活 PID',async t=>{
 const base=await fixture(t),p=paths({WX_CODEX_HOME:base});await writeJSON(p.config,{workspace:base});const before=await fs.readFile(p.config,'utf8');
 const server=net.createServer(socket=>{socket.on('error',()=>{});socket.on('data',()=>socket.end('invalid JSON\n'));});await new Promise(r=>server.listen(p.socket,r));t.after(()=>new Promise(r=>server.close(r)));
 await assert.rejects(workspace(p,base),/状态未确认/);assert.equal(await fs.readFile(p.config,'utf8'),before);
});
test('CLI 查询、含空格目录切换、参数校验与指定用户',async t=>{
 const {promisify}=await import('node:util'),{execFile}=await import('node:child_process'),{fileURLToPath}=await import('node:url');const exec=promisify(execFile),base=await fixture(t),p=paths({WX_CODEX_HOME:base}),target=path.join(base,'中文 CLI space');await fs.mkdir(target);await writeJSON(p.config,{workspace:base});
 const env={...process.env,WX_CODEX_HOME:base};delete env.WX_AGENT_USER;const run=(...args)=>exec(process.execPath,[fileURLToPath(new URL('../wx-agent.mjs',import.meta.url)),...args],{env,windowsHide:true});
 assert.match((await run('workspace',target)).stdout,/下次启动/);assert.ok((await run('user','list')).stdout.includes(await fs.realpath(target)));assert.ok((await run('workspace')).stdout.includes(await fs.realpath(target)));await assert.rejects(run('workspace',target,'extra'));
 const other=paths({WX_CODEX_HOME:base,WX_AGENT_USER:'other'});await fs.mkdir(other.dir,{recursive:true});await writeJSON(other.config,{workspace:base});await run('--user','other','workspace',target);assert.equal((await readJSON(other.config)).currentProject,(await readJSON(p.config)).currentProject);
});
