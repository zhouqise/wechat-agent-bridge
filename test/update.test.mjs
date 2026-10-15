import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {updatePackage,newer,installPrefix,npmCommand,updateFetcher} from '../update.mjs';
test('版本比较、全局安装前缀和 Windows npm 不经过 shell',async()=>{
 assert.equal(newer('0.13.0','0.12.9'),true);assert.equal(newer('0.9.0','0.13.0'),false);assert.throws(()=>newer('1.0.0;bad','1.0.0'));
 assert.equal(installPrefix('/home/a/lib/node_modules/wx-codex-bridge','linux'),'/home/a');
 assert.equal(installPrefix('C:\\Users\\A B\\node_modules\\wx-codex-bridge','win32'),'C:\\Users\\A B');
 assert.throws(()=>installPrefix('/source/project','linux'),/源码/);
 const command=await npmCommand(['install'],{platform:'win32',node:'C:\\Node\\node.exe',env:{Path:'C:\\Other'},exists:async p=>p==='C:\\Node\\node_modules\\npm\\bin\\npm-cli.js'});
 assert.equal(command.file,'C:\\Node\\node.exe');assert.deepEqual(command.args,['C:\\Node\\node_modules\\npm\\bin\\npm-cli.js','install']);
});
test('更新检查、忙碌、校验失败、安装失败和服务恢复',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'wx-update-test-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const root=path.join(dir,process.platform==='win32'?'':'lib','node_modules','wx-codex-bridge');await fs.mkdir(root,{recursive:true});
 const name='wx-codex-bridge-0.13.0.tgz',base='https://github.com/zhouqise/wechat-agent-bridge/releases/download/v0.13.0/';
 const archive=Buffer.from('fixture');const digest=createHash('sha256').update(archive).digest('hex');
 for(const mode of ['check','current','busy','bad-checksum','install-failure','stopped','running','became-busy']) {
  const events=[];let queries=0;
  await fs.writeFile(path.join(root,'package.json'),JSON.stringify({version:'0.12.0'}));
  const opts={root,current:mode==='current'?'0.13.0':'0.12.0',check:mode==='check',log:()=>{},
   fetcher:async (url,options)=>{
    if(url.includes('/latest'))assert.equal(options.headers.Accept,'application/vnd.github+json');
    events.push('download');if(url.includes('/latest'))return Response.json({tag_name:'v0.13.0',assets:[name,'SHA256SUMS-0.13.0.txt'].map(name=>({name,browser_download_url:base+name}))});
    return new Response(url.endsWith('.tgz')?archive:`${mode==='bad-checksum'?'0'.repeat(64):digest}  ${name}\n`);
   },
   state:async()=>{queries++;return mode==='stopped'?null:{task:mode==='busy'||mode==='became-busy'&&queries>1?'执行中':'空闲'};},
   stop:async()=>events.push('stop'),lock:async()=>events.push('lock'),unlock:async()=>events.push('unlock'),restart:async()=>events.push('restart'),
   resolveNpm:async args=>({file:'mock-npm',args}),run:async(file,args,opts)=>{events.push('install');assert.equal(opts.shell,false);assert.ok(args.includes('--ignore-scripts'));assert.equal(args[args.indexOf('--prefix')+1],dir);if(mode==='install-failure')throw Error('fixture');await fs.writeFile(path.join(root,'package.json'),JSON.stringify({version:'0.13.0'}));}
  };
  if(['busy','bad-checksum','install-failure','became-busy'].includes(mode))await assert.rejects(updatePackage(opts));else await updatePackage(opts);
  if(['check','current','busy','bad-checksum','became-busy'].includes(mode))assert.ok(!events.includes('stop')&&!events.includes('install'));
  if(mode==='running')assert.deepEqual(events.slice(-5),['stop','lock','install','unlock','restart']);
  if(mode==='stopped')assert.ok(events.includes('install')&&!events.includes('restart'));
  if(mode==='install-failure')assert.ok(events.includes('unlock')&&!events.includes('restart'));
 }
});

test('管理接口只在空闲时停止，执行中不停止',async t=>{
 const {serve,control}=await import('../service.mjs');const {paths}=await import('../paths.mjs');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'wx-up-'));const p=paths({WX_CODEX_HOME:dir});
 if(process.platform!=='win32')p.socket=path.join('/tmp',`wx-up-${process.pid}.sock`);
 let task='执行中',stops=0;const server=await serve(p,()=>({task}),()=>stops++);
 t.after(async()=>{await server.close();await fs.rm(dir,{recursive:true,force:true});});
 assert.equal((await control(p,'stop-if-idle')).error,'busy');assert.equal(stops,0);
 task='空闲';assert.equal((await control(p,'stop-if-idle')).stopping,true);assert.equal(stops,1);
});

test('代理下载使用参数调用 curl，错误不暴露代理信息',async()=>{
 const proxy='http://127.0.0.1:7892';let captured;
 const fetcher=updateFetcher(proxy,{platform:'win32',run:async(file,args,opts)=>{captured={file,args,opts};return {stdout:Buffer.from('fixture')};}});
 assert.equal(await (await fetcher('https://github.com/test',{headers:{Accept:'application/octet-stream'}})).text(),'fixture');
 assert.equal(captured.file,'curl.exe');assert.equal(captured.opts.shell,false);assert.ok(captured.args.includes(proxy));
 assert.throws(()=>updateFetcher('http://user:password@example.com'),/账号密码/);
 await assert.rejects(updateFetcher(proxy,{run:async()=>{throw Error('private');}})('https://github.com/test',{headers:{}}),e=>!e.message.includes('private'));
});
