import {control} from '../service.mjs';
import {paths} from '../paths.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath,pathToFileURL} from 'node:url';
const exec=promisify(execFile),cli=fileURLToPath(new URL('../wx-agent.mjs',import.meta.url));
test('完整流程：文件+说明合并、队列串行、结果自动回传、切换项目再恢复',{timeout:60000},async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'wxflow-')),mock=path.join(dir,'agent.mjs'),preload=path.join(dir,'offline.mjs'),ws=path.join(dir,'work'),other=path.join(dir,'other');await fs.mkdir(ws);await fs.mkdir(other);
 await fs.writeFile(mock,`import fs from 'node:fs';import path from 'node:path';import {createInterface} from 'node:readline';
const send=m=>process.stdout.write(JSON.stringify(m)+'\\n');let thread,turn=0;
createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(m.method==='thread/start'||m.method==='thread/resume'){thread=m.params.threadId||'thread-'+path.basename(m.params.cwd);send({id:m.id,result:{thread:{id:thread}}});}
else if(m.method==='turn/start'){const id='turn-'+(++turn),p=m.params;fs.appendFileSync(process.env.FLOW_CALLS,JSON.stringify(p)+'\\n');send({id:m.id,result:{turn:{id}}});if(p.input[0].text==='crash-test'){setTimeout(()=>process.exit(1),50);return;}setTimeout(()=>{fs.mkdirSync(path.join(p.cwd,'wx-agent-output'),{recursive:true});fs.writeFileSync(path.join(p.cwd,'wx-agent-output','result'+turn+'.txt'),'result '+turn);send({method:'item/completed',params:{threadId:thread,turnId:id,item:{id:'msg'+id,type:'agentMessage',phase:'final_answer',text:'done'}}});send({method:'turn/completed',params:{threadId:thread,turn:{id,status:'completed'}}});},2200);}
else if(m.id!==undefined&&m.method)send({id:m.id,result:{}});});`);
 await fs.writeFile(preload,`import fs from 'node:fs';
globalThis.fetch=async(url,options)=>{let msgs=[];
if(url.includes('getupdates')){try{msgs=JSON.parse(fs.readFileSync(process.env.FLOW_IN,'utf8'));fs.writeFileSync(process.env.FLOW_IN,'[]');}catch{}}
else if(url.includes('/c2c/download'))return new Response('uploaded document content');
else if(url.includes('getuploadurl'))return new Response(JSON.stringify({upload_param:'mock'}));
else if(url.includes('/c2c/upload'))return new Response('',{headers:{'x-encrypted-param':'mock'}});
else if(url.includes('sendmessage'))fs.appendFileSync(process.env.FLOW_OUT,options.body+'\\n');
else throw Error('unexpected network');
return new Response(JSON.stringify({ret:0,msgs}));};`);
 const env={...process.env,WX_CODEX_HOME:dir,CODEX_BINARY:mock,FLOW_CALLS:path.join(dir,'calls'),FLOW_IN:path.join(dir,'in'),FLOW_OUT:path.join(dir,'out'),NODE_OPTIONS:'--import='+pathToFileURL(preload).href};delete env.WX_AGENT_USER;
 const run=async(...args)=>(await exec(process.execPath,[cli,...args],{env,timeout:20000,windowsHide:true})).stdout;
 const lines=async file=>(await fs.readFile(file,'utf8').catch(()=>'')).trim().split('\n').filter(Boolean).map(x=>JSON.parse(x));
 const calls=()=>lines(env.FLOW_CALLS),out=()=>lines(env.FLOW_OUT),status=async()=>JSON.parse(await run('status','--json'));
 async function wait(fn){for(let i=0;i<120;i++){if(await fn())return;await new Promise(r=>setTimeout(r,100));}throw Error('condition timed out');}
 let id=0;const msg=(text,items=[])=>({from_user_id:'owner',message_id:++id,message_type:1,message_state:2,context_token:'ctx'+id,item_list:[...items,...(text?[{type:1,text_item:{text}}]:[])]});
 const batch=async list=>{await fs.writeFile(env.FLOW_IN,JSON.stringify(list));await wait(async()=>(await fs.readFile(env.FLOW_IN,'utf8'))==='[]');};
 try{
  await fs.writeFile(path.join(dir,'config.json'),JSON.stringify({workspace:ws,projects:{other}}));await fs.writeFile(path.join(dir,'session.json'),JSON.stringify({owner:'owner',token:'fixture',seen:[],base:'https://ilinkai.weixin.qq.com'}));await run('start');
  await batch([msg('',[{type:4,file_item:{file_name:'input.txt',media:{full_url:'https://novac2c.cdn.weixin.qq.com/c2c/download?mock'}}}]),msg('summarize attached'),msg('/开始')]);await wait(async()=>(await calls()).length===1);
  await batch([msg('second task'),msg('/开始')]);
  await wait(async()=>(await out()).filter(x=>x.msg.item_list[0].type===4).length===2);await wait(async()=>(await status()).task==='空闲');
  const c=await calls();assert.equal(c.length,2);assert.equal(c[0].input[0].text,'summarize attached');assert.ok(c[0].input.some(x=>x.text?.includes('uploaded document content')));assert.equal(c[1].input[0].text,'second task');
  const files=(await out()).filter(x=>x.msg.item_list[0].type===4);assert.deepEqual(files.map(x=>x.msg.context_token),['ctx2','ctx4']);assert.ok(files.every(x=>x.msg.to_user_id==='owner'));
  await batch([msg('/项目 other')]);await wait(async()=>(await status()).project==='other');await batch([msg('other task'),msg('/开始')]);await wait(async()=>(await status()).task==='空闲'&&(await calls()).length===3);
  await batch([msg('/项目 default')]);await wait(async()=>(await status()).project==='default');await batch([msg('resume task'),msg('/开始')]);await wait(async()=>(await calls()).length===4);const final=await calls();assert.equal(final[3].threadId,final[0].threadId);assert.notEqual(final[2].threadId,final[0].threadId);
  await wait(async()=>(await status()).task==='空闲');const original=(await status()).conversation;
  await batch([msg('/新会话 新主题')]);await wait(async()=>(await status()).conversation!==original);const newer=(await status()).conversation;
  await batch([msg('/会话')]);await wait(async()=>(await out()).some(x=>x.msg.item_list[0].text_item?.text.includes('新主题')));
  await batch([msg('/切换会话 '+original)]);await wait(async()=>(await status()).conversation===original);
  await batch([msg('/删除会话 '+newer)]);await wait(async()=>(await out()).some(x=>x.msg.item_list[0].text_item?.text.includes('已删除桥接会话记录 '+newer)));
  await run('restart');assert.equal((await status()).conversation,original);
  const p=paths({WX_CODEX_HOME:dir});const inspect=()=>control(p,'admin',{action:'inspect'});
  assert.equal((await inspect()).current,original);
  await control(p,'admin',{action:'new',value:'Panel session'});assert.notEqual((await inspect()).current,original);
  await control(p,'admin',{action:'switch',value:original});assert.equal((await inspect()).current,original);
  const beforeCrash=(await calls()).length;await batch([msg('crash-test'),msg('/开始')]);
  await wait(async()=>(await calls()).length===beforeCrash+1 && (await status()).task==='空闲' && (await status()).agentReady);
  await batch([msg('after recovery'),msg('/开始')]);await wait(async()=>(await calls()).length===beforeCrash+2 && (await status()).task==='空闲');
  assert.equal((await calls()).filter(x=>x.input[0].text==='crash-test').length,1);
  await control(p,'admin',{action:'clear'});assert.equal((await inspect()).conversations.length,1);


 }finally{await run('stop').catch(()=>{});await fs.rm(dir,{recursive:true,force:true});}
});
