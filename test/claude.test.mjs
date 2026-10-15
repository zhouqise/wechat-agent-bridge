import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {ClaudeRPC,claudeInput,inWorkspace} from '../claude.mjs';
import {engineName,engineState} from '../engines.mjs';
function mock() {
  const child=new EventEmitter();Object.assign(child,{stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough(),kill:()=>{child.killed=true;}});
  return child;
}
async function setup(t) {
  const cwd=await fs.mkdtemp(path.join(os.tmpdir(),'wxc-cl-'));t.after(()=>fs.rm(cwd,{recursive:true,force:true}));
  const children=[],calls=[],events=[],requests=[];
  const rpc=new ClaudeRPC({cwd,model:'sonnet',binary:'fake-claude.exe',check:async()=>({stdout:'test'}),spawnFn:(file,args,options)=>{calls.push({file,args,options});const child=mock();children.push(child);return child;}});
  rpc.on('notification',m=>events.push(m));rpc.on('request',m=>requests.push(m));t.after(()=>rpc.close());
  await rpc.initialize();await rpc.request('thread/start',{});
  await rpc.request('turn/start',{input:[{type:'text',text:'test'}]});
  return {rpc,child:children[0],children,calls,events,requests,cwd};
}
test('Claude 启动使用受控工具与默认权限，握手成功后传入文本和图片',async t=>{
  const {rpc,child,calls}=await setup(t);let written='';child.stdin.on('data',b=>written+=b);
  assert.equal(calls[0].options.shell,false);
  const args=calls[0].args;assert.equal(args[args.indexOf('--model')+1],'sonnet');assert.equal(args[args.indexOf('--permission-mode')+1],'default');
  assert.equal(args[args.indexOf('--setting-sources')+1],'user');
  assert.ok(args.includes('--strict-mcp-config'));assert.ok(args.includes('--disable-slash-commands'));
  assert.deepEqual(JSON.parse(args[args.indexOf('--settings')+1]).permissions.ask,['Read','Glob','Grep','Bash','Edit','Write']);
  await rpc.message(rpc.run,{type:'control_response',response:{request_id:'initialize',subtype:'success'}});
  await new Promise(r=>setImmediate(r));
  assert.match(written,/"type":"user"/);
  assert.deepEqual(claudeInput([{type:'image',url:'data:image/png;base64,YQ=='}]),[{type:'image',source:{type:'base64',media_type:'image/png',data:'YQ=='}}]);
  assert.throws(()=>claudeInput([{type:'image',url:'https://example.test/image'}]));
});
test('Claude 工具必须确认，拒绝后不能再次批准；不支持的请求默认拒绝',async t=>{
  const {rpc,requests,child}=await setup(t);let written='';child.stdin.on('data',b=>written+=b);
  await rpc.message(rpc.run,{type:'control_request',request_id:'r1',request:{subtype:'can_use_tool',tool_name:'Write',input:{file_path:'new.txt',content:'hello'}}});
  assert.equal(requests.length,1);assert.equal(requests[0].method,'bridge/tool/requestApproval');
  rpc.respond('r1',{decision:'decline'});const before=written;rpc.respond('r1',{decision:'accept'});assert.equal(written,before);assert.match(written,/"behavior":"deny"/);
  await rpc.message(rpc.run,{type:'control_request',request_id:'r2',request:{subtype:'can_use_tool',tool_name:'WebFetch',input:{}}});
  assert.equal(requests.length,1);assert.match(written,/Unsupported request/);
});
test('工作区外路径和符号链接不进入审批',async t=>{
  const {rpc,cwd,requests}=await setup(t);
  assert.equal(await inWorkspace(cwd,'new/file.txt'),true);assert.equal(await inWorkspace(cwd,'../outside'),false);
  if(process.platform!=='win32') {await fs.symlink(os.tmpdir(),path.join(cwd,'outside'));assert.equal(await inWorkspace(cwd,'outside/test'),false);}
  await rpc.message(rpc.run,{type:'control_request',request_id:'outside',request:{subtype:'can_use_tool',tool_name:'Read',input:{file_path:'../secret'}}});assert.equal(requests.length,0);
});
test('Claude 结果、恢复会话和取消相互隔离，旧进程退出不覆盖新任务',async t=>{
  const {rpc,child,calls,events}=await setup(t);const previous=rpc.run;
  await rpc.message(previous,{type:'result',subtype:'success',is_error:false,result:'done'});
  assert.equal(events.at(-1).params.turn.status,'completed');assert.equal(child.killed,true);
  await rpc.request('turn/start',{input:[{type:'text',text:'continue'}]});assert.ok(calls[1].args.includes('--resume'));
  child.emit('exit');assert.ok(rpc.run);
  await rpc.request('turn/interrupt',{turnId:rpc.run.turnId});assert.equal(events.at(-1).params.turn.status,'interrupted');assert.equal(rpc.run,null);
});
test('Codex 与 Claude 状态独立保存；切换或重置不覆盖其他引擎',()=>{
  const state={codex:{threadId:'codex-session',workspace:'/a'}};
  engineState(state,'claude','/a').threadId='claude-session';
  assert.equal(engineState(state,'codex','/a').threadId,'codex-session');
  assert.equal(engineState(state,'claude','/b').threadId,undefined);
  assert.equal(state.codex.threadId,'codex-session');assert.throws(()=>engineName('other'));
});
test('API 模式缺少密钥时明确失败，不回退到本机登录',async()=>{
  const rpc=new ClaudeRPC({auth:'api',check:async()=>{}});delete rpc.env.ANTHROPIC_API_KEY;
  await assert.rejects(rpc.initialize(),/ANTHROPIC_API_KEY/);assert.equal(rpc.env.CLAUDE_CODE_OAUTH_TOKEN,undefined);assert.equal(rpc.env.ANTHROPIC_AUTH_TOKEN,undefined);
});
test('API 模式仅向子进程传密钥，不加载本机用户配置，不写入会话结果',async t=>{
  let captured;
  const rpc=new ClaudeRPC({auth:'api',binary:'fake.exe',check:async()=>({}),spawnFn:(file,args,options)=>{captured={args,options};return mock();}});t.after(()=>rpc.close());
  rpc.env.ANTHROPIC_API_KEY='test-key-never-real';await rpc.initialize();
  await rpc.request('thread/start',{});await rpc.request('turn/start',{input:[{type:'text',text:'hi'}]});
  assert.equal(captured.args[captured.args.indexOf('--setting-sources')+1],'');
  assert.equal(captured.options.env.ANTHROPIC_API_KEY,'test-key-never-real');
  assert.equal(captured.args.some(a=>a.includes('test-key-never-real')),false);
});
test('Claude 模型目录只初始化独立子进程，不发送任务，完成后清理',async()=>{
 let child,written='',args;
 const rpc=new ClaudeRPC({cwd:process.cwd(),binary:'fake-claude.exe',spawnFn:(file,a)=>{args=a;child=mock();child.stdin.on('data',b=>written+=b);return child;}});
 rpc.observedModel='claude-observed';
 const pending=rpc.request('model/list');
 child.stdout.write(JSON.stringify({type:'control_response',response:{request_id:'catalog',subtype:'success',response:{models:[{value:'sonnet[1m]',displayName:'Sonnet'}],account:{secret:'must-not-return'}}}})+'\n');
 const result=await pending;
 assert.equal(result.data[0].model,'sonnet[1m]');assert.equal(result.currentModel,'claude-observed');
 assert.ok(!JSON.stringify(result).includes('must-not-return'));assert.ok(args.includes('--no-session-persistence'));
 assert.equal(JSON.parse(written).request.subtype,'initialize');assert.ok(!written.includes('"type":"user"'));assert.equal(child.killed,true);assert.equal(rpc.run,undefined);rpc.close();
});
test('模型目录子进程退出或关闭时拒绝查询，不影响任务状态',async()=>{
 let child;const rpc=new ClaudeRPC({binary:'fake-claude.exe',spawnFn:()=>{child=mock();return child;}});
 const pending=rpc.request('model/list');child.emit('exit');await assert.rejects(pending,/目录查询失败/);
 const next=rpc.request('model/list');rpc.close();await assert.rejects(next,/目录查询失败/);assert.equal(child.killed,true);
});
test('实际模型仅从匹配会话的 system/init 读取',async t=>{
 const {rpc}=await setup(t);await rpc.message(rpc.run,{type:'system',subtype:'init',session_id:'wrong',model:'wrong-model'});assert.equal(rpc.observedModel,undefined);
 await rpc.message(rpc.run,{type:'system',subtype:'init',session_id:rpc.threadId,model:'actual-model'});assert.equal(rpc.observedModel,'actual-model');
});
