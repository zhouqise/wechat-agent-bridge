import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {paths,readJSON} from '../paths.mjs';
import {provisionUser,userNames,userName,archiveUser} from '../users.mjs';
const exec=promisify(execFile),cli=fileURLToPath(new URL('../wx-agent.mjs',import.meta.url));
test('用户独立路径、共享组件根目录、配置继承不复制绑定',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'wxu-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 await fs.writeFile(path.join(dir,'config.json'),JSON.stringify({workspace:'/private-project',engine:'claude',unknown:'never-copy'}));
 await fs.writeFile(path.join(dir,'session.json'),JSON.stringify({owner:'owner',token:'private'}));
 const p=await provisionUser(dir,'girlfriend'),base=paths({WX_CODEX_HOME:dir});
 assert.notEqual(p.socket,base.socket);assert.equal(p.baseDir,base.dir);assert.equal((await readJSON(p.config)).engine,'claude');assert.equal((await readJSON(p.config)).workspace,p.workspace);assert.equal((await readJSON(p.config)).unknown,undefined);assert.equal(await readJSON(p.session,null),null);
 await assert.rejects(provisionUser(dir,'girlfriend'),/已存在/);
 for(const name of ['../a','A','default','con','a/b','a b'])assert.throws(()=>userName(name));
 assert.deepEqual(await userNames(dir),['girlfriend']);await fs.writeFile(path.join(p.workspace,'keep.txt'),'keep');const archive=await archiveUser(dir,'girlfriend');assert.equal(await fs.readFile(path.join(archive,'workspace','keep.txt'),'utf8'),'keep');assert.deepEqual(await userNames(dir),[]);
 const w=paths({WX_CODEX_HOME:'C:\\data',WX_AGENT_USER:'girlfriend'},'win32');assert.match(w.dir,/users\\girlfriend$/);assert.notEqual(w.socket,paths({WX_CODEX_HOME:'C:\\data'},'win32').socket);
});
test('两个用户任务真实并行，审批、取消、停止互不影响；禁止外网',{timeout:60000},async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'wxp-')),mock=path.join(dir,'agent.mjs'),preload=path.join(dir,'offline.mjs');
 await fs.writeFile(mock,`import {createInterface} from 'node:readline';
const user=process.env.WX_AGENT_USER||'default',threadId='thread-'+user,turnId='turn-'+user;
const send=m=>process.stdout.write(JSON.stringify(m)+'\\n');
createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);
if(m.method==='thread/start'||m.method==='thread/resume')send({id:m.id,result:{thread:{id:threadId}}});
else if(m.method==='turn/start'){send({id:m.id,result:{turn:{id:turnId}}});send({id:99,method:'item/commandExecution/requestApproval',params:{threadId,turnId,command:'mock-only-'+user}});}
else if(m.method==='turn/interrupt'){send({id:m.id,result:{}});send({method:'turn/completed',params:{threadId,turn:{id:turnId,status:'interrupted'}}});}
else if(m.id!==undefined&&m.method)send({id:m.id,result:{}});
});`);
 await fs.writeFile(preload,`import fs from 'node:fs';import path from 'node:path';
const user=process.env.WX_AGENT_USER||'default',dir=process.env.MOCK_DIR;
globalThis.fetch=async(url,options)=>{await new Promise(r=>setTimeout(r,30));let msgs=[];
if(url.includes('getupdates')){try{msgs=JSON.parse(fs.readFileSync(path.join(dir,user+'.in'),'utf8'));fs.writeFileSync(path.join(dir,user+'.in'),'[]');}catch{}}
else if(url.includes('sendmessage')){const msg=JSON.parse(options.body).msg;if(msg.to_user_id!==user)throw Error('cross-user recipient');fs.appendFileSync(path.join(dir,user+'.out'),msg.item_list[0].text_item.text+'\\n');}
return new Response(JSON.stringify({ret:0,msgs}),{headers:{'content-type':'application/json'}});};`);
 const env={...process.env,WX_CODEX_HOME:dir,CODEX_BINARY:mock,MOCK_DIR:dir,NODE_OPTIONS:'--import='+pathToFileURL(preload).href};delete env.WX_AGENT_USER;
 const run=async(...args)=>(await exec(process.execPath,[cli,...args],{env,cwd:os.tmpdir(),timeout:20000,windowsHide:true})).stdout;
 const status=async user=>JSON.parse(await run('status','--json',...(user==='default'?[]:['--user',user])));
 async function waitFor(fn){for(let i=0;i<80;i++){if(await fn())return;await new Promise(r=>setTimeout(r,100));}throw Error('condition timed out');}
 let id=0;const send=async(user,text,owner=user)=>fs.writeFile(path.join(dir,user+'.in'),JSON.stringify([{from_user_id:owner,message_id:++id,message_type:1,message_state:2,context_token:'test-'+user,item_list:[{type:1,text_item:{text}}]}]));
 const output=user=>fs.readFile(path.join(dir,user+'.out'),'utf8').catch(()=>'');
 try {
  await fs.writeFile(path.join(dir,'config.json'),JSON.stringify({workspace:path.join(dir,'workspace')}));await run('user','add','girlfriend','--no-login');
  for(const user of ['default','girlfriend']){const p=paths({...env,...(user==='default'?{}:{WX_AGENT_USER:user})});await fs.writeFile(p.session,JSON.stringify({owner:user,token:'test-'+user,seen:[],base:'https://ilinkai.weixin.qq.com'}));}
  await run('start');await run('user','start','girlfriend');await send('default','task one');await send('girlfriend','task two');
  await waitFor(async()=>(await status('default')).task==='等待确认'&&(await status('girlfriend')).task==='等待确认');
  const a=await status('default'),b=await status('girlfriend');assert.notEqual(a.pid,b.pid);assert.notEqual(a.workspace,b.workspace);
  const code=(await output('girlfriend')).match(/需你确认 ([a-f0-9]+)/)[1];
  await send('default','/批准 '+code);await waitFor(async()=>(await output('default')).includes('确认编号不存在'));assert.equal((await status('girlfriend')).task,'等待确认');
  await send('girlfriend','/取消','default');await new Promise(r=>setTimeout(r,1200));assert.equal((await status('girlfriend')).task,'等待确认');
  await send('default','/取消');await waitFor(async()=>(await status('default')).task==='空闲');assert.equal((await status('girlfriend')).task,'等待确认');
  await assert.rejects(run('update'),/仍在运行/);await assert.rejects(run('user','remove','girlfriend'),/先停止/);
  await run('stop');assert.equal((await status('girlfriend')).pid,b.pid);assert.equal((await status('girlfriend')).task,'等待确认');
  await run('user','stop','girlfriend');await run('user','remove','girlfriend');assert.match(await run('user','list'),/default/);
 }finally{await run('stop').catch(()=>{});await run('user','stop','girlfriend').catch(()=>{});await fs.rm(dir,{recursive:true,force:true});}
});
