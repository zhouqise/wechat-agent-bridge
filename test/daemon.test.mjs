import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {alive,paths} from '../paths.mjs';
const exec=promisify(execFile);
const cli=fileURLToPath(new URL('../wx-codex.mjs',import.meta.url));
test('真实后台进程：异目录启动、状态、重复启动、重启、停止，禁止外网', {timeout:60000},async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'wxd-'));
  const mock=path.join(dir,'codex fixture.mjs'),preload=path.join(dir,'offline.mjs');
  await fs.writeFile(mock,`import {createInterface} from 'node:readline';
import fs from 'node:fs';
fs.writeFileSync(process.env.WX_TEST_PID,String(process.pid));
createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(m.id!==undefined)process.stdout.write(JSON.stringify({id:m.id,result:{}})+'\\n');});`);
  await fs.writeFile(preload,`globalThis.fetch=async()=>{await new Promise(r=>setTimeout(r,100));return new Response(JSON.stringify({ret:0,msgs:[],get_updates_buf:'test'}),{headers:{'content-type':'application/json'}});};`);
  const env={...process.env,WX_CODEX_HOME:dir,CODEX_BINARY:mock,WX_TEST_PID:path.join(dir,'child.pid'),NODE_OPTIONS:'--import='+pathToFileURL(preload).href};
  const run=async(...args)=>(await exec(process.execPath,[cli,...args],{cwd:os.tmpdir(),env,timeout:20000,windowsHide:true})).stdout;
  let childPid;
  try {
    await fs.writeFile(path.join(dir,'config.json'),JSON.stringify({workspace:path.join(dir,'workspace')}));
    await fs.writeFile(path.join(dir,'session.json'),JSON.stringify({token:'test-only',owner:'test-user',seen:[],base:'https://ilinkai.weixin.qq.com'}));
    await run('start');
    const first=JSON.parse(await run('status','--json'));assert.equal(first.codexConnected,true);
    childPid=Number(await fs.readFile(env.WX_TEST_PID,'utf8'));
    assert.match(await run('start'),/已经运行/);
    assert.equal(JSON.parse(await run('status','--json')).pid,first.pid);
    await run('restart');
    assert.notEqual(JSON.parse(await run('status','--json')).pid,first.pid);
    assert.equal(alive(childPid),false);
    childPid=Number(await fs.readFile(env.WX_TEST_PID,'utf8'));
    await run('stop');
    assert.equal(JSON.parse(await run('status','--json')).status,'stopped');
    for(let n=0;n<20 && alive(childPid);n++)await new Promise(r=>setTimeout(r,100));
    assert.equal(alive(childPid),false);
    assert.equal(await fs.stat(paths(env).controlToken).then(()=>true,()=>false),false);
  }finally{
    await run('stop').catch(()=>{});
    await fs.rm(dir,{recursive:true,force:true});
  }
});
