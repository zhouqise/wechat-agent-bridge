import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {CodexRPC} from '../rpc.mjs';

function setup() {
  const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{};
  let options;
  const rpc=new CodexRPC({cwd:'/tmp/test',binary:'fake-codex.exe',proxy:'http://127.0.0.1:7890',spawnFn:(bin,args,opts)=>{options=opts;assert.deepEqual(args,['app-server','--stdio']);return child;}});
  return {rpc,child,options};
}
test('RPC 乱序响应按 ID 匹配，任务文本不进入 shell 参数', async()=>{
  const {rpc,child,options}=setup();
  const first=rpc.request('one'), second=rpc.request('two');
  child.stdout.write('{"id":2,"result":{"v":2}}\n{"id":1,"result":{"v":1}}\n');
  assert.deepEqual(await first,{v:1});assert.deepEqual(await second,{v:2});
  assert.equal(options.shell,false);assert.equal(options.env.HTTPS_PROXY,'http://127.0.0.1:7890');rpc.close();
});
test('服务器请求与通知独立分发，进程退出拒绝等待中的请求', async()=>{
  const {rpc,child}=setup();let approval,notification;
  rpc.on('request',m=>approval=m);rpc.on('notification',m=>notification=m);
  child.stdout.write('{"id":99,"method":"approval","params":{}}\n{"method":"turn/completed","params":{}}\n');
  assert.equal(approval.id,99);assert.equal(notification.method,'turn/completed');
  const pending=rpc.request('pending');child.emit('exit');await assert.rejects(pending,/断开/);rpc.close();
});

test('API provider 密钥只在环境中，恢复会话明确使用新 provider 和模型', async()=>{
  const old=process.env.WX_TEST_API_KEY;process.env.WX_TEST_API_KEY='fake-private-test-key';
  let args,options;
  const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{};
  const rpc=new CodexRPC({binary:'fake-codex.exe',config:{codexAuth:'api',codexModel:'test-model',codexBaseUrl:'https://example.com/v1',codexApiKeyEnv:'WX_TEST_API_KEY'},spawnFn:(bin,a,o)=>{args=a;options=o;return child;}});
  try {
    assert.equal(options.env.WX_TEST_API_KEY,'fake-private-test-key');
    assert.ok(!JSON.stringify(args).includes('fake-private-test-key'));
    assert.match(args.join(' '),/requires_openai_auth = false/);
    let wire='';child.stdin.on('data',b=>wire+=b);
    const result=rpc.request('thread/resume',{threadId:'existing',model:'old',modelProvider:'openai'});
    const message=JSON.parse(wire);assert.equal(message.params.model,'test-model');assert.equal(message.params.modelProvider,'wx_agent_api');
    child.stdout.write(JSON.stringify({id:message.id,result:{thread:{id:'existing'}}})+'\n');await result;
  }finally {rpc.close();if(old===undefined)delete process.env.WX_TEST_API_KEY;else process.env.WX_TEST_API_KEY=old;}
});

test('本机登录模式切换模型同时覆盖恢复会话与后续任务',async()=>{
 const {rpc,child}=setup();rpc.settings={auth:'local',model:'chosen-model',args:[]};
 let wire='';child.stdin.on('data',b=>wire+=b);
 for(const method of ['thread/resume','turn/start']) {
   wire='';const result=rpc.request(method,{model:'old'});const message=JSON.parse(wire);
   assert.equal(message.params.model,'chosen-model');assert.equal(message.params.modelProvider,undefined);
   child.stdout.write(JSON.stringify({id:message.id,result:{}})+'\n');await result;
 }rpc.close();
});
