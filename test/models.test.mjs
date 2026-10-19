import {test} from 'node:test';
import assert from 'node:assert/strict';
import {modelListText} from '../models.mjs';
test('Codex 列表读取 model ID，过滤隐藏/非法项并去重',async()=>{
 const text=await modelListText({codexModel:'chosen'},'codex',{request:async(method,params)=>{assert.equal(method,'model/list');assert.equal(params.includeHidden,false);return {data:[{id:'picker',model:'actual-model'},{model:'actual-model'},{model:'hidden',hidden:true},{model:'bad\ntext'}],nextCursor:'more'};}});
 assert.match(text,/模型设置：chosen/);assert.equal(text.split('/模型 actual-model').length,2);assert.ok(!text.includes('/模型 picker'));assert.ok(!text.includes('/模型 hidden'));assert.match(text,/首批/);
});
test('API 不误用 Codex 官方目录，Claude 别名标明非授权清单',async()=>{
 const text=await modelListText({codexAuth:'api'},'codex',{request:()=>{throw Error('must not call');}});
 assert.match(text,/服务商控制台/);
 const claude=await modelListText({},'claude',{request:async()=>{throw Error('unavailable');}});assert.match(claude,/\/模型 sonnet/);assert.match(claude,/不是账号授权清单/);
});
test('目录失败/空结果不抛出底层错误或改变当前模型',async()=>{
 for(const rpc of [{request:async()=>{throw Error('private-secret');}},{request:async()=>({data:[]})}]) {
 const config={codexModel:'keep'};const text=await modelListText(config,'codex',rpc);assert.match(text,/暂时无法/);assert.ok(!text.includes('private-secret'));assert.equal(config.codexModel,'keep');
 }
});

test('Claude 使用真实目录，支持上下文后缀并区分最近实际模型',async()=>{
 const text=await modelListText({claudeModel:'sonnet[1m]'},'claude',{request:async()=>({data:[{model:'default'},{model:'sonnet[1m]'},{model:'haiku'}],currentModel:'claude-actual'})});
 assert.match(text,/\/模型 sonnet\[1m\]/);assert.match(text,/\/模型 haiku/);assert.match(text,/最近任务实际模型：claude-actual/);assert.ok(!text.includes('备用'));
});

test('结构化模型目录不把备用别名当授权模型',async()=>{
 const {modelListResult}=await import('../models.mjs');const good=await modelListResult({},'codex',{request:async()=>({data:[{model:'one'},{model:'two',hidden:true}]})});assert.deepEqual(good.items,[{id:'one',label:'one'}]);assert.equal(good.source,'cli');assert.match(good.text,/\/模型 one/);
 const bad=await modelListResult({},'claude',{request:async()=>{throw Error('private');}});assert.deepEqual(bad.items,[]);assert.equal(bad.source,'unavailable');assert.ok(!bad.text.includes('private'));
});
