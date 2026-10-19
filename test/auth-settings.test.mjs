import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {authView,saveAuth,updateAuthConfig} from '../auth-settings.mjs';
import {authSession,migrateAuthSessions} from '../auth-sessions.mjs';
import {claudeEnvironment} from '../auth-config.mjs';
import {paths,writeJSON,readJSON,acquireLock,releaseLock} from '../paths.mjs';
const env={KEY_A:'private-a',KEY_B:'private-b'};
const api={codexAuth:'api',codexBaseUrl:'https://a.example/v1',codexApiKeyEnv:'KEY_A',codexModel:'model'};
test('认证按配置和目录隔离，返回旧配置及JSON重载恢复；模型不隔离',()=>{
 const state={codex:{threadId:'old',workspace:'/a'}};migrateAuthSessions(state,{workspace:'/a'});assert.equal(authSession(state,'codex','/a',{}).threadId,'old');
 const a=authSession(state,'codex','/a',api);assert.equal(a.threadId,undefined);a.threadId='api-a';assert.equal(authSession(state,'codex','/a',{...api,codexBaseUrl:'https://b.example/v1'}).threadId,undefined);
 assert.equal(authSession(state,'codex','/a',{...api,codexApiKeyEnv:'KEY_B'}).threadId,undefined);assert.equal(authSession(state,'codex','/a',{...api,codexModel:'other'}).threadId,'api-a');
 const loaded=JSON.parse(JSON.stringify(state));assert.equal(authSession(loaded,'codex','/a',{}).threadId,'old');assert.equal(authSession(loaded,'codex','/a',api).threadId,'api-a');assert.equal(authSession(loaded,'codex','/b',api).threadId,undefined);
});
test('认证允许列表与变量引用，default清除和候选校验',()=>{
 const form={engine:'codex',auth:'api',baseUrl:'https://a.example/v1',apiKeyEnv:'KEY_A',model:'model'};
 const c=updateAuthConfig({},form,env);assert.ok(!JSON.stringify(authView(c,'codex',env)).includes('private'));assert.equal(authView(c,'codex',env).keyPresent,true);
 assert.throws(()=>updateAuthConfig(c,{...form,apiKey:'secret'},env));assert.throws(()=>updateAuthConfig(c,{...form,model:'default'},env),/模型/);
 assert.equal(updateAuthConfig(c,{...form,model:'default'},{...env,OPENAI_MODEL:'fallback'}).codexModel,'');
 assert.equal(updateAuthConfig(c,{...form,model:undefined},env).codexModel,'model');
 const e=claudeEnvironment({claudeAuth:'api',claudeApiKeyEnv:'KEY_B',claudeBaseUrl:'https://b.example'}, {...env,ANTHROPIC_AUTH_TOKEN:'old',CLAUDE_CODE_OAUTH_TOKEN:'old'});assert.equal(e.ANTHROPIC_API_KEY,'private-b');assert.equal(e.ANTHROPIC_BASE_URL,'https://b.example');assert.equal(e.ANTHROPIC_AUTH_TOKEN,undefined);assert.equal(env.ANTHROPIC_API_KEY,undefined);
});
test('停止保存先迁移，锁阻止覆盖；不向配置写密钥',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'wxauth-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const p=paths({WX_CODEX_HOME:dir});await writeJSON(p.config,{workspace:dir});await writeJSON(p.session,{codex:{workspace:dir,threadId:'old'}});
 const input={engine:'codex',auth:'api',baseUrl:'https://a.example/v1',apiKeyEnv:'KEY_A',model:'model'};
 await acquireLock(p);try{await assert.rejects(saveAuth(p,input,{env}));}finally{await releaseLock(p);}
 await saveAuth(p,input,{env});assert.ok(!JSON.stringify(await readJSON(p.config)).includes('private'));const s=await readJSON(p.session);assert.equal(authSession(s,'codex',dir,{}).threadId,'old');assert.equal(authSession(s,'codex',dir,api).threadId,undefined);
});

test('迁移完成但配置写入失败保留旧身份，重复迁移不改归属',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'wxauthfail-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const p=paths({WX_CODEX_HOME:dir}),old={workspace:dir};await writeJSON(p.config,old);await writeJSON(p.session,{codex:{workspace:dir,threadId:'old'}});
 const input={engine:'codex',auth:'api',baseUrl:'https://a.example/v1',apiKeyEnv:'KEY_A',model:'model'};
 await assert.rejects(saveAuth(p,input,{env,write:async(file,data)=>{if(file===p.config)throw Error('disk');await writeJSON(file,data);}}),/disk/);
 assert.deepEqual(await readJSON(p.config),old);const state=await readJSON(p.session);assert.equal(migrateAuthSessions(state,api),false);assert.equal(authSession(state,'codex',dir,old).threadId,'old');assert.equal(authSession(state,'codex',dir,api).threadId,undefined);
});

test('旧会话无 workspace 时按配置真实路径迁移，两种引擎均保留',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'wxauthlegacy-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const real=await fs.realpath(dir),config={workspace:dir};
 const state={codex:{threadId:'saved-codex'},claude:{threadId:'saved-claude'}};
 assert.equal(authSession(state,'codex',real,config).threadId,'saved-codex');
 assert.equal(authSession(state,'claude',real,config).threadId,'saved-claude');
 const loaded=JSON.parse(JSON.stringify(state));assert.equal(authSession(loaded,'codex',real,config).threadId,'saved-codex');
 const fallback={codex:{threadId:'fallback'}};assert.equal(authSession(fallback,'codex',real,{}).threadId,'fallback');
});

test('读取选中的API模式及实际环境地址，不修改已保存认证或返回密钥',()=>{
 const c={claudeAuth:'local',claudeModel:'opus'},env={ANTHROPIC_BASE_URL:'https://proxy.example/',ANTHROPIC_API_KEY:'secret'};
 const r=authView(c,'claude',env,'api');assert.equal(r.auth,'api');assert.equal(r.savedAuth,'local');assert.equal(r.effectiveBaseUrl,'https://proxy.example');assert.equal(r.baseUrlSource,'environment');assert.equal(r.keyPresent,true);assert.equal(c.claudeAuth,'local');assert.ok(!JSON.stringify(r).includes('secret'));assert.throws(()=>authView(c,'claude',env,'wrong'));
});
