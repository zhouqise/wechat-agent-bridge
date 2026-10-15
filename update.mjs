import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
const repo='https://github.com/zhouqise/wechat-agent-bridge';
export function updateFetcher(proxy,{run=exec,platform=process.platform}={}) {
  if(!proxy || proxy==='direct')return fetch;
  const url=new URL(proxy);if(!['http:','https:','socks5:','socks5h:'].includes(url.protocol)||url.username||url.password)throw Error('升级代理必须是不含账号密码的 HTTP/SOCKS 地址');
  return async (url,options)=>{
    try {
      const {stdout}=await run(platform==='win32'?'curl.exe':'curl',['--fail','--location','--silent','--show-error','--connect-timeout','15','--max-time','120','--max-filesize',String(20*1024*1024),'--proto','=https','--proto-redir','=https','--proxy',proxy,'-H','User-Agent: wx-agent-updater','-H','Accept: '+options.headers.Accept,url],{encoding:'buffer',timeout:125000,maxBuffer:20*1024*1024,windowsHide:true,shell:false,signal:options.signal});
      return new Response(stdout);
    }catch{throw Error('通过代理下载更新失败，请检查代理与系统 curl；现有配置保留');}
  };
}
export function newer(a,b) {
  if(!/^\d+\.\d+\.\d+$/.test(a)||!/^\d+\.\d+\.\d+$/.test(b))throw Error('版本号格式不受支持');
  const x=a.split('.').map(Number),y=b.split('.').map(Number);
  for(let i=0;i<3;i++)if(x[i]!==y[i])return x[i]>y[i];return false;
}
export function installPrefix(root,platform=process.platform) {
  const p=platform==='win32'?path.win32:path.posix;
  if(p.basename(root)!=='wx-codex-bridge'||p.basename(p.dirname(root))!=='node_modules')throw Error('update 仅支持全局 tgz 安装；源码安装请手动安装发布页 tgz 后使用');
  const parent=p.dirname(p.dirname(root));
  if(platform==='win32')return parent;
  if(p.basename(parent)!=='lib')throw Error('无法确定当前安装位置，请手动升级');
  return p.dirname(parent);
}
export async function npmCommand(args,{platform=process.platform,env=process.env,node=process.execPath,exists=async p=>fs.stat(p).then(s=>s.isFile(),()=>false)}={}) {
  if(platform!=='win32')return {file:'npm',args};
  const key=Object.keys(env).find(k=>k.toLowerCase()==='path');
  for(const dir of [path.win32.dirname(node),...(env[key]||'').split(';').map(s=>s.replace(/^"|"$/g,''))]) {
    const entry=path.win32.join(dir,'node_modules','npm','bin','npm-cli.js');
    if(await exists(entry))return {file:node,args:[entry,...args]};
  }
  throw Error('未找到 npm，请修复 Node.js / npm 安装后重试');
}
async function download(url,limit,fetcher) {
  const r=await fetcher(url,{signal:AbortSignal.timeout(120000),headers:{'User-Agent':'wx-agent-updater','Accept':url.startsWith('https://api.github.com/')?'application/vnd.github+json':'application/octet-stream'}});
  if(!r.ok||!r.body)throw Error(`更新下载失败（HTTP ${r.status}）`);
  if(Number(r.headers.get('content-length'))>limit){await r.body.cancel();throw Error('更新文件超出大小限制');}
  const reader=r.body.getReader(),chunks=[];let size=0;
  try {while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();throw Error('更新文件超出大小限制');}chunks.push(value);}}
  finally{reader.releaseLock();}
  return Buffer.concat(chunks);
}
export async function updatePackage({root,current,check=false,fetcher=fetch,run=exec,state,stop,lock,unlock,restart,log=console.log,resolveNpm=npmCommand}) {
  const release=JSON.parse((await download('https://api.github.com/repos/zhouqise/wechat-agent-bridge/releases/latest',1024*1024,fetcher)).toString());
  const version=String(release.tag_name||'').replace(/^v/,'');
  if(release.draft||release.prerelease)throw Error('最新发布不是稳定版本');
  if(!newer(version,current)){log(`当前版本 ${current} 已是最新版本（GitHub：${version}）。`);return;}
  log(`当前 ${current}，最新 ${version}。`);
  if(check)return;
  const prefix=installPrefix(root),name=`wx-codex-bridge-${version}.tgz`;
  const base=`${repo}/releases/download/v${version}/`;
  for(const asset of [name,`SHA256SUMS-${version}.txt`])if(!release.assets?.some(a=>a.name===asset&&a.browser_download_url===base+asset))throw Error('发布缺少可信安装包或校验文件，请手动检查 GitHub Release');
  const previous=await state();if(previous?.task && previous.task!=='空闲')throw Error('任务执行中，请等待完成或 /取消 后再升级');
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'wx-agent-update-'));let locked=false,stopped=false,installed=false;
  try {
    const archive=await download(base+name,20*1024*1024,fetcher);
    const sums=(await download(base+`SHA256SUMS-${version}.txt`,16384,fetcher)).toString();
    const entry=sums.split(/\r?\n/).find(l=>l.trim().split(/\s+/)[1]===name);
    if(!entry||entry.split(/\s+/)[0]!==createHash('sha256').update(archive).digest('hex'))throw Error('安装包 SHA-256 校验失败，未修改现有安装');
    const file=path.join(dir,name);await fs.writeFile(file,archive,{mode:0o600});
    const npm=await resolveNpm(['install','-g','--prefix',prefix,file,'--ignore-scripts','--no-audit','--no-fund']);
    const latest=await state();if(latest?.task && latest.task!=='空闲')throw Error('任务正在执行，未停止服务；请稍后重试');
    if(latest){await stop();stopped=true;}
    await lock();locked=true;
    log('校验通过，正在安装更新……');
    try {await run(npm.file,npm.args,{timeout:300000,maxBuffer:2*1024*1024,windowsHide:true,shell:false,cwd:dir});}
    catch {throw Error('npm 安装失败；配置仍保留。请检查权限和网络，必要时重新安装发布页 tgz，然后 wx-agent start');}
    const pkg=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));
    if(pkg.version!==version)throw Error('安装版本校验失败，请手动检查安装位置');
    installed=true;await unlock();locked=false;
    if(stopped)await restart();
    log(`已升级到 ${version}。${stopped?'服务已重新启动。':'服务保持停止状态。'}配置与微信绑定已保留。`);
  }catch(e){if(stopped&&!installed)log('升级未完成，服务保持停止，请修复安装后执行 wx-agent start。');throw e;}
  finally{if(locked)await unlock();await fs.rm(dir,{recursive:true,force:true});}
}
