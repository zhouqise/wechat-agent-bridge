#!/usr/bin/env node
import {migrateAuthSessions} from './auth-sessions.mjs';
import {saveModel} from './auth-settings.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createInterface} from 'node:readline/promises';
import {paths,privateDir,readJSON,writeJSON,alive,acquireLock,releaseLock} from './paths.mjs';
import {control} from './service.mjs';
import {workspace as manageWorkspace} from './workspace.mjs';
import {startDashboard} from './dashboard.mjs';
import {configureEngines} from './setup-engines.mjs';
import {officeSetup,officeCheck} from './office.mjs';
import {modelListText,modelInfo,modelConfig} from './models.mjs';
import {codexSettings} from './codex-config.mjs';
import {CodexRPC} from './rpc.mjs';
import {codexCommand,claudeCommand} from './platform.mjs';
import {ClaudeRPC} from './claude.mjs';
import {updatePackage,updateFetcher} from './update.mjs';
import {userNames,provisionUser,requireUser,profileState,archiveUser} from './users.mjs';
import {projectList,addProject,projectName} from './projects.mjs';
import {ocrCheck,ocrSetup} from './ocr.mjs';
import {engineName} from './engines.mjs';

const userFlag=process.argv.indexOf('--user');
if(userFlag>=0){process.env.WX_AGENT_USER=process.argv[userFlag+1]||'!invalid';process.argv.splice(userFlag,2);}
const run=promisify(execFile), p=paths();
const root=path.dirname(fileURLToPath(import.meta.url));
const worker=path.join(root,'cli.mjs');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const help=`wx-agent — 在个人微信使用本机 Codex / Claude Code

  user add 名称  新增用户、扫码并启动（--no-login 仅创建）
  user list      查看所有用户与运行状态
  user start/stop/status/login/logs 名称  管理指定用户
  user remove 名称  停用并归档已停止用户，保留工作文件
  --user 名称    对指定用户执行 start/status/model 等命令
  setup          配置 codex / claude / both，选择默认引擎并扫码
  start          后台启动，关闭终端仍运行
  stop           停止桥接及其引擎子进程
  restart        停止后重新启动
  update         升级到 GitHub 最新稳定版（--check 只检查）
  workspace [完整路径]  查看或切换工作目录，支持 --user
  dashboard      打开本机管理面板（终端保留运行）
  status         查看进程、微信、引擎和任务状态
  logs           查看最近日志（logs --follow 持续查看）
  doctor         检查当前引擎（--engine claude 或 codex）
  engine [名称]  查看或切换默认引擎，保留独立会话
  project list/add/remove  管理本用户可切换的项目（修改需停止服务）
  ocr-setup      安装 OCR Python 组件（另需 Tesseract 中英文语言包）
  ocr-check      检查图片和扫描 PDF 的 OCR 环境
  office-setup   安装独立 Office 处理环境（需要 Python 3）
  office-check   检查 PDF/Excel/Word/PPT 处理环境
  media-check    检查视频抽帧、音轨识别组件与模型
  model [模型名] 查看或切换当前引擎模型
  login          交互式微信扫码（login --force 重新绑定）
  run            前台运行，Ctrl+C 停止
  migrate        导入本目录旧版绑定和配置，保留旧文件备份
  paths          显示数据目录
  --version      显示版本

配置和凭证独立保存，升级或卸载 npm 包不会删除它们。
支持 macOS / Linux / Windows。未注册开机自启。`;

async function project(){
  const [action='list',name,dir,...extra]=process.argv.slice(3);
  if(action==='list'){const c=await readJSON(p.config,{});for(const [n,d] of Object.entries(projectList(c,p.workspace)))console.log(`${n=== (c.currentProject || 'default')?'*':' '} ${n}: ${d}`);return;}
  if(!['add','remove'].includes(action) || extra.length)throw Error('用法：project list | project add 名称 完整目录 | project remove 名称');
  await privateDir(p.dir);await acquireLock(p);
  try{
    let c=await readJSON(p.config,{});
    if(action==='add')c=await addProject(c,name,dir);
    else{projectName(name);if(name==='default')throw Error('不能移除默认项目');if(dir)throw Error('用法：project remove 名称');c.projects={...c.projects};delete c.projects[name];if(c.currentProject===name)c.currentProject='default';}
    await writeJSON(p.config,c);console.log('项目配置已保存。启动后微信发送 /项目 查看。');
  }finally{await releaseLock(p);}
}

async function user() {
  if(p.user)throw Error('user 管理命令请勿同时指定 --user');
  const [action,name,...args]=process.argv.slice(3);
  if(action==='list') {
    for(const value of ['',...await userNames(p.baseDir)]) {
      const target=value?await requireUser(p.baseDir,value):p,state=await profileState(target);
      const session=await readJSON(target.session,{}),config=await readJSON(target.config,{});
      console.log(`${value||'default'}：${session.owner?'已绑定':'未绑定'}；${state?state.task==='空闲'?'运行中，空闲':state.task:'已停止'}；${state?.workspace || projectList(config,target.workspace)[config.currentProject || 'default'] || target.workspace}`);
    }return;
  }
  if(!['add','start','stop','status','login','logs','remove'].includes(action))throw Error('用法：wx-agent user add/list/start/stop/status/login/logs/remove 名称');
  await privateDir(p.baseDir);
  const guard={...p,lock:path.join(p.baseDir,'users.lock')};await acquireLock(guard);
  try {
    let target;
    if(action==='add') {
      if(args.some(a=>a!=='--no-login'))throw Error('用法：user add 名称 [--no-login]');
      target=await provisionUser(p.baseDir,name);console.log(`已创建用户 ${name}，独立工作区：${target.workspace}`);
      if(args.includes('--no-login')){console.log(`稍后执行 wx-agent user login ${name}，扫码后自动启动。`);return;}
    }else target=await requireUser(p.baseDir,name);
    if(action==='remove'){console.log('用户已停用，绑定和工作文件归档于：'+await archiveUser(p.baseDir,name));return;}
    const env={...process.env,WX_CODEX_HOME:p.baseDir,WX_AGENT_USER:name};
    const invoke=command=>new Promise((resolve,reject)=>{
      const child=spawn(process.execPath,[path.join(root,'wx-agent.mjs'),command,...(command==='logs'?args:[])],{stdio:'inherit',env,windowsHide:true});
      child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error('用户操作失败，请检查以上提示')));
    });
    if(action==='add'||action==='login'){await invoke('login');await invoke('start');}else await invoke(action);
  }finally{await releaseLock(guard);}
}

async function running() {try {const r=await control(p);return r.service==='wx-codex'?r:null;}catch{return null;}}
async function busy() {
  if(await running())return true;
  try{return alive(Number(await fs.readFile(p.lock,'utf8')));}catch{return false;}
}
async function foreground(args=[]) {
  const child=spawn(process.execPath,[worker,...args],{stdio:'inherit',env:process.env});
  return new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error('前台进程退出，请检查以上提示')));});
}
async function prerequisites(engine='codex') {
  if(Number(process.versions.node.split('.')[0])<22)throw new Error('需要 Node.js 22 或以上版本');
  try {const command=(engine==='claude'?claudeCommand:codexCommand)(['--version']);const {stdout}=await run(command.file,command.args,{timeout:10000,windowsHide:true});console.log(stdout.trim());}
  catch {throw new Error(engine==='claude'?'未找到 Claude Code，请先安装并在电脑上登录。':'未找到可用 Codex CLI。请先安装 Codex CLI，并执行 codex login。');}
}
async function doctor(config=undefined,selectedEngine=undefined) {
  config ??= await readJSON(p.config,{});
  const flag=process.argv.indexOf('--engine');
  const engine=engineName(selectedEngine || (flag>=0?process.argv[flag+1]:config.engine || 'codex'));
  await prerequisites(engine);
  const cwd=config.workspace || p.workspace;await fs.mkdir(cwd,{recursive:true});
  if(engine==='claude') {
    const auth=config.claudeAuth || 'local';
    const rpc=new ClaudeRPC({cwd,auth,config,proxy:process.env.BRIDGE_CLAUDE_PROXY || config.claudeProxy});
    await rpc.initialize();rpc.close();
    if(auth==='local') {
      const c=claudeCommand(['--setting-sources','user','auth','status']);
      const result=JSON.parse((await run(c.file,c.args,{cwd,timeout:10000,windowsHide:true})).stdout);
      if(!result.loggedIn)throw new Error('Claude Code 尚未登录，请在电脑上执行 claude auth login');
      console.log('Claude Code：本机认证已配置（不代表远端请求已验证）');
    } else console.log('Claude：ANTHROPIC_API_KEY 已配置（未验证密钥有效性或额度）');
    return;
  }
  const rpc=new CodexRPC({cwd,config,proxy:process.env.BRIDGE_CODEX_PROXY || config.codexProxy});
  try {
    await rpc.initialize();
    if(codexSettings(config).auth==='api') {console.log('Codex API：配置与本机适配器已验证（未验证密钥、额度或远端模型兼容性）');return;}
    const auth=await rpc.request('account/read',{refreshToken:false});
    if(!auth.account)throw new Error('Codex 尚未登录，请执行 codex login 后重试');
    console.log('Codex 登录：有效（不代表模型请求已验证）');
  }finally{rpc.close();}
  const proxy=process.env.BRIDGE_CODEX_PROXY || config.codexProxy;
  const args=['-I','--connect-timeout','8','--max-time','12','-sS','-o',process.platform==='win32'?'NUL':'/dev/null','-w','%{http_code}'];
  if(proxy)args.push('--proxy',proxy);
  args.push('https://chatgpt.com/backend-api/codex/responses');
  try {
    const {stdout}=await run(process.platform==='win32'?'curl.exe':'curl',args,{timeout:15000,windowsHide:true});
    if(!['200','401','405'].includes(stdout.trim()))throw new Error();
    console.log(`Codex 网络：服务可达（HTTP ${stdout.trim()}）`);
  }catch{throw new Error('Codex 网络检测未通过。请检查代理和网络；此检查需要系统 curl。');}
}
async function setup() {
  if(await busy())throw new Error('请先 wx-agent stop，再修改配置');
  if(!process.stdin.isTTY)throw new Error('setup 需要交互式终端，请在电脑终端运行 wx-agent setup');
  await privateDir(p.dir);
  const old=await readJSON(p.config,{});
  const rl=createInterface({input:process.stdin,output:process.stdout});
  let config,engines;
  try {
    ({config,engines}=await configureEngines({old,ask:q=>rl.question(q),check:prerequisites,log:console.log}));
    const workspace=(await rl.question(`工作目录（两个引擎共用；回车使用 ${old.workspace || p.workspace}）：`)).trim() || old.workspace || p.workspace;
    const expanded=workspace.startsWith('~/')?path.join((await import('node:os')).homedir(),workspace.slice(2)):workspace;
    const full=path.resolve(expanded);await fs.mkdir(full,{recursive:true});
    config.workspace=await fs.realpath(full);
  }finally{rl.close();}
  // 修改配置与启动共用锁，阻止配置向导和后台实例同时改变目录。
  await acquireLock(p);
  try {
    if(JSON.stringify(await readJSON(p.config,{}))!==JSON.stringify(old))throw Error('配置已被其他操作更改，请重新打开配置向导');
    for(const engine of engines){console.log(`正在检查 ${engine}……`);await doctor(config,engine);}
    const session=await readJSON(p.session,null);
    if(session && migrateAuthSessions(session,{...old,workspace:old.workspace || p.workspace}))await writeJSON(p.session,session);
    if(old.workspace!==config.workspace)config.currentProject='default';
    await writeJSON(p.config,config);
  }finally{await releaseLock(p);}
  console.log(`已配置 ${engines.join(' + ')}，默认引擎：${config.engine}。微信用 /引擎 切换。`);
  await foreground(['--login']);
  console.log('配置完成！现在执行 wx-agent start 即可。');
}
async function start() {
  await privateDir(p.dir);
  const previous=await running();if(previous){console.log(`已经运行（PID ${previous.pid}），无需重复启动。`);return;}
  if(await busy())throw new Error('已有进程正在启动或配置，请稍后执行 wx-agent status');
  const config=await readJSON(p.config,null),session=await readJSON(p.session,null);
  if(!config?.workspace || !session?.token || !session?.owner)throw new Error('尚未完成配置，请执行 wx-agent setup');
  if((await fs.stat(p.log).catch(()=>({size:0}))).size>2*1024*1024)await fs.rename(p.log,p.log+'.1');
  const log=await fs.open(p.log,'a',0o600);await log.chmod(0o600);
  const child=spawn(process.execPath,[worker,'--daemon'],{detached:true,windowsHide:true,stdio:['ignore',log.fd,log.fd],env:process.env,cwd:root});
  let failure;child.once('error',()=>{failure=true;});child.unref();await log.close();
  for(let i=0;i<100;i++) {
    await sleep(200);const state=await running();
    if(state){console.log(`已后台启动（PID ${state.pid}）。可关闭终端。\n状态：wx-agent status\n停止：wx-agent stop`);return;}
    if(failure || (child.pid && !alive(child.pid)))throw new Error('后台启动失败，请执行 wx-agent logs 查看原因');
  }
  throw new Error('后台启动仍未就绪。请执行 wx-agent status / logs 查看；不要重复启动。');
}
async function stop() {
  const current=await running();
  if(!current) {
    if(await busy())throw new Error('进程存在但管理接口不可用，可能在登录或启动。请在原终端 Ctrl+C；不会按旧 PID 强制杀进程。');
    console.log('桥接程序已停止。');return;
  }
  await control(p,'stop');
  for(let i=0;i<60;i++){await sleep(200);if(!await running() && !await busy()){console.log('已停止。');return;}}
  throw new Error('停止尚未确认，请稍后执行 wx-agent status');
}
async function update() {
  if(p.user)throw Error('安装包由所有用户共用，请不带 --user 执行 update');
  if(process.argv.slice(3).some(a=>a!=='--check'))throw Error('用法：wx-agent update [--check]');
  await privateDir(p.dir);
  const config=await readJSON(p.config,{});
  const proxy=process.env.WX_AGENT_UPDATE_PROXY || process.env.HTTPS_PROXY || (config.engine==='claude'?config.claudeProxy:config.codexProxy);
  const usersGuard={...p,lock:path.join(p.baseDir,'users.lock')};await acquireLock(usersGuard);
  let guard;
  try {
    guard={...p,lock:path.join(p.dir,'update.lock')};await acquireLock(guard);
  try {
    if(!process.argv.includes('--check'))for(const name of await userNames(p.baseDir))if(await profileState(await requireUser(p.baseDir,name)))throw Error(`用户 ${name} 仍在运行，请先 wx-agent user stop ${name}，升级后再 user start ${name}；不会中断其他用户任务`);
    await updatePackage({root,fetcher:updateFetcher(proxy),current:JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8')).version,check:process.argv.includes('--check'),
    state:async()=>{const state=await running();if(!state&&await busy())throw Error('服务正在启动或配置，请稍后重试');return state;},
    stop:async()=>{const result=await control(p,'stop-if-idle');if(result.error)throw Error('服务未安全停止：请等待任务结束后手动 stop，再重试 update');for(let i=0;i<60;i++){await sleep(200);if(!await busy())return;}throw Error('停止未确认，请稍后重试');},
    lock:()=>acquireLock(p),unlock:()=>releaseLock(p),
    restart:async()=>{await releaseLock(guard);await run(process.execPath,[path.join(root,'wx-agent.mjs'),'start'],{timeout:30000,windowsHide:true});}
  });}finally{await releaseLock(guard);}
  }finally{await releaseLock(usersGuard);}
}
async function status() {
  const state=await running();
  if(!state){const phase=await busy()?'starting':'stopped';console.log(process.argv.includes('--json')?JSON.stringify({service:'wx-codex',status:phase}):phase==='starting'?'状态：启动或配置中，管理接口尚不可用':'状态：已停止');return;}
  if(process.argv.includes('--json')){console.log(JSON.stringify(state));return;}
  console.log(`状态：运行中\nPID：${state.pid}\n运行时长：${Math.floor((Date.now()-state.startedAt)/1000)} 秒\n微信：${state.wechatBound?'已绑定':'未绑定'}\n最近成功轮询：${state.lastPollAt?new Date(state.lastPollAt).toLocaleString():'等待首次响应'}\n引擎：${state.engine || 'codex'}\n引擎状态：${(state.agentReady ?? state.codexConnected)?'本机适配器已就绪':'未连接'}\n任务：${state.task}\n工作目录：${state.workspace || '回声模式'}`);
}
async function engine() {
  const config=await readJSON(p.config,{});
  const next=process.argv[3];
  if(!next){console.log(`当前默认引擎：${config.engine || 'codex'}`);return;}
  engineName(next);
  if(!config.workspace)throw new Error('请先运行 wx-agent setup');
  await doctor({...config,engine:next});
  const current=await running();
  if(current && current.task!=='空闲')throw new Error('任务执行中，请等待完成或在微信 /取消 后再切换引擎');
  const wasRunning=!!current;if(wasRunning)await stop();
  await privateDir(p.dir);await acquireLock(p);
  try {await writeJSON(p.config,{...config,engine:next});}finally{await releaseLock(p);}
  console.log(`默认引擎已设置为 ${next}，两个引擎的会话独立保留。`);
  if(wasRunning)await start();
}
async function model() {
  const value=process.argv[3];
  const current=await running();
  if(!value) {
    const config=await readJSON(p.config,{});
    if(current) {const result=await control(p,'models');if(result.error)throw new Error(result.error);console.log(result.text);}
    else console.log(await modelListText(config,config.engine || 'codex'));
    return;
  }
  if(current) {
    const result=await control(p,'model',{model:value});
    if(result.error)throw new Error(result.error);
    console.log(`模型已设置为 ${result.model}，下一条任务生效；可用性由账号或服务商决定。`);return;
  }
  await saveModel(p,value);console.log('模型设置已保存，下次启动生效。');
}
async function mediaCheck() {
  for(const [label,binary] of [['FFmpeg',process.env.FFMPEG_BINARY || 'ffmpeg'],['FFprobe',process.env.FFPROBE_BINARY || 'ffprobe'],['Whisper',process.env.WHISPER_BINARY || 'whisper-cli']]) {
    try {await run(binary,[label==='Whisper'?'-h':'-version'],{timeout:10000,windowsHide:true});console.log(label+'：已安装');}
    catch{throw new Error(label+' 不可用，请按 README 安装或配置可执行文件路径');}
  }
  const model=process.env.WHISPER_MODEL || path.join(p.baseDir,'models','ggml-base.bin');
  if(!await fs.stat(model).then(s=>s.isFile(),()=>false))throw new Error('视频音轨识别模型未配置，请按 README 下载或设置 WHISPER_MODEL');
  console.log('视频抽帧与音轨识别组件已就绪；微信语音仍只使用微信附带转文字。');
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
  if(!['darwin','linux','win32'].includes(process.platform))throw new Error('当前版本支持 macOS、Linux 和 Windows');
  const command=process.argv[2] || 'help';
  const commands={workspace:async()=>{const args=process.argv.slice(3);if(args.length>1)throw Error('用法：wx-agent workspace [完整路径]；含空格路径请加引号');const result=await manageWorkspace(p,args[0]);if(result.error)throw Error(result.error);console.log(`工作目录：${result.workspace}\n项目：${result.project}\n${result.applied==='live'?'当前服务已生效':'已保存，下次启动生效'}`);},dashboard:async()=>{const panel=await startDashboard({base:p.baseDir}),{url}=panel;let closing=false;const close=()=>{if(closing)return;closing=true;void panel.close().finally(()=>process.exit(0));};process.on('SIGINT',close);process.on('SIGTERM',close);console.log('本机管理面板（链接包含访问凭证，请勿分享）：\n'+url+'\n按 Ctrl+C 关闭面板，桥接服务继续运行。');const opener=process.platform==='darwin'?'open':process.platform==='win32'?'rundll32':'xdg-open';const args=process.platform==='win32'?['url.dll,FileProtocolHandler',url]:[url];const child=spawn(opener,args,{stdio:'ignore',windowsHide:true});child.on('error',()=>{});},project,'ocr-check':async()=>{await ocrCheck();console.log('OCR 环境已就绪（中英文）。');},'ocr-setup':async()=>{await ocrSetup();console.log('OCR 环境已就绪。');},setup,start,stop,update,user,engine,model,'media-check':mediaCheck,'office-setup':async()=>{console.log('正在安装 Office 处理环境……');await officeSetup();console.log('Office 环境已就绪。');},'office-check':async()=>{await officeCheck();console.log('PDF / Excel / Word / PPT 处理环境已就绪。');},restart:async()=>{await stop();await start();},status,logs,doctor,
    login:async()=>{if(await busy())throw new Error('请先 wx-agent stop');await foreground(['--login',...(process.argv.includes('--force')?['--force']:[])]);},
    run:()=>foreground(),migrate,paths:async()=>console.log(p.dir),
    '--version':async()=>console.log('0.22.0'),help:async()=>console.log(help),'--help':async()=>console.log(help),'-h':async()=>console.log(help)};
  if(!commands[command])throw new Error('未知命令，请执行 wx-agent --help');
  await commands[command]();
}catch(e){console.error(`错误：${e.message}`);process.exitCode=1;}
