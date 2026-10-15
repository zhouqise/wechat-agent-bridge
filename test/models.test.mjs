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
 const claude=await modelListText({},'claude');assert.match(claude,/\/模型 sonnet/);assert.match(claude,/不是账号授权清单/);
});
test('目录失败/空结果不抛出底层错误或改变当前模型',async()=>{
 for(const rpc of [{request:async()=>{throw Error('private-secret');}},{request:async()=>({data:[]})}]) {
 const config={codexModel:'keep'};const text=await modelListText(config,'codex',rpc);assert.match(text,/暂时无法/);assert.ok(!text.includes('private-secret'));assert.equal(config.codexModel,'keep');
 }
});
