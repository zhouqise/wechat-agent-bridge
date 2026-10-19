import {test} from 'node:test';
import assert from 'node:assert/strict';
import {WorkspaceTransition} from '../workspace-transition.mjs';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
for(const stage of ['initialize','persist','commit'])test('停止与 '+stage+' 竞争：等待完成再清理',async()=>{
 const entered=deferred(),gate=deferred(),calls=[];let stopping=false;
 const step=async name=>{calls.push(name);if(name===stage){entered.resolve();await gate.promise;}};
 const candidate={ready:true,initialize:()=>step('initialize'),close:()=>calls.push('close')};
 const tr=new WorkspaceTransition({isStopping:()=>stopping,prepare:async()=>({}),create:()=>candidate,persist:()=>step('persist'),commit:()=>step('commit'),publish:()=>{calls.push('publish');return {ok:true};}});
 const op=tr.run();const observed=op.catch(e=>e);await entered.promise;stopping=true;let settled=false;const closing=tr.wait().then(()=>settled=true);await Promise.resolve();assert.equal(settled,false);gate.resolve();const result=await observed;await closing;
 if(stage==='commit'){assert.equal(result.ok,true);assert.ok(calls.includes('publish'));assert.ok(!calls.includes('close'));}else{assert.ok(result instanceof Error);assert.ok(!calls.includes('commit'));assert.ok(calls.includes('close'));}
});
for(const stage of ['initialize','persist','commit'])test(stage+' 失败不发布并关闭候选',async()=>{
 const calls=[],candidate={ready:true,initialize:async()=>{if(stage==='initialize')throw Error('fail');},close:()=>calls.push('close')};
 const tr=new WorkspaceTransition({isStopping:()=>false,prepare:async()=>({}),create:()=>candidate,persist:async()=>{if(stage==='persist')throw Error('fail');},commit:async()=>{if(stage==='commit')throw Error('fail');},publish:()=>calls.push('publish')});await assert.rejects(tr.run());assert.deepEqual(calls,['close']);
});
test('重复运行拒绝，同目录不创建连接',async()=>{
 const gate=deferred();const tr=new WorkspaceTransition({isStopping:()=>false,prepare:()=>gate.promise,create:()=>assert.fail(),publish:()=>assert.fail()});const op=tr.run();await assert.rejects(tr.run(),/切换/);gate.resolve({unchanged:true,result:{ok:true}});assert.deepEqual(await op,{ok:true});
});
test('IPC 中文路径跨分块无损，长目录请求可达业务层，超限拒绝',async t=>{
 const {default:fs}=await import('node:fs/promises'),{default:os}=await import('node:os'),{default:path}=await import('node:path'),{default:net}=await import('node:net');
 const {paths,readJSON}=await import('../paths.mjs'),{serve}=await import('../service.mjs');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'wxipc-')),p=paths({WX_CODEX_HOME:dir});let calls=0;
 const server=await serve(p,()=>({}),()=>{},null,null,request=>{calls++;return {value:request.value};});t.after(async()=>{await server.close();await fs.rm(dir,{force:true,recursive:true});});
 const token=(await readJSON(p.controlToken)).token,value='/中文目录/'+ 'a'.repeat(900),buffer=Buffer.from(JSON.stringify({command:'admin',action:'workspace',token,value})+'\n');
 const out=await new Promise((resolve,reject)=>{const socket=net.createConnection(p.socket);socket.setEncoding('utf8');let result='';socket.on('error',reject);socket.on('data',b=>result+=b);socket.on('end',()=>resolve(result));socket.on('connect',()=>{const split=buffer.indexOf(Buffer.from('中'))+1;socket.write(buffer.subarray(0,split));setTimeout(()=>socket.end(buffer.subarray(split)),10);});});
 assert.equal(JSON.parse(out).value,value);assert.equal(calls,1);
 await new Promise((resolve,reject)=>{const socket=net.createConnection(p.socket);socket.on('error',reject);socket.on('close',resolve);socket.on('connect',()=>socket.write('x'.repeat(8193)));});assert.equal(calls,1);
});
