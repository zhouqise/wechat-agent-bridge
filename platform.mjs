import path from 'node:path';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';

// npm's Windows .cmd shim is not executable with shell:false. Launch its JS
// entry through Node instead; user messages never enter a command shell.
export function codexCommand(args, {platform=process.platform,env=process.env,exists=fs.existsSync,node=process.execPath}={}) {
  const win=platform==='win32', p=win?path.win32:path.posix;
  function explicit(file) {
    if(/\.(mjs|cjs|js)$/i.test(file))return {file:node,args:[file,...args]};
    if(win && /\.(cmd|bat|ps1)$/i.test(file))throw new Error('CODEX_BINARY 请指定 codex.exe 或 Codex 的 bin/codex.js，不支持脚本启动器');
    return {file,args};
  }
  if(env.CODEX_BINARY)return explicit(env.CODEX_BINARY);
  if(!win)return {file:'codex',args};
  const pathKey=Object.keys(env).find(k=>k.toLowerCase()==='path');
  for(const raw of (env[pathKey] || '').split(';')) {
    const dir=raw.replace(/^"|"$/g,'');if(!dir)continue;
    const exe=p.join(dir,'codex.exe');if(exists(exe))return {file:exe,args};
    const shim=p.join(dir,'codex.cmd');
    const entry=p.join(dir,'node_modules','@openai','codex','bin','codex.js');
    if(exists(shim) && exists(entry))return {file:node,args:[entry,...args]};
  }
  throw new Error('未找到 Codex：请运行 npm.cmd install -g @openai/codex，或用 CODEX_BINARY 指定 codex.exe 的完整路径');
}
export function stopChild(child,{platform=process.platform,exec=execFileSync}={}) {
  if(child.exitCode!=null || child.signalCode!=null)return;
  if(platform==='win32' && child.pid) {
    // This is the child handle created in this process, never a stale disk PID.
    try {exec('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{stdio:'ignore',windowsHide:true,timeout:5000});return;}
    catch { /* Fallback if the child exited between the check and taskkill. */ }
  }
  child.kill('SIGTERM');
}
