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
