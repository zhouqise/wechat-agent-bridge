import {test} from 'node:test';
import assert from 'node:assert/strict';
import {codexSettings} from '../codex-config.mjs';
test('local 保留已有配置，API 缺失密钥或模型时不回退登录',()=>{
 assert.deepEqual(codexSettings({},{}),{auth:'local',args:[]});
 assert.throws(()=>codexSettings({codexAuth:'bad'},{}),/认证/);
 assert.throws(()=>codexSettings({codexAuth:'api'},{}),/未设置/);
 assert.throws(()=>codexSettings({codexAuth:'api'},{OPENAI_API_KEY:'test'}),/模型/);
});
test('自定义地址校验、环境变量默认值和显式配置优先',()=>{
 const env={OPENAI_API_KEY:'test',OPENAI_BASE_URL:'https://gateway.example/v1',OPENAI_MODEL:'model-a'};
 const cfg={codexAuth:'api'};
 assert.match(codexSettings(cfg,env).args.join(' '),/gateway.example/);
 assert.equal(codexSettings({...cfg,codexModel:'model-b'},env).model,'model-b');
 for(const url of ['http://example.com/v1','https://user:secret@example.com/v1','https://example.com/v1?key=secret','bad'])assert.throws(()=>codexSettings({...cfg,codexBaseUrl:url},env),/地址/);
 assert.match(codexSettings({...cfg,codexBaseUrl:'http://127.0.0.1:8080/v1'},env).args.join(' '),/127.0.0.1/);
 assert.throws(()=>codexSettings({...cfg,codexApiKeyEnv:'secret-value'},env),/名称/);
});
