import {realpathSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {engineAuth} from './auth-config.mjs';
const canonical=value=>{try{return realpathSync(value);}catch{return value;}};
const hash=value=>createHash('sha256').update(value).digest('hex');
export function authFingerprint(config,engine,env=process.env){
 if((config[engine+'Auth'] || 'local')==='local')return hash('local');
 const {auth,baseUrl,apiKeyEnv}=engineAuth(config,engine,env);return hash(JSON.stringify([auth,baseUrl,apiKeyEnv]));
}
export function migrateAuthSessions(state,config={},env=process.env){
 if(state.authSessionVersion===1)return false;
 state.authProjectSessions ||= {};
 const register=(key,engine,slot)=>{
  const group=(state.authProjectSessions[key] ||= {})[engine] ||= {};
  group[authFingerprint(config,engine,env)] ||= slot;
 };
 for(const [key,engines] of Object.entries(state.projectSessions || {}))for(const engine of ['codex','claude'])if(engines[engine])register(key,engine,engines[engine]);
 for(const engine of ['codex','claude']){const slot=state[engine],cwd=slot?.workspace || config.workspace;if(slot && cwd)register(hash(canonical(cwd)),engine,slot);}
 state.authSessionVersion=1;return true;
}
export function storeAuthSession(state,engine,cwd,config,slot,env=process.env){
 const key=hash(canonical(cwd)),fingerprint=authFingerprint(config,engine,env);
 state.authProjectSessions ||= {};((state.authProjectSessions[key] ||= {})[engine] ||= {})[fingerprint]=slot;
 state.projectSessions ||= {};(state.projectSessions[key] ||= {})[engine]=slot;return slot;
}
export function authSession(state,engine,cwd,config={},env=process.env){
 migrateAuthSessions(state,{...config,workspace:config.workspace || cwd},env);
 const key=hash(canonical(cwd)),fingerprint=authFingerprint(config,engine,env);
 const slot=state.authProjectSessions[key]?.[engine]?.[fingerprint] || {workspace:cwd};
 slot.workspace=cwd;storeAuthSession(state,engine,cwd,config,slot,env);state[engine]=slot;return slot;
}
