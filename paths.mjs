import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

export function paths(env = process.env, platform = process.platform, home = os.homedir()) {
  const dir = path.resolve(env.WX_CODEX_HOME || env.BRIDGE_STATE_DIR ||
    (platform === 'darwin' ? path.join(home,'Library','Application Support','wx-codex') : path.join(env.XDG_DATA_HOME || path.join(home,'.local','share'),'wx-codex')));
  return {dir,config:path.join(dir,'config.json'),session:path.join(dir,'session.json'),
    lock:path.join(dir,'running.lock'),socket:path.join(dir,'control.sock'),log:path.join(dir,'service.log'),qr:path.join(dir,'pairing.png'),workspace:path.join(dir,'workspace')};
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
      if(alive(pid))throw new Error('已有实例或配置向导在运行，请先 wx-codex status / stop');
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
