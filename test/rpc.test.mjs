import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {CodexRPC} from '../rpc.mjs';

function setup() {
  const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{};
  let options;
  const rpc=new CodexRPC({cwd:'/tmp/test',proxy:'http://127.0.0.1:7890',spawnFn:(bin,args,opts)=>{options=opts;assert.deepEqual(args,['app-server','--stdio']);return child;}});
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
