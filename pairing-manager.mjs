import {randomUUID} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import QRCode from 'qrcode';
import {pairWechat} from './pairing.mjs';
import {acquireLock,releaseLock,readJSON,writeJSON,privateDir,alive} from './paths.mjs';
const active=op=>!op.finishedAt;
export class PairingManager {
 constructor({resolveUser,startService,request,commit=writeJSON,timeoutMs=300000,sleep}={}){Object.assign(this,{resolveUser,startService,request,commit,timeoutMs,sleep});this.operations=new Map();this.closing=false;}
 snapshot(op){return {operationId:op.id,user:op.user,phase:op.phase,terminal:!!op.finishedAt,expiresAt:op.expiresAt,...(op.qr?{qrDataUrl:op.qr}:{}),...(op.message?{message:op.message}:{})};}
 prune(){for(const [id,op] of this.operations)if(op.finishedAt && Date.now()-op.finishedAt>600000)this.operations.delete(id);}
 get(user,id){this.prune();const op=this.operations.get(id);if(!op || op.user!==user)throw Error('绑定操作不存在，请刷新用户状态');return op;}
 async begin(user){
  if(this.closing)throw Error('管理面板正在关闭');this.prune();const previous=[...this.operations.values()].find(op=>op.user===user&&active(op));if(previous)return this.snapshot(previous);
  const op={id:randomUUID(),user,phase:'starting',expiresAt:Date.now()+this.timeoutMs,abort:new AbortController(),cancelled:false};this.operations.set(op.id,op);
  op.job=this.run(op);return this.snapshot(op);
 }
 async run(op){
  let p,locked=false,bound=false,guard,guardLocked=false;
  try{
   p=await this.resolveUser(op.user);guard={...p,lock:path.join(p.baseDir,'users.lock')};await privateDir(p.baseDir);await acquireLock(guard);guardLocked=true;p=await this.resolveUser(op.user);await privateDir(p.dir);
   const updating=async()=>alive(Number(await fs.readFile(path.join(p.baseDir,'update.lock'),'utf8').catch(()=>'')));
   if(op.cancelled||this.closing)throw Error('扫码已取消');if(await updating())throw Error('安装包正在更新');
   await acquireLock(p);locked=true;await releaseLock(guard);guardLocked=false;
   if(await updating())throw Error('安装包正在更新');
   if(await readJSON(p.session,null))throw Error('该用户已有绑定记录，不能覆盖，请刷新状态');
   await pairWechat({signal:op.abort.signal,timeoutMs:this.timeoutMs,request:this.request,sleep:this.sleep,
    onQr:async content=>{op.qr=await QRCode.toDataURL(content,{width:320,margin:2});},
    onPhase:phase=>{op.phase=phase;if(phase==='bound'){bound=true;op.qr=null;}},
    getCode:signal=>new Promise((resolve,reject)=>{
     const abort=()=>{op.code=null;reject(Error('扫码已取消或过期'));};
     op.code=value=>{signal.removeEventListener('abort',abort);op.code=null;resolve(value);};
     signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
    }),commit:state=>this.commit(p.session,state)});
   await releaseLock(p);locked=false;
   if(op.cancelled||this.closing){op.phase='bound';op.message='已绑定，尚未启动服务';return;}
   op.phase='starting-service';await this.startService(op.user);op.phase='completed';op.message='微信已绑定，服务已启动';
  }catch(e){op.phase=bound?'bound':op.cancelled?'cancelled':'failed';op.message=bound?'已绑定，但服务未确认启动，请查看状态后启动':op.cancelled?'扫码已取消':/^(扫码|二维码|微信|获取微信|登录轮询|配对|需要手机|请输入手机|缺少绑定|该用户已有|安装包正在)/.test(e.message)?e.message:'绑定未完成，请检查配置、运行状态或网络后重试';}
  finally{op.qr=null;op.code=null;try{if(locked)await releaseLock(p);if(guardLocked)await releaseLock(guard);}catch{op.phase=bound?'bound':'failed';op.message='绑定操作结束，但清理未确认，请检查服务状态';}op.finishedAt=Date.now();}
 }
 status(user,id){return this.snapshot(this.get(user,id));}
 code(user,id,value){const op=this.get(user,id);if(op.phase!=='need-code'||!op.code||typeof value!=='string'||!/^\d{1,12}$/.test(value))throw Error('当前不接受配对码，或配对码格式无效');op.phase='waiting';op.code(value);return {ok:true};}
 async cancel(user,id){const op=this.get(user,id);op.cancelled=true;op.abort.abort();await op.job;return {ok:true,...this.snapshot(op)};}
 async close(){this.closing=true;for(const op of this.operations.values())if(active(op)){op.cancelled=true;op.abort.abort();}await Promise.allSettled([...this.operations.values()].map(op=>op.job));this.operations.clear();}
}
