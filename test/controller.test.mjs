import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {Controller} from '../controller.mjs';

class FakeRPC extends EventEmitter {
  calls = []; replies = [];
  async initialize() {}
  async request(method, params) {
    this.calls.push({method,params});
    if (method.startsWith('thread/')) return {thread:{id:'thread1'}};
    if (method === 'turn/start') return {turn:{id:'turn1'}};
    return {};
  }
  respond(id, result) {this.replies.push({id,result});}
  reject(id) {this.replies.push({id,rejected:true});}
  close() {}
}
async function setup(opts={}) {
  const rpc = new FakeRPC(), messages = [], saved = [];
  const controller = new Controller({rpc,cwd:'/tmp/test-workspace',save:async s=>saved.push(structuredClone(s)),send:async s=>messages.push(s), ...opts});
  await controller.initialize();
  return {controller,rpc,messages,saved};
}
test('正常任务的完成、持续对话及新的会话', async () => {
  const {controller:c,rpc,messages} = await setup();
  await c.handle('你好','msg1');await c.starting;
  assert.equal(rpc.calls[0].params.approvalPolicy,'on-request');
  assert.equal(rpc.calls[1].params.sandboxPolicy.networkAccess,false);
  await c.event({method:'item/completed',params:{threadId:'thread1',turnId:'turn1',item:{id:'a',type:'agentMessage',phase:'final_answer',text:'你好！'}}});
  await c.event({method:'turn/completed',params:{threadId:'thread1',turn:{id:'turn1',status:'completed'}}});
  assert.ok(messages.includes('任务完成\n你好！'));
  await c.handle('继续','msg2');await c.starting;
  assert.equal(rpc.calls.filter(x=>x.method==='thread/start').length,1);
  await c.event({method:'turn/completed',params:{threadId:'thread1',turn:{id:'turn1',status:'completed'}}});
  await c.handle('/新会话');assert.equal(c.state.threadId,null);
});
test('忙碌时拒绝第二个任务，但接受取消命令', async () => {
  const {controller:c,rpc} = await setup();
  await c.handle('任务','msg1');await c.starting;
  await c.handle('不能重复执行','msg2');await c.handle('/取消');
  assert.equal(rpc.calls.filter(x=>x.method==='turn/start').length,1);
  assert.equal(rpc.calls.at(-1).method,'turn/interrupt');
});
test('审批绑定活动任务，批准仅一次；过期编号不能复用', async () => {
  const {controller:c,rpc} = await setup();
  await c.handle('任务','msg');await c.starting;
  const m = {id:9,method:'item/commandExecution/requestApproval',params:{threadId:'thread1',turnId:'turn1',command:'echo hello',cwd:'/tmp/test-workspace'}};
  await c.approveRequest(m);assert.equal(rpc.replies.length,0);
  const code = [...c.approvals.keys()][0];
  await c.answer(`/批准 ${code}`);assert.deepEqual(rpc.replies[0],{id:9,result:{decision:'accept'}});
  await c.answer(`/批准 ${code}`);assert.equal(rpc.replies.length,1);
  await c.approveRequest({...m,id:10,params:{...m.params,threadId:'other'}});
  assert.equal(rpc.replies[1].result.decision,'decline');
});
test('超时审批拒绝，权限扩张请求默认拒绝', async () => {
  const {controller:c,rpc} = await setup({approvalMs:10});
  await c.handle('任务','msg');await c.starting;
  await c.approveRequest({id:1,method:'item/commandExecution/requestApproval',params:{threadId:'thread1',turnId:'turn1',command:'echo hello'}});
  await new Promise(r=>setTimeout(r,25));
  assert.equal(rpc.replies[0].result.decision,'decline');
  await c.approveRequest({id:2,method:'item/permissions/requestApproval',params:{threadId:'thread1',turnId:'turn1'}});
  assert.deepEqual(rpc.replies[1].result,{permissions:{},scope:'turn'});
});
test('重启不自动重跑旧任务；指定会话恢复', async () => {
  const {controller:c,rpc,saved} = await setup({state:{threadId:'thread1',active:{startedAt:1}}});
  assert.equal(saved[0].active,null); assert.equal(rpc.calls.length,0);
  await c.handle('继续','msg');await c.starting;
  assert.equal(rpc.calls[0].method,'thread/resume');
});
test('审批通知发送失败即拒绝，不能批准未完整送达的操作', async () => {
  const {controller:c,rpc} = await setup({send:async()=>{throw new Error('offline');}});
  await c.handle('任务','msg');await c.starting;
  await c.approveRequest({id:15,method:'item/commandExecution/requestApproval',params:{threadId:'thread1',turnId:'turn1',command:'echo hello'}});
  assert.equal(c.approvals.size,0);
  assert.equal(rpc.replies[0].result.decision,'decline');
});
test('过期任务的完成事件不会结束当前任务；输入回答按问题 ID 回传', async () => {
  const {controller:c,rpc} = await setup();
  await c.handle('任务','msg');await c.starting;
  await c.event({method:'turn/completed',params:{threadId:'thread1',turn:{id:'old',status:'completed'}}});
  assert.ok(c.active);
  await c.approveRequest({id:20,method:'item/tool/requestUserInput',params:{threadId:'thread1',turnId:'turn1',questions:[{id:'choice',question:'哪一种？'}]}});
  const code=[...c.approvals.keys()][0];await c.answer(`/回答 ${code} 第一种`);
  assert.deepEqual(rpc.replies[0].result,{answers:{choice:{answers:['第一种']}}});
});
test('截图异步下载期间可查询状态，图片与文字一起传给 Codex',async()=>{
  const {controller:c,rpc,messages}=await setup();let finish;
  const image={type:'image',url:'data:image/png;base64,fixture'};
  await c.handle('解释报错','image1',()=>new Promise(r=>finish=r));
  await new Promise(r=>setImmediate(r));
  await c.handle('/状态');
  let downloaded=false;await c.handle('second','image2',async()=>{downloaded=true;return [image];});
  assert.equal(downloaded,false);assert.ok(messages.some(m=>m.includes('正在接收图片')));
  finish([image]);await c.starting;
  assert.deepEqual(rpc.calls.find(x=>x.method==='turn/start').params.input,[{type:'text',text:'解释报错'},image]);
});
test('图片失败给予反馈并释放任务，不关闭 Codex 或提交不完整任务',async()=>{
  const {controller:c,rpc,messages}=await setup();
  await c.handle('','bad',async()=>{throw new Error('图片解密失败，请重新发送截图。');});await c.starting;
  assert.equal(c.active,null);assert.equal(c.ready,true);assert.equal(rpc.calls.length,0);
  assert.ok(messages.some(m=>m.includes('截图处理失败')));
  await c.handle('','good',async()=>[{type:'image',url:'data:image/png;base64,test'}]);await c.starting;
  assert.match(rpc.calls.find(x=>x.method==='turn/start').params.input[0].text,/请分析/);
});
test('Claude 标签只影响系统提示，不改写模型结果中的 Codex 文字',async()=>{
  const {controller:c,messages}=await setup({label:'Claude Code'});
  await c.handle('test','label');await c.starting;
  assert.ok(messages.some(x=>x.startsWith('Claude Code 已接收')));
  await c.event({method:'item/completed',params:{threadId:'thread1',turnId:'turn1',item:{id:'final',type:'agentMessage',phase:'final_answer',text:'Codex 与 Claude 不同'}}});
  await c.event({method:'turn/completed',params:{threadId:'thread1',turn:{id:'turn1',status:'completed'}}});
  assert.equal(messages.at(-1),'任务完成\nCodex 与 Claude 不同');
});
