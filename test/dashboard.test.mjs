import http from 'node:http';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {startDashboard} from '../dashboard.mjs';
import {paths,writeJSON,acquireLock,releaseLock} from '../paths.mjs';
import {serve} from '../service.mjs';
test('面板仅监听回环、认证及来源校验，用户隔离和日志凭证遮盖',async t=>{
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'wxpanel-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));
 const p=paths({WX_CODEX_HOME:base});await writeJSON(p.config,{engine:'codex',codexProxy:'http://secret:password@localhost',secret:'DO_NOT_RETURN'});await fs.writeFile(p.log,'token=private123\nBearer abcdef\nsk-testing-key\nnormal log');
 const calls=[];const ipc=await serve(p,()=>({task:'执行中',engine:'codex'}),()=>calls.push('stop'),null,null,request=>{calls.push(request.action);return {ok:true};});t.after(()=>ipc.close());
 const d=await startDashboard({base});t.after(()=>new Promise(r=>d.server.close(r)));assert.equal(d.server.address().address,'127.0.0.1');
 const request=(body,headers={})=>fetch(d.origin+'/api',{method:'POST',headers:{Authorization:'Bearer '+d.token,Origin:d.origin,'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
 assert.equal((await request({action:'users'},{Authorization:'Bearer wrong'})).status,401);
 assert.equal((await request({action:'users'},{Origin:'https://attacker.example'})).status,403);
 assert.equal(await new Promise((resolve,reject)=>{const r=http.get(d.origin,{headers:{Host:'attacker.example'}},res=>{res.resume();resolve(res.statusCode);});r.on('error',reject);}),403);
 assert.equal((await request({action:'users'},{Origin:''})).status,403);
 const users=await (await request({action:'users'})).text();assert.ok(users.includes('default'));assert.ok(!users.includes('DO_NOT_RETURN')&&!users.includes('password'));
 const log=await (await request({action:'logs'})).text();assert.ok(log.includes('normal log'));assert.ok(!log.includes('private123')&&!log.includes('abcdef')&&!log.includes('sk-testing'));
 assert.equal((await request({action:'logs-clear'})).status,400);assert.ok((await fs.readFile(p.log,'utf8')).includes('normal log'));assert.equal((await (await request({action:'logs-clear',confirm:true})).json()).ok,true);assert.equal(await fs.readFile(p.log,'utf8'),'');
 assert.equal((await request({action:'inspect',user:'../other'})).status,400);
 assert.equal((await request({action:'admin',operation:'shell',value:'whoami'})).status,400);
 assert.equal((await (await request({action:'stop'})).json()).error,'busy');assert.ok(!calls.includes('stop'));
 assert.equal((await (await request({action:'admin',operation:'new',value:'test'})).json()).ok,true);assert.ok(calls.includes('new'));
 const page=await fetch(d.origin);assert.match(page.headers.get('content-security-policy'),/frame-ancestors 'none'/);assert.ok(!(await page.text()).includes(d.token));
});
test('面板停止状态切换工作目录、实际目录显示及中文分块请求',async t=>{
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'wxpaneldir-')),target=path.join(base,'中文 target');await fs.mkdir(target);const p=paths({WX_CODEX_HOME:base});await writeJSON(p.config,{workspace:base});
 const d=await startDashboard({base});t.after(async()=>{await new Promise(r=>d.server.close(r));await fs.rm(base,{recursive:true,force:true});});
 const request=body=>fetch(d.origin+'/api',{method:'POST',headers:{Origin:d.origin,Authorization:'Bearer '+d.token,'Content-Type':'application/json'},body:JSON.stringify(body)});
 const result=await (await request({action:'workspace',value:target})).json();assert.equal(result.applied,'next-start');assert.equal(result.workspace,await fs.realpath(target));
 const data=await (await request({action:'users'})).json();assert.equal(data.users[0].workspace,await fs.realpath(target));assert.equal(data.users[0].status,null);
 const before=await fs.readFile(p.config,'utf8');assert.equal((await request({action:'workspace',value:'relative'})).status,400);assert.equal(await fs.readFile(p.config,'utf8'),before);
 const bytes=Buffer.from(JSON.stringify({action:'workspace',value:target})),split=bytes.indexOf(Buffer.from('中'))+1;
 const chunked=await new Promise((resolve,reject)=>{const req=http.request(d.origin+'/api',{method:'POST',headers:{Origin:d.origin,Authorization:'Bearer '+d.token,'Content-Type':'application/json'}},res=>{let out='';res.setEncoding('utf8');res.on('data',b=>out+=b);res.on('end',()=>resolve(JSON.parse(out)));});req.on('error',reject);req.write(bytes.subarray(0,split));setTimeout(()=>req.end(bytes.subarray(split)),10);});assert.equal(chunked.workspace,await fs.realpath(target));
});
test('面板认证字段白名单、停止态保存及不返回环境密钥',async t=>{
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'wxpanelauth-')),p=paths({WX_CODEX_HOME:base});await writeJSON(p.config,{workspace:base});const d=await startDashboard({base});t.after(async()=>{await new Promise(r=>d.server.close(r));await fs.rm(base,{recursive:true,force:true});});
 const request=body=>fetch(d.origin+'/api',{method:'POST',headers:{Origin:d.origin,Authorization:'Bearer '+d.token,'Content-Type':'application/json'},body:JSON.stringify(body)});
 const body={action:'auth-save',engine:'claude',auth:'local',baseUrl:'https://example.com',apiKeyEnv:'MY_CLAUDE_KEY',model:'default'};
 assert.equal((await (await request(body)).json()).applied,'next-start');assert.equal((await request({...body,apiKey:'NEVER_STORE'})).status,400);assert.ok(!(await fs.readFile(p.config,'utf8')).includes('NEVER_STORE'));
 const view=await (await request({action:'auth-read',engine:'claude'})).json();assert.equal(view.apiKeyEnv,'MY_CLAUDE_KEY');assert.deepEqual(Object.keys(view).sort(),['engine','auth','baseUrl','apiKeyEnv','keyPresent','model'].sort());
 const ipc=await serve(p,()=>({task:'空闲',engine:'codex'}),()=>{});try{assert.equal((await request(body)).status,400);}finally{await ipc.close();}
});
test('页面新增用户、扫码绑定接口与同名保护',async t=>{
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'wxpanelpair-'));let calls=0,starts=0;
 const d=await startDashboard({base,pairingOptions:{request:async()=>!calls++?{qrcode:'test',qrcode_img_content:'https://example.test'}:{status:'confirmed',bot_token:'PRIVATE_TOKEN',ilink_user_id:'owner',ilink_bot_id:'bot'},sleep:async()=>{},startService:async()=>starts++}});t.after(async()=>{await d.close();await fs.rm(base,{recursive:true,force:true});});
 const request=body=>fetch(d.origin+'/api',{method:'POST',headers:{Origin:d.origin,Authorization:'Bearer '+d.token,'Content-Type':'application/json'},body:JSON.stringify(body)});
 assert.equal((await request({action:'user-create',value:'../bad'})).status,400);assert.equal((await (await request({action:'user-create',value:'alice'})).json()).user,'alice');assert.equal((await request({action:'user-create',value:'alice'})).status,400);
 const op=await (await request({action:'pairing-start',user:'alice'})).json();let state;
 for(let i=0;i<100;i++){state=await (await request({action:'pairing-status',user:'alice',operationId:op.operationId})).json();if(state.phase==='completed')break;await new Promise(r=>setTimeout(r,10));}
 assert.equal(state.phase,'completed');assert.equal(starts,1);assert.ok(!JSON.stringify(state).includes('PRIVATE_TOKEN'));assert.equal((await request({action:'pairing-status',user:'default',operationId:op.operationId})).status,400);
 const users=await (await request({action:'users'})).json();assert.equal(users.users.find(u=>u.name==='alice').bound,true);
});

test('页面删除仅限未绑定新增用户：确认、运行锁、绑定保护及文件归档',async t=>{
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'wxpanelremove-'));const d=await startDashboard({base});t.after(async()=>{await d.close();await fs.rm(base,{recursive:true,force:true});});
 const request=body=>fetch(d.origin+'/api',{method:'POST',headers:{Origin:d.origin,Authorization:'Bearer '+d.token,'Content-Type':'application/json'},body:JSON.stringify(body)});
 await request({action:'user-create',value:'alice'});const p=paths({WX_CODEX_HOME:base,WX_AGENT_USER:'alice'});await fs.writeFile(path.join(p.workspace,'keep.txt'),'keep');
 assert.equal((await request({action:'user-remove',user:'alice'})).status,400);
 assert.equal((await request({action:'user-remove',user:'default',confirm:true})).status,400);
 await acquireLock(p);try{assert.equal((await request({action:'user-remove',user:'alice',confirm:true})).status,400);}finally{await releaseLock(p);}
 await writeJSON(p.session,{owner:'bound'});assert.equal((await request({action:'user-remove',user:'alice',confirm:true})).status,400);
 await fs.rm(p.session);const removed=await (await request({action:'user-remove',user:'alice',confirm:true})).json();assert.equal(removed.ok,true);assert.equal(await fs.readFile(path.join(removed.archive,'workspace','keep.txt'),'utf8'),'keep');assert.equal(await fs.stat(path.join(removed.archive,'running.lock')).then(()=>true,()=>false),false);
 const users=await (await request({action:'users'})).json();assert.deepEqual(users.users.map(u=>u.name),['default']);assert.equal((await request({action:'user-remove',user:'alice',confirm:true})).status,400);
 assert.equal((await request({action:'user-create',value:'alice'})).status,200);
});
