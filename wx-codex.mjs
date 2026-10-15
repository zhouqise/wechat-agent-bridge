#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createInterface} from 'node:readline/promises';
import {paths,privateDir,readJSON,writeJSON,alive,acquireLock,releaseLock} from './paths.mjs';
import {control} from './service.mjs';
import {CodexRPC} from './rpc.mjs';

const run=promisify(execFile), p=paths();
const root=path.dirname(fileURLToPath(import.meta.url));
const worker=path.join(root,'cli.mjs');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const help=`wx-codex — 在个人微信使用本机 Codex

  setup          首次配置：环境检查、工作目录、代理、微信扫码
  start          后台启动，关闭终端仍运行
  stop           停止桥接及其 Codex 子进程
  restart        停止后重新启动
  status         查看进程、微信、Codex 和任务状态
  logs           查看最近日志（logs --follow 持续查看）
  doctor         检查 Codex 登录及服务网络
  login          交互式微信扫码（login --force 重新绑定）
  run            前台运行，Ctrl+C 停止
  migrate        导入本目录旧版绑定和配置，保留旧文件备份
  paths          显示数据目录
  --version      显示版本

配置和凭证独立保存，升级或卸载 npm 包不会删除它们。
支持 macOS / Linux。未注册开机自启。`;

async function running() {try {const r=await control(p);return r.service==='wx-codex'?r:null;}catch{return null;}}
async function busy() {
  if(await running())return true;
  try{return alive(Number(await fs.readFile(p.lock,'utf8')));}catch{return false;}
}
async function foreground(args=[]) {
  const child=spawn(process.execPath,[worker,...args],{stdio:'inherit',env:process.env});
  return new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error('前台进程退出，请检查以上提示')));});
}
async function prerequisites() {
  if(Number(process.versions.node.split('.')[0])<22)throw new Error('需要 Node.js 22 或以上版本');
  try {const {stdout}=await run('codex',['--version'],{timeout:10000});console.log(stdout.trim());}
  catch {throw new Error('未找到可用 Codex CLI。请先安装 Codex CLI，并执行 codex login。');}
}
async function doctor(config=undefined) {
  await prerequisites();config ??= await readJSON(p.config,{});
  const cwd=config.workspace || p.workspace;await fs.mkdir(cwd,{recursive:true});
  const rpc=new CodexRPC({cwd,proxy:process.env.BRIDGE_CODEX_PROXY || config.codexProxy});
  try {
    await rpc.initialize();const auth=await rpc.request('account/read',{refreshToken:false});
    if(!auth.account)throw new Error('Codex 尚未登录，请执行 codex login 后重试');
    console.log('Codex 登录：有效（不代表模型请求已验证）');
  }finally{rpc.close();}
  const proxy=process.env.BRIDGE_CODEX_PROXY || config.codexProxy;
  const args=['-I','--connect-timeout','8','--max-time','12','-sS','-o','/dev/null','-w','%{http_code}'];
  if(proxy)args.push('--proxy',proxy);
  args.push('https://chatgpt.com/backend-api/codex/responses');
  try {
    const {stdout}=await run('curl',args,{timeout:15000});
    if(!['200','401','405'].includes(stdout.trim()))throw new Error();
    console.log(`Codex 网络：服务可达（HTTP ${stdout.trim()}）`);
  }catch{throw new Error('Codex 网络检测未通过。请检查代理和网络；此检查需要系统 curl。');}
}
async function setup() {
  if(await busy())throw new Error('请先 wx-codex stop，再修改配置');
  if(!process.stdin.isTTY)throw new Error('setup 需要交互式终端，请在电脑终端运行 wx-codex setup');
  await prerequisites();await privateDir(p.dir);
  const old=await readJSON(p.config,{});
  const rl=createInterface({input:process.stdin,output:process.stdout});
  let config;
  try {
    const workspace=(await rl.question(`工作目录（回车使用 ${old.workspace || p.workspace}）：`)).trim() || old.workspace || p.workspace;
    const proxyText=(await rl.question(`Codex 代理（回车保留 ${old.codexProxy || '直连'}，输入 direct 改为直连）：`)).trim();
    const proxy=proxyText==='direct'?'':proxyText || old.codexProxy || '';
    if(proxy) {const u=new URL(proxy);if(!['http:','https:','socks5:','socks5h:'].includes(u.protocol)||u.username||u.password)throw new Error('请输入不含账号密码的 HTTP/SOCKS 代理地址');}
    const expanded=workspace.startsWith('~/')?path.join((await import('node:os')).homedir(),workspace.slice(2)):workspace;
    const full=path.resolve(expanded);await fs.mkdir(full,{recursive:true});
    config={workspace:await fs.realpath(full),codexProxy:proxy};
  }finally{rl.close();}
  // 修改配置与启动共用锁，阻止配置向导和后台实例同时改变目录。
  await acquireLock(p);
  try {
    const session=await readJSON(p.session,null);
    if(session?.codex?.threadId && old.workspace!==config.workspace) {
      session.codex={workspace:config.workspace};await writeJSON(p.session,session);
      console.log('工作目录变化，已为新目录清空会话引用，原工作文件未删除。');
    }
    await writeJSON(p.config,config);
  }finally{await releaseLock(p);}
  console.log('配置已保存，正在检查 Codex 登录和网络……');
  await doctor(config);
  await foreground(['--login']);
  console.log('配置完成！现在执行 wx-codex start 即可。');
}
async function start() {
  await privateDir(p.dir);
  const previous=await running();if(previous){console.log(`已经运行（PID ${previous.pid}），无需重复启动。`);return;}
  if(await busy())throw new Error('已有进程正在启动或配置，请稍后执行 wx-codex status');
  const config=await readJSON(p.config,null),session=await readJSON(p.session,null);
  if(!config?.workspace || !session?.token || !session?.owner)throw new Error('尚未完成配置，请执行 wx-codex setup');
  if((await fs.stat(p.log).catch(()=>({size:0}))).size>2*1024*1024)await fs.rename(p.log,p.log+'.1');
  const log=await fs.open(p.log,'a',0o600);await log.chmod(0o600);
  const child=spawn(process.execPath,[worker,'--daemon'],{detached:true,stdio:['ignore',log.fd,log.fd],env:process.env,cwd:root});
  let failure;child.once('error',()=>{failure=true;});child.unref();await log.close();
  for(let i=0;i<100;i++) {
    await sleep(200);const state=await running();
    if(state){console.log(`已后台启动（PID ${state.pid}）。可关闭终端。\n状态：wx-codex status\n停止：wx-codex stop`);return;}
    if(failure || (child.pid && !alive(child.pid)))throw new Error('后台启动失败，请执行 wx-codex logs 查看原因');
  }
  throw new Error('后台启动仍未就绪。请执行 wx-codex status / logs 查看；不要重复启动。');
}
async function stop() {
  const current=await running();
  if(!current) {
    if(await busy())throw new Error('进程存在但管理接口不可用，可能在登录或启动。请在原终端 Ctrl+C；不会按旧 PID 强制杀进程。');
    console.log('桥接程序已停止。');return;
  }
  await control(p,'stop');
  for(let i=0;i<60;i++){await sleep(200);if(!await running() && !await busy()){console.log('已停止。');return;}}
  throw new Error('停止尚未确认，请稍后执行 wx-codex status');
}
async function status() {
  const state=await running();
  if(!state){const phase=await busy()?'starting':'stopped';console.log(process.argv.includes('--json')?JSON.stringify({service:'wx-codex',status:phase}):phase==='starting'?'状态：启动或配置中，管理接口尚不可用':'状态：已停止');return;}
  if(process.argv.includes('--json')){console.log(JSON.stringify(state));return;}
  console.log(`状态：运行中\nPID：${state.pid}\n运行时长：${Math.floor((Date.now()-state.startedAt)/1000)} 秒\n微信：${state.wechatBound?'已绑定':'未绑定'}\n最近成功轮询：${state.lastPollAt?new Date(state.lastPollAt).toLocaleString():'等待首次响应'}\nCodex：${state.codexConnected?'本机服务已连接':'未连接'}\n任务：${state.task}\n工作目录：${state.workspace || '回声模式'}`);
}
async function logs() {
  let position=0;
  async function read(initial=false) {
    const f=await fs.open(p.log,'r').catch(()=>null);if(!f){if(initial)console.log('暂无日志。');return;}
    try {
      const {size}=await f.stat();if(size<position)position=0;
      const from=initial?Math.max(0,size-32768):position;
      const b=Buffer.alloc(Math.min(size-from,32768));const {bytesRead}=await f.read(b,0,b.length,from);position=from+bytesRead;
      const text=b.subarray(0,bytesRead).toString();process.stdout.write(initial?text.split('\n').slice(-80).join('\n'):text);
    }finally{await f.close();}
  }
  await read(true);
  if(process.argv.includes('--follow'))while(true){await sleep(1000);await read();}
}
async function migrate() {
  if(await busy())throw new Error('新版本仍在运行，请先 stop');
  const legacy=path.join(root,'.state');
  const pid=Number(await fs.readFile(path.join(legacy,'running.lock'),'utf8').catch(()=>''));
  if(alive(pid))throw new Error('旧版本仍在运行，请先在旧终端停止');
  if(await readJSON(p.session,null))throw new Error('目标已有微信会话，拒绝覆盖');
  const session=await readJSON(path.join(legacy,'session.json'),null);
  if(!session?.token || !session?.owner)throw new Error('没有找到可导入的旧版绑定');
  await privateDir(p.dir);await acquireLock(p);
  try {
    if(await readJSON(p.session,null))throw new Error('目标已有微信会话，拒绝覆盖');
    const old=await readJSON(path.join(root,'config.local.json'),{});
    const workspace=await fs.realpath(path.join(root,'workspace'));
    session.codex ??={};session.codex.workspace=workspace;
    await writeJSON(p.config,{workspace,codexProxy:old.codexProxy || ''});
    await writeJSON(p.session,session);
  }finally{await releaseLock(p);}
  console.log('旧版绑定、会话和代理已导入；旧文件保留备份，工作目录未移动。');
}
try {
  if(!['darwin','linux'].includes(process.platform))throw new Error('当前版本支持 macOS 和 Linux');
  const command=process.argv[2] || 'help';
  const commands={setup,start,stop,restart:async()=>{await stop();await start();},status,logs,doctor,
    login:async()=>{if(await busy())throw new Error('请先 wx-codex stop');await foreground(['--login',...(process.argv.includes('--force')?['--force']:[])]);},
    run:()=>foreground(),migrate,paths:async()=>console.log(p.dir),
    '--version':async()=>console.log('0.4.0'),help:async()=>console.log(help),'--help':async()=>console.log(help),'-h':async()=>console.log(help)};
  if(!commands[command])throw new Error('未知命令，请执行 wx-codex --help');
  await commands[command]();
}catch(e){console.error(`错误：${e.message}`);process.exitCode=1;}
