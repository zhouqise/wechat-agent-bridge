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
const cli=fileURLToPath(new URL('../wx-agent.mjs',import.meta.url));
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
test('微信切换双引擎保留会话，Claude 任务完成，切换失败保留原引擎',{timeout:60000},async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'wxe-'));
  const mock=path.join(dir,'agent.mjs'),preload=path.join(dir,'offline.mjs');
  await fs.writeFile(mock,`import fs from 'node:fs';import {createInterface} from 'node:readline';
if(process.argv.includes('--version')){if(fs.existsSync(process.env.MOCK_FAIL))process.exit(1);console.log('mock');process.exit(0);}
createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);
const send=x=>process.stdout.write(JSON.stringify(x)+'\\n');
if(m.id!==undefined)send({id:m.id,result:m.method==='model/list'?{data:[{model:'catalog-model'}]}:{}});
if(m.type==='control_request')send({type:'control_response',response:{request_id:m.request_id,subtype:'success',response:{}}});
if(m.type==='user' && !JSON.stringify(m).includes('hold-test'))send({type:'result',subtype:'success',is_error:false,result:'claude-mock'});
});`);
  await fs.writeFile(preload,`import fs from 'node:fs';
globalThis.fetch=async(url,options)=>{await new Promise(r=>setTimeout(r,50));let msgs=[];
if(url.includes('getupdates')){try{msgs=JSON.parse(fs.readFileSync(process.env.MOCK_INBOX,'utf8'));fs.writeFileSync(process.env.MOCK_INBOX,'[]');}catch{}}
else if(url.includes('sendmessage'))fs.appendFileSync(process.env.MOCK_REPLIES,JSON.parse(options.body).msg.item_list[0].text_item.text+'\\n');
return new Response(JSON.stringify({ret:0,msgs}),{headers:{'content-type':'application/json'}});};`);
  const env={...process.env,WX_CODEX_HOME:dir,CODEX_BINARY:mock,CLAUDE_BINARY:mock,MOCK_FAIL:path.join(dir,'fail'),MOCK_INBOX:path.join(dir,'inbox.json'),MOCK_REPLIES:path.join(dir,'replies.txt'),NODE_OPTIONS:'--import='+pathToFileURL(preload).href};
  const run=async(...args)=>(await exec(process.execPath,[cli,...args],{cwd:os.tmpdir(),env,timeout:20000,windowsHide:true})).stdout;
  async function waitFor(check){for(let i=0;i<60;i++){if(await check())return;await new Promise(r=>setTimeout(r,100));}throw Error('condition timed out');}
  let id=0;
  const send=async text=>fs.writeFile(env.MOCK_INBOX,JSON.stringify([{from_user_id:'test-user',message_id:++id,message_type:1,message_state:2,context_token:'test',item_list:[{type:1,text_item:{text}}]}]));
  const state=async()=>JSON.parse(await fs.readFile(path.join(dir,'session.json'),'utf8'));
  try {
    await fs.writeFile(path.join(dir,'config.json'),JSON.stringify({workspace:path.join(dir,'workspace'),engine:'codex'}));
    await fs.writeFile(path.join(dir,'session.json'),JSON.stringify({token:'test-only',owner:'test-user',seen:[],base:'https://ilinkai.weixin.qq.com',codex:{threadId:'saved-codex'},claude:{threadId:'saved-claude'}}));
    await run('start');
    assert.match(await run('model'),/\/模型 catalog-model/);
    await send('/模型');
    await waitFor(async()=>(await fs.readFile(env.MOCK_REPLIES,'utf8').catch(()=>'' )).includes('/模型 catalog-model'));
    await run('model','codex-test');
    assert.equal(JSON.parse(await run('status','--json')).model,'codex-test');
    await assert.rejects(()=>run('model','invalid model'));
    assert.equal(JSON.parse(await run('status','--json')).model,'codex-test');
    await send('/引擎 claude');
    await waitFor(async()=>JSON.parse(await run('status','--json')).engine==='claude');
    assert.equal((await state()).codex.threadId,'saved-codex');
    await send('/模型 sonnet');
    await waitFor(async()=>JSON.parse(await run('status','--json')).model==='sonnet');
    await send('hold-test');
    await waitFor(async()=>JSON.parse(await run('status','--json')).task==='执行中');
    await assert.rejects(()=>run('model','opus'),/任务执行中/);
    await send('/模型 opus');
    await waitFor(async()=>(await fs.readFile(env.MOCK_REPLIES,'utf8')).includes('任务执行中或配置'));
    assert.equal(JSON.parse(await run('status','--json')).model,'sonnet');
    await send('/取消');
    await waitFor(async()=>JSON.parse(await run('status','--json')).task==='空闲');
    await send('hello');await waitFor(async()=>(await state()).claude.lastResult?.includes('claude-mock'));
    await send('/引擎 codex');await waitFor(async()=>JSON.parse(await run('status','--json')).engine==='codex');
    assert.equal((await state()).claude.threadId,'saved-claude');
    assert.equal(JSON.parse(await run('status','--json')).model,'codex-test');
    const savedConfig=JSON.parse(await fs.readFile(path.join(dir,'config.json'),'utf8'));
    assert.equal(savedConfig.claudeModel,'sonnet');
    await run('restart');
    assert.equal(JSON.parse(await run('status','--json')).model,'codex-test');
    await fs.writeFile(env.MOCK_FAIL,'fail');await send('/引擎 claude');
    await waitFor(async()=>(await fs.readFile(env.MOCK_REPLIES,'utf8')).includes('引擎切换失败'));
    assert.equal(JSON.parse(await run('status','--json')).engine,'codex');
    assert.equal(JSON.parse(await fs.readFile(path.join(dir,'config.json'),'utf8')).engine,'codex');
  }finally{await run('stop').catch(()=>{});await fs.rm(dir,{recursive:true,force:true});}
});
