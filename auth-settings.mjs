import {engineAuth} from './auth-config.mjs';
import {migrateAuthSessions} from './auth-sessions.mjs';
import {codexSettings} from './codex-config.mjs';
import {modelConfig} from './models.mjs';
import {privateDir,readJSON,writeJSON,acquireLock,releaseLock} from './paths.mjs';
import {control} from './service.mjs';
export function authView(config,engine,env=process.env){
 const s=engineAuth(config,engine,env);return {engine,auth:s.auth,baseUrl:config[engine+'BaseUrl'] || '',apiKeyEnv:s.apiKeyEnv,keyPresent:!!env[s.apiKeyEnv]?.trim(),model:config[engine+'Model'] || ''};
}
export function updateAuthConfig(config,input,env=process.env){
 const allowed=['engine','auth','baseUrl','apiKeyEnv','model'];if(!input||Object.keys(input).some(k=>!allowed.includes(k)))throw Error('认证表单只接受方式、地址、变量名和模型，不接受密钥');
 const {engine,auth,baseUrl,apiKeyEnv}=input;if(!['codex','claude'].includes(engine)||!['local','api'].includes(auth)||typeof baseUrl!=='string'||typeof apiKeyEnv!=='string')throw Error('认证配置参数无效');
 let next={...config,[engine+'Auth']:auth,[engine+'BaseUrl']:baseUrl.trim(),[engine+'ApiKeyEnv']:apiKeyEnv.trim()};
 if(input.model!==undefined)next=modelConfig(next,engine,input.model);
 const settings=engineAuth(next,engine,env);
 if(auth==='api'&&!env[settings.apiKeyEnv]?.trim())throw Error('密钥环境变量未设置，请在启动面板的终端配置并重新打开面板');
 if(engine==='codex')codexSettings(next,env);return next;
}
export async function stoppedLock(p,fn){
 try{const state=await control(p);if(state)throw Error('请先停止该用户服务，再保存配置');}catch(e){if(!['ENOENT','ECONNREFUSED'].includes(e.code))throw e;}
 await privateDir(p.dir);await acquireLock(p);try{return await fn();}finally{await releaseLock(p);}
}
export async function saveAuth(p,input,{env=process.env,write=writeJSON}={}){
 return stoppedLock(p,async()=>{
  const old=await readJSON(p.config,{}),next=updateAuthConfig(old,input,env),session=await readJSON(p.session,null);
  // Persist the old identity before the new config. A failed config write leaves
  // old conversations reachable; never migrate old threads under the new API.
  if(session && migrateAuthSessions(session,{...old,workspace:old.workspace || p.workspace},env))await write(p.session,session);
  await write(p.config,next);return {ok:true,applied:'next-start'};
 });
}
export async function saveModel(p,value){
 let state;try{state=await control(p);}catch(e){if(!['ENOENT','ECONNREFUSED'].includes(e.code))throw e;}
 if(state)return control(p,'model',{model:value});
 return stoppedLock(p,async()=>{const config=await readJSON(p.config,{}),engine=config.engine || 'codex',next=modelConfig(config,engine,value);if(engine==='codex')codexSettings(next);await writeJSON(p.config,next);return {ok:true,applied:'next-start',model:next[engine+'Model'] || null};});
}
