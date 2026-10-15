import {test} from 'node:test';
import assert from 'node:assert/strict';
import {paths} from '../paths.mjs';
import {codexCommand,stopChild} from '../platform.mjs';

test('Windows 使用用户数据目录及稳定命名管道，路径含空格和中文',()=>{
  const home='C:\\Users\\测试 用户';
  const a=paths({},'win32',home);
  assert.equal(a.dir,home+'\\AppData\\Local\\wx-codex');
  assert.match(a.socket,/^\\\\\.\\pipe\\wx-codex-[a-f0-9]{32}$/);
  const b=paths({WX_CODEX_HOME:'D:\\数据\\bridge'},'win32',home);
  assert.equal(b.config,'D:\\数据\\bridge\\config.json');
  assert.notEqual(a.socket,b.socket);
  assert.equal(b.socket,paths({WX_CODEX_HOME:'d:\\数据\\BRIDGE'},'win32',home).socket);
});
test('Windows npm shim 通过 Node 启动 JS，无 shell 字符串拼接',()=>{
  const dir='C:\\Users\\测试 & 用户\\AppData\\Roaming\\npm';
  const entry=dir+'\\node_modules\\@openai\\codex\\bin\\codex.js';
  const found=new Set([dir+'\\codex.cmd',entry]);
  const command=codexCommand(['app-server','--stdio'],{platform:'win32',env:{Path:dir},exists:p=>found.has(p),node:'C:\\Program Files\\nodejs\\node.exe'});
  assert.deepEqual(command,{file:'C:\\Program Files\\nodejs\\node.exe',args:[entry,'app-server','--stdio']});
});
test('Windows 支持原生 exe、自定义 JS；缺失和危险 shim 明确失败',()=>{
  assert.equal(codexCommand([],{platform:'win32',env:{PATH:'C:\\bin'},exists:p=>p==='C:\\bin\\codex.exe'}).file,'C:\\bin\\codex.exe');
  assert.deepEqual(codexCommand(['--version'],{platform:'win32',env:{CODEX_BINARY:'D:\\codex.js'},node:'node.exe'}),{file:'node.exe',args:['D:\\codex.js','--version']});
  assert.throws(()=>codexCommand([],{platform:'win32',env:{CODEX_BINARY:'bad.cmd'}}),/不支持/);
  assert.throws(()=>codexCommand([],{platform:'win32',env:{}}),/未找到/);
});
test('Windows 停止当前持有的子进程树，已退出的句柄不再终止',()=>{
  const calls=[];let killed=false;
  const child={pid:123,exitCode:null,signalCode:null,kill:()=>killed=true};
  stopChild(child,{platform:'win32',exec:(...args)=>calls.push(args)});
  assert.deepEqual(calls[0][1],['/PID','123','/T','/F']);assert.equal(killed,false);
  stopChild({...child,exitCode:0},{platform:'win32',exec:()=>{throw Error('unexpected');}});
  assert.equal(killed,false);
});
test('Windows Claude 兼容原生 exe 与 npm 启动器',async()=>{
  const {claudeCommand}=await import('../platform.mjs');
  const dir='C:\\Users\\demo\\AppData\\Roaming\\npm';
  const entry=dir+'\\node_modules\\@anthropic-ai\\claude-code\\cli.js';
  assert.deepEqual(claudeCommand(['--version'],{platform:'win32',env:{Path:dir},node:'node.exe',exists:p=>[dir+'\\claude.cmd',entry].includes(p)}),{file:'node.exe',args:[entry,'--version']});
  assert.equal(claudeCommand([],{platform:'win32',env:{PATH:'C:\\bin'},exists:p=>p==='C:\\bin\\claude.exe'}).file,'C:\\bin\\claude.exe');
  const native=dir+'\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe';
  assert.deepEqual(claudeCommand(['--version'],{platform:'win32',env:{PATH:dir},exists:p=>p===native}),{file:native,args:['--version']});
});
