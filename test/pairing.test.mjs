import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pairWechat} from '../pairing.mjs';
const confirmed={status:'confirmed',bot_token:'SECRET',ilink_user_id:'owner',ilink_bot_id:'bot'};
const qr={qrcode:'qr',qrcode_img_content:'https://example.test/qr'};
const barrier=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve};};
test('共享扫码支持配对码、可信重定向与绑定保存',async()=>{
 const requests=[],phases=[];let calls=0,saved;
 await pairWechat({request:async(base,endpoint)=>{requests.push(endpoint);return calls++===0?qr:calls===2?{status:'need_verifycode'}:confirmed;},onQr:async()=>{},onPhase:p=>phases.push(p),getCode:async()=> '123456',commit:async s=>{saved=s;},sleep:async()=>{}});
 assert.equal(saved.owner,'owner');assert.ok(requests.at(-1).includes('verify_code=123456'));assert.ok(phases.includes('committing'));
});
test('保存前取消不得迟到提交，保存开始后等待完成保留bound',async()=>{
 for(const duringCommit of [false,true]){
  const entered=barrier(),release=barrier(),abort=new AbortController();let calls=0,saved=false;
  const job=pairWechat({signal:abort.signal,request:async()=>{if(!calls++)return qr;if(!duringCommit){entered.resolve();await release.promise;}return confirmed;},onQr:async()=>{},commit:async()=>{entered.resolve();await release.promise;saved=true;},sleep:async()=>{}});
  await entered.promise;abort.abort();release.resolve();if(duringCommit){await job;assert.equal(saved,true);}else{await assert.rejects(job);assert.equal(saved,false);}
 }
});

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {PairingManager} from '../pairing-manager.mjs';
import {paths,writeJSON,readJSON,acquireLock,releaseLock} from '../paths.mjs';
const wait=async fn=>{for(let i=0;i<100;i++){if(fn())return;await new Promise(r=>setTimeout(r,5));}throw Error('wait timeout');};
async function fixture(t,options={}){const base=await fs.mkdtemp(path.join(os.tmpdir(),'wxpair-')),p=paths({WX_CODEX_HOME:base});await writeJSON(p.config,{workspace:base});let starts=0;const manager=new PairingManager({resolveUser:async()=>p,startService:async()=>{starts++;},sleep:async()=>{},...options});t.after(async()=>{await manager.close();await fs.rm(base,{recursive:true,force:true});});return {p,manager,starts:()=>starts};}
test('配对操作身份、重复开始、配对码与凭据不返回',async t=>{
 let count=0;const {p,manager,starts}=await fixture(t,{request:async(_,endpoint)=>!count++?qr:endpoint.includes('verify_code=1234')?confirmed:{status:'need_verifycode'}});
 const op=await manager.begin('default');assert.equal((await manager.begin('default')).operationId,op.operationId);await wait(()=>manager.status('default',op.operationId).phase==='need-code');
 assert.throws(()=>manager.status('other',op.operationId));assert.throws(()=>manager.code('default',op.operationId,'abc'));manager.code('default',op.operationId,'1234');await manager.operations.get(op.operationId).job;
 const status=manager.status('default',op.operationId);assert.equal(status.phase,'completed');assert.equal(starts(),1);assert.ok(!JSON.stringify(status).includes('SECRET'));assert.equal((await readJSON(p.session)).token,'SECRET');await acquireLock(p);await releaseLock(p);
 const again=await manager.begin('default');await manager.operations.get(again.operationId).job;assert.equal(manager.status('default',again.operationId).phase,'failed');assert.equal(starts(),1);
});
test('提交中取消和关闭等待保存，不提前释放锁或启动',async t=>{
 for(const close of [false,true]){
 const entered=barrier(),release=barrier();let count=0;const {p,manager,starts}=await fixture(t,{request:async()=>!count++?qr:confirmed,commit:async(file,state)=>{entered.resolve();await release.promise;await writeJSON(file,state);}});
 const op=await manager.begin('default');await entered.promise;let done=false;const cancelled=(close?manager.close():manager.cancel('default',op.operationId)).then(()=>done=true);await new Promise(r=>setTimeout(r,5));assert.equal(done,false);await assert.rejects(acquireLock(p));release.resolve();await cancelled;
 assert.equal((await readJSON(p.session)).owner,'owner');assert.equal(starts(),0);await acquireLock(p);await releaseLock(p);
 }
});
test('保存前取消等待迟到请求退出；启动失败保留绑定',async t=>{
 const entered=barrier(),release=barrier();let count=0;const {p,manager}=await fixture(t,{request:async()=>{if(!count++)return qr;entered.resolve();await release.promise;return confirmed;}});
 const op=await manager.begin('default');await entered.promise;const cancelled=manager.cancel('default',op.operationId);await assert.rejects(acquireLock(p));release.resolve();assert.equal((await cancelled).phase,'cancelled');assert.equal(await readJSON(p.session,null),null);
 let calls=0;const failed=await fixture(t,{request:async()=>!calls++?qr:confirmed,startService:async()=>{throw Error('private credential');}});const id=(await failed.manager.begin('default')).operationId;await failed.manager.operations.get(id).job;const status=failed.manager.status('default',id);assert.equal(status.phase,'bound');assert.ok(!status.message.includes('private'));assert.equal((await readJSON(failed.p.session)).owner,'owner');
});
test('不可信微信重定向、过期或未知状态不会提交',async()=>{
 for(const result of [{status:'scaned_but_redirect',redirect_host:'attacker.example'},{status:'expired'},{status:'unknown'}]){let count=0,saved=false;await assert.rejects(pairWechat({request:async()=>!count++?qr:result,commit:async()=>saved=true,sleep:async()=>{}}));assert.equal(saved,false);}
});
