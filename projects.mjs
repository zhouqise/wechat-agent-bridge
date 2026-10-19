import fs from 'node:fs/promises';
import path from 'node:path';
export function projectName(name){if(!/^[\p{L}\p{N}_-]{1,32}$/u.test(name) || ['__proto__','constructor','prototype'].includes(name))throw Error('项目名称须为 1–32 个字母、汉字、数字、下划线或短横线');return name;}
export function projectList(config,fallback){return {default:config.workspace || fallback,...config.projects};}
export async function projectPath(config,fallback,name){
  projectName(name);const list=projectList(config,fallback);
  if(!Object.hasOwn(list,name))throw Error('项目未登记，请先在电脑上用 wx-agent project add 名称 完整目录 登记');
  const cwd=await fs.realpath(list[name]);if(!(await fs.stat(cwd)).isDirectory())throw Error('项目目录不可用');return cwd;
}
export async function addProject(config,name,dir){
  projectName(name);if(name==='default')throw Error('default 是默认工作区，请用 setup 修改');
  if(!dir || !path.isAbsolute(dir))throw Error('请提供已存在的完整目录路径');
  const cwd=await fs.realpath(dir);if(!(await fs.stat(cwd)).isDirectory())throw Error('不是目录');
  return {...config,projects:{...config.projects,[name]:cwd}};
}

// Full paths are data, never shell input. Do not expand ~ or environment variables.
export function absoluteWorkspacePath(value,platform=process.platform){
  if(typeof value!=='string' || value.length>1024 || /[\x00-\x1f\x7f]/.test(value))throw Error('目录路径无效或超过 1024 字符');
  const dir=value.trim(),flavor=platform==='win32'?path.win32:path.posix;
  if(!dir || !flavor.isAbsolute(dir) || platform==='win32' && !/^(?:[a-z]:[\\/]|[\\/]{2}[^\\/]+[\\/][^\\/]+)/i.test(dir))throw Error('请提供已有目录的完整绝对路径，不支持相对路径或 ~');
  return dir;
}
export async function prepareWorkspace(config,fallback,value){
  const dir=absoluteWorkspacePath(value);let cwd;
  try{cwd=await fs.realpath(dir);if(!(await fs.stat(cwd)).isDirectory())throw Error();await fs.access(cwd,process.platform==='win32'?fs.constants.R_OK:fs.constants.R_OK|fs.constants.X_OK);}
  catch{throw Error('目标目录不存在、不是目录或无权访问');}
  const list=projectList(config,fallback),current=config.currentProject || 'default';
  const names=Object.keys(list).sort((a,b)=>a===current?-1:b===current?1:a.localeCompare(b));
  for(const name of names){if(await fs.realpath(list[name]).catch(()=>null)===cwd)return {cwd,project:name,config:{...config,currentProject:name}};}
  const {createHash}=await import('node:crypto');
  const project='dir-'+createHash('sha256').update(cwd).digest('hex').slice(0,20);
  if(Object.hasOwn(list,project))throw Error('自动项目名称冲突，请先在电脑登记项目');
  return {cwd,project,config:{...config,currentProject:project,projects:{...config.projects,[project]:cwd}}};
}
