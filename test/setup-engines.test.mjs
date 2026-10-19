import {test} from 'node:test';
import assert from 'node:assert/strict';
import {configureEngines} from '../setup-engines.mjs';
function questions(answers){return async()=>{assert.ok(answers.length,'unexpected question');return answers.shift();};}
test('both 依次配置两个引擎，分别保存认证、模型、代理并选择默认值',async()=>{
 const checked=[],old={engine:'codex',workspace:'/keep',projects:{demo:'/demo'}};
 const {config,engines}=await configureEngines({old,ask:questions(['3','local','codex-model','http://127.0.0.1:7892','local','sonnet','direct','claude']),check:async e=>checked.push(e)});
 assert.deepEqual(engines,['codex','claude']);assert.deepEqual(checked,engines);assert.equal(config.engine,'claude');assert.equal(config.codexModel,'codex-model');assert.equal(config.claudeModel,'sonnet');assert.equal(config.codexProxy,'http://127.0.0.1:7892');assert.equal(config.claudeProxy,'');assert.equal(config.workspace,'/keep');assert.deepEqual(old,{engine:'codex',workspace:'/keep',projects:{demo:'/demo'}});
});
test('单引擎配置保留另一引擎与项目字段，回车保持旧值',async()=>{
 const old={engine:'claude',claudeAuth:'local',claudeModel:'opus',claudeProxy:'http://localhost:7892',codexAuth:'local',codexModel:'keep',codexProxy:'http://localhost:7890',currentProject:'demo'};
 const {config,engines}=await configureEngines({old,ask:questions(['','','',''])});assert.deepEqual(config,old);assert.deepEqual(engines,['claude']);
});
test('双 API 使用各自环境变量和配置，密钥不写入配置',async()=>{
 const env={MY_CODEX_KEY:'private-codex',ANTHROPIC_API_KEY:'private-claude'};
 const {config}=await configureEngines({env,ask:questions(['both','api','https://example.com/v1','MY_CODEX_KEY','custom-model','direct','api','','','sonnet','http://localhost:7892','codex'])});
 assert.equal(config.codexApiKeyEnv,'MY_CODEX_KEY');assert.equal(config.claudeAuth,'api');assert.equal(config.codexBaseUrl,'https://example.com/v1');assert.ok(!JSON.stringify(config).includes('private-'));
});
test('缺失引擎、密钥或非法设置时中止，原配置不修改',async()=>{
 const old={engine:'codex'};
 await assert.rejects(configureEngines({old,ask:questions(['both']),check:async e=>{if(e==='claude')throw Error('missing claude');}}),/missing claude/);
 await assert.rejects(configureEngines({old,ask:questions(['both','local','','','api','','','','','codex']),env:{}}),/ANTHROPIC_API_KEY/);
 await assert.rejects(configureEngines({old,ask:questions(['claude','local','','http://user:pass@localhost'])}),/不含账号密码/);
 await assert.rejects(configureEngines({old,ask:questions(['both','local','','','local','','','invalid'])}),/默认引擎/);
 assert.deepEqual(old,{engine:'codex'});
});
