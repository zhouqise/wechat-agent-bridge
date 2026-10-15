import os from 'node:os';
import {createHash} from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs/promises';

export function paths(env = process.env, platform = process.platform, home = os.homedir()) {
  const win=platform==='win32', p=win?path.win32:path.posix;
  const baseDir = p.resolve(env.WX_CODEX_HOME || env.BRIDGE_STATE_DIR ||
    (win ? p.join(env.LOCALAPPDATA || p.join(home,'AppData','Local'),'wx-codex') :
    platform === 'darwin' ? p.join(home,'Library','Application Support','wx-codex') : p.join(env.XDG_DATA_HOME || p.join(home,'.local','share'),'wx-codex')));
  const user=env.WX_AGENT_USER || '';
  if(user && (!/^[a-z][a-z0-9_-]{0,23}$/.test(user)||/^(default|con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(user)))throw new Error('无效的用户名称');
  const dir=user?p.join(baseDir,'users',user):baseDir;
  const pipeId=createHash('sha256').update(win?dir.toLowerCase():dir).digest('hex').slice(0,32);
  return {dir,baseDir,user,platform,config:p.join(dir,'config.json'),session:p.join(dir,'session.json'),
    lock:p.join(dir,'running.lock'),socket:win?`\\\\.\\pipe\\wx-codex-${pipeId}`:p.join(dir,'control.sock'),
    controlToken:p.join(dir,'control-token.json'),log:p.join(dir,'service.log'),qr:p.join(dir,'pairing.png'),workspace:p.join(dir,'workspace')};
}
export async function privateDir(dir) {
  await fs.mkdir(dir,{recursive:true,mode:0o700});
  if ((await fs.lstat(dir)).isSymbolicLink()) throw new Error('数据目录不能是符号链接');
  await fs.chmod(dir,0o700);
}
export async function readJSON(file, fallback) {
  try {return JSON.parse(await fs.readFile(file,'utf8'));}
  catch(e) {if(e.code==='ENOENT')return fallback;throw new Error(`无法读取配置或状态文件：${path.basename(file)}`);}
}
export async function writeJSON(file,data) {
  const tmp=`${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp,JSON.stringify(data,null,2),{mode:0o600});
  await fs.chmod(tmp,0o600);await fs.rename(tmp,file);
}
export function alive(pid) {
  if (!Number.isSafeInteger(pid) || pid < 2) return false;
  try {process.kill(pid,0);return true;} catch(e) {return e.code==='EPERM';}
}
export async function acquireLock(p) {
  const guard = p.lock + '.guard';
  try {await fs.mkdir(guard,{mode:0o700});}
  catch(e) {
    if(e.code==='EEXIST')throw new Error('另一个进程正在取得锁；请稍后重试。若持续出现，请确认所有桥接进程已停止后移除 running.lock.guard');
    throw e;
  }
  try {
  for(let attempt=0;attempt<2;attempt++) {
    try {await fs.writeFile(p.lock,String(process.pid),{flag:'wx',mode:0o600});return;}
    catch(e) {
      if(e.code!=='EEXIST')throw e;
      const pid=Number(await fs.readFile(p.lock,'utf8'));
      if(alive(pid))throw new Error('已有实例或配置向导在运行，请先 wx-agent status / stop');
      if(!Number.isSafeInteger(pid)||pid<2)throw new Error('锁文件损坏，请检查数据目录后处理');
      await fs.rm(p.lock,{force:true});
    }
  }
  throw new Error('无法取得单实例锁');
  } finally {await fs.rmdir(guard);}
}
export async function releaseLock(p) {
  if(Number(await fs.readFile(p.lock,'utf8').catch(()=>''))===process.pid)await fs.rm(p.lock,{force:true});
}
