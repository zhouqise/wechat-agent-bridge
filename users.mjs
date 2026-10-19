import fs from 'node:fs/promises';
import path from 'node:path';
import {paths,privateDir,readJSON,writeJSON,alive} from './paths.mjs';
import {control} from './service.mjs';
export function userName(name) {
  if(typeof name!=='string'||! /^[a-z][a-z0-9_-]{0,23}$/.test(name)||/^(default|con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(name))throw Error('用户名需为 1–24 位小写字母、数字、下划线或短横线，以字母开头，不能使用 default 或系统保留名');
  return name;
}
export async function userNames(base) {
  const entries=await fs.readdir(path.join(base,'users'),{withFileTypes:true}).catch(e=>{if(e.code==='ENOENT')return [];throw e;});
  return entries.filter(e=>e.isDirectory()&&/^[a-z][a-z0-9_-]{0,23}$/.test(e.name)).map(e=>e.name).sort();
}
export function userPaths(base,name) {return paths({WX_CODEX_HOME:base,WX_AGENT_USER:userName(name)});}
export async function provisionUser(base,name) {
  const p=userPaths(base,name);await privateDir(base);await privateDir(path.join(base,'users'));
  if(await fs.lstat(p.dir).then(()=>true,()=>false))throw Error('该用户已存在，请使用 user login / start，不会覆盖绑定');
  await fs.mkdir(p.dir,{mode:0o700});await privateDir(p.workspace);
  const source=await readJSON(path.join(base,'config.json'),{}),config={workspace:p.workspace};
  for(const key of ['engine','codexAuth','codexBaseUrl','codexModel','codexApiKeyEnv','codexProxy','claudeAuth','claudeBaseUrl','claudeApiKeyEnv','claudeModel','claudeProxy'])if(source[key]!==undefined)config[key]=source[key];
  await writeJSON(p.config,config);return p;
}
export async function profileState(p) {
  try {const state=await control(p);if(state.service==='wx-codex')return state;}catch{}
  const pid=Number(await fs.readFile(p.lock,'utf8').catch(()=>''));
  if(alive(pid))return {status:'starting',task:'启动或配置中'};
  return null;
}
export async function requireUser(base,name) {
  const p=userPaths(base,name);const stat=await fs.lstat(p.dir).catch(()=>null);
  if(!stat?.isDirectory()||stat.isSymbolicLink())throw Error('用户不存在或目录无效，请先 user add');
  if((await fs.lstat(path.join(base,'users'))).isSymbolicLink())throw Error('用户目录不能是符号链接');
  return p;
}
export async function archiveUser(base,name) {
  const p=await requireUser(base,name);if(await profileState(p))throw Error('请先停止该用户，再移除；不会中断正在执行的任务');
  const archive=path.join(base,'removed-users');await privateDir(archive);
  const target=path.join(archive,`${name}-${Date.now()}`);await fs.rename(p.dir,target);return target;
}
