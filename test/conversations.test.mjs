import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {Controller} from '../controller.mjs';
import {ensureConversations,changeConversation,conversationList,syncConversation} from '../conversations.mjs';
import {engineState} from '../engines.mjs';
test('迁移旧会话、分页、切换和删除保留其他上下文',()=>{
 const state={threadId:'legacy',lastResult:'old'};const first=ensureConversations(state).id;
 changeConversation(state,'new','第二个');const second=state.currentConversation;state.threadId='second-thread';state.lastResult='second-result';syncConversation(state,'hello');
 changeConversation(state,'switch',first);assert.equal(state.threadId,'legacy');assert.equal(state.lastResult,'old');
 changeConversation(state,'delete',second);assert.equal(state.currentConversation,first);assert.throws(()=>changeConversation(state,'switch',second),/不存在/);
 for(let i=0;i<12;i++)changeConversation(state,'new','session '+i);assert.match(conversationList(state,2),/2\/2/);assert.throws(()=>conversationList(state,0),/页码/);
 const restored=JSON.parse(JSON.stringify(state));changeConversation(restored,'switch',first);assert.equal(restored.threadId,'legacy');
});
test('删除当前或最后一个会话、新用户/项目/引擎隔离',()=>{
 const root={},a=engineState(root,'codex','/one'),b=engineState(root,'claude','/one'),c=engineState(root,'codex','/two'),other={};
 const id=ensureConversations(a).id;for(const s of [b,c,other])assert.throws(()=>changeConversation(s,'switch',id),/不存在/);
 changeConversation(a,'delete',id);assert.notEqual(a.currentConversation,id);assert.equal(a.threadId,null);assert.equal(a.conversations.length,1);
 const blank=a.currentConversation;changeConversation(a,'new','other');changeConversation(a,'delete',a.currentConversation);assert.equal(a.currentConversation,blank);
});
test('Controller 恢复正确线程、结果隔离、忙碌拒绝、保存失败回滚',async()=>{
 class RPC extends EventEmitter{calls=[];n=0;async initialize(){}async request(m,p){this.calls.push({m,p});if(m==='thread/start')return {thread:{id:'t'+ ++this.n}};if(m==='thread/resume')return {thread:{id:p.threadId}};return {turn:{id:'u'}};}close(){}}
 const rpc=new RPC(),messages=[];let fail=false;const c=new Controller({rpc,cwd:'/tmp/conversations',save:async()=>{if(fail)throw Error('disk');},send:async s=>messages.push(s)});await c.initialize();
 await c.handle('first task','k');await c.starting;const first=c.state.currentConversation;
 await c.handle('/新会话 busy');assert.equal(c.state.currentConversation,first);assert.match(messages.at(-1),/正在执行/);
 await c.event({method:'turn/completed',params:{threadId:'t1',turn:{id:'u',status:'completed'}}});
 await c.handle('/新会话 second');const second=c.state.currentConversation;assert.notEqual(second,first);await c.handle('/结果');assert.match(messages.at(-1),/没有/);
 await c.handle('second task','k2');await c.starting;await c.event({method:'turn/completed',params:{threadId:'t2',turn:{id:'u',status:'completed'}}});
 await c.handle('/切换会话 '+first);await c.handle('continue','k3');await c.starting;assert.equal(rpc.calls.findLast(x=>x.m==='thread/resume').p.threadId,'t1');await c.event({method:'turn/completed',params:{threadId:'t1',turn:{id:'u',status:'completed'}}});
 fail=true;await c.handle('/删除会话 '+first);assert.equal(c.state.currentConversation,first);assert.ok(c.state.conversations.some(s=>s.id===first));assert.match(messages.at(-1),/未完成/);c.close();
});
test('可复制命令与固定短序号：排序、重启和删除后不指向别的会话',()=>{
 const state={threadId:'old'};const first=ensureConversations(state);assert.equal(first.number,1);
 changeConversation(state,'new','第二个');syncConversation(state);const second=state.currentConversation;
 assert.match(conversationList(state),/ID：/);assert.match(conversationList(state),/\/切换会话 2/);assert.ok(conversationList(state).includes('/删除会话 '+second));
 changeConversation(state,'switch','1');assert.equal(state.currentConversation,first.id);changeConversation(state,'switch','2');assert.equal(state.currentConversation,second);
 const restored=JSON.parse(JSON.stringify(state));changeConversation(restored,'delete','1');assert.throws(()=>changeConversation(restored,'switch','1'),/不存在/);
 changeConversation(restored,'new','第三个');syncConversation(restored);assert.equal(ensureConversations(restored).number,3);assert.equal(restored.conversations.find(c=>c.id===second).number,2);
});
