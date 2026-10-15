import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {TaskQueue} from '../task-queue.mjs';
import {addProject,projectPath} from '../projects.mjs';
import {engineState} from '../engines.mjs';
import {outputSnapshot,returnFiles} from '../auto-files.mjs';
import {Controller} from '../controller.mjs';
import {EventEmitter} from 'node:events';
const tick=()=>new Promise(r=>setTimeout(r,5));
async function until(fn){for(let i=0;i<200;i++){if(fn())return;await tick();}throw Error('timeout');}
test('附件与连续说明合并、立即提交、每用户串行且保持任务上下文',async t=>{
 const runs=[],ends=[],messages=[],state={};const q=new TaskQueue({state,textMs:1000,mediaMs:1000,say:async s=>messages.push(s),run:task=>{runs.push(task);return new Promise(r=>ends.push(r));}});t.after(()=>q.close());
 await q.enqueue('',[{type:4,file_item:{file_name:'a.pdf'}}],'one','context-one');
 await q.enqueue('总结此文件',[],'two','context-two');assert.equal(q.pending.length,1);
 await q.command('/开始');await until(()=>runs.length===1);
 assert.equal(runs[0].text,'总结此文件');assert.equal(runs[0].items.length,1);assert.equal(runs[0].contextToken,'context-two');
 await q.enqueue('第二项',[],'three','context-three');await q.command('/开始');await tick();assert.equal(runs.length,1);
 const other=new TaskQueue({say:async()=>{},run:async()=>{runs.push({other:true});}});t.after(()=>other.close());await other.enqueue('别人的任务',[],'other','other');await other.command('/开始');await until(()=>runs.length===2);
 ends[0]();await until(()=>runs.length===3);assert.equal(runs[2].text,'第二项');assert.equal(runs[2].contextToken,'context-three');ends[1]();await until(()=>!q.busy);assert.equal(state.waiting,0);assert.equal(state.running,null);
});
test('队列取消、容量、关闭和重启不会重放旧任务',async t=>{
 let runs=0;const messages=[],state={waiting:2,running:'old'};const q=new TaskQueue({state,say:async s=>messages.push(s),run:async()=>{runs++;},mediaMs:10000,textMs:10000});t.after(()=>q.close());
 await q.enqueue('new',[],'1','c');assert.match(messages[0],/3 个/);assert.equal(runs,0);
 const id=q.pending[0].id;await q.command('/任务');assert.ok(messages.at(-1).includes(id));
 await q.command('/取消 '+id);assert.equal(q.pending.length,0);
 for(let i=0;i<10;i++){await q.enqueue(String(i),[],'k','c');q.pending.at(-1).sealed=true;}
 await q.enqueue('overflow',[],'k','c');assert.equal(q.pending.length,10);assert.match(messages.at(-1),/已满/);
 await q.command('/清空队列');assert.equal(q.busy,false);q.close();await q.enqueue('closed',[],'k','c');assert.equal(q.pending.length,0);
});
test('合并上限拒绝新附件而保留已接收任务',async t=>{
 const messages=[],q=new TaskQueue({say:async s=>messages.push(s),run:async()=>{}});t.after(()=>q.close());
 await q.enqueue('',Array.from({length:4},()=>({type:2})),'a','c');await q.enqueue('',[{type:2}],'b','c');assert.equal(q.pending[0].items.length,4);assert.match(messages.at(-1),/超过限制/);
});
test('项目仅允许登记目录，各引擎/项目上下文及重启恢复独立',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'wxproj-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const one=path.join(dir,'one'),two=path.join(dir,'two');await fs.mkdir(one);await fs.mkdir(two);
 const c=await addProject({workspace:one},'测试',two);assert.equal(await projectPath(c,one,'测试'),await fs.realpath(two));await assert.rejects(projectPath(c,one,'unknown'),/未登记/);await assert.rejects(addProject(c,'../bad',two));await assert.rejects(addProject(c,'__proto__',two));
 let state={codex:{threadId:'legacy',workspace:one}};
 assert.equal(engineState(state,'codex',one).threadId,'legacy');engineState(state,'codex',two).threadId='other';engineState(state,'claude',two).threadId='claude';
 state=JSON.parse(JSON.stringify(state));assert.equal(engineState(state,'codex',one).threadId,'legacy');assert.equal(engineState(state,'codex',two).threadId,'other');assert.equal(engineState(state,'claude',two).threadId,'claude');
});
test('自动回传仅限新增/修改文件，跳过旧文件和链接，失败不重试且最多5份',async t=>{
 const cwd=await fs.mkdtemp(path.join(os.tmpdir(),'wxout-'));t.after(()=>fs.rm(cwd,{recursive:true,force:true}));const dir=path.join(cwd,'wx-agent-output');await fs.mkdir(dir);await fs.writeFile(path.join(dir,'old.md'),'old');await fs.writeFile(path.join(dir,'edit.txt'),'before');
 const before=await outputSnapshot(cwd);await fs.writeFile(path.join(dir,'edit.txt'),'after');for(let i=0;i<6;i++)await fs.writeFile(path.join(dir,`new${i}.txt`),'new');await fs.link(path.join(dir,'old.md'),path.join(dir,'hard.txt'));
 const sent=[],messages=[];await returnFiles({cwd,before,send:async n=>{sent.push(n);if(n==='edit.txt')throw Error('uncertain');},say:async s=>messages.push(s)});
 assert.equal(sent.length,5);assert.equal(sent.filter(n=>n==='edit.txt').length,1);assert.ok(!sent.includes('old.md')&&!sent.includes('hard.txt'));assert.match(messages.join('\n'),/不会自动重发/);assert.match(messages.join('\n'),/超过 5/);
});
test('完成回传期间仍占用当前任务，迟到完成事件不会再次发送',async()=>{
 class RPC extends EventEmitter{async initialize(){} async request(m){return m.startsWith('thread/')?{thread:{id:'t'}}:{turn:{id:'u'}};}close(){}}
 let release,finishes=0,settled=0;const c=new Controller({rpc:new RPC(),cwd:os.tmpdir(),send:async()=>{},save:async()=>{},onFinish:()=>{finishes++;return new Promise(r=>release=r);}});await c.initialize();await c.handle('task','k');await c.starting;c.onSettled=()=>settled++;
 const event={method:'turn/completed',params:{threadId:'t',turn:{id:'u',status:'completed'}}};const finishing=c.event(event);await until(()=>finishes===1);assert.ok(c.active);assert.equal(settled,0);release();await finishing;assert.equal(c.active,null);assert.equal(settled,1);await c.event(event);assert.equal(finishes,1);c.close();
});
