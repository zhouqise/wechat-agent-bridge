import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {FILE_EXTS,outputFile,workspaceDir} from './office.mjs';
export async function outputSnapshot(cwd){
  const result=new Map(),dir=await workspaceDir(cwd,'wx-agent-output');
  const entries=await fs.readdir(dir);if(entries.length>500)throw Error('输出目录超过 500 项，请先整理后使用自动回传');
  let total=0;
  for(const name of entries.sort()){
    if(!FILE_EXTS.includes(path.extname(name).toLowerCase()))continue;
    try{const file=await outputFile(cwd,name),s=await fs.stat(file);total+=s.size;if(total>100*1024*1024)throw Error('budget');
      const bytes=await fs.readFile(file);if(bytes.length>20*1024*1024)continue;
      result.set(name,createHash('sha256').update(bytes).digest('hex'));
    }catch(e){if(e.message==='budget')throw Error('输出目录超过 100 MB，请先整理后使用自动回传');}
  }
  return result;
}
export async function returnFiles({cwd,before,send,say}){
  if(!before)return;
  const after=await outputSnapshot(cwd),changed=[...after].filter(([n,h])=>before.get(n)!==h).map(([n])=>n);
  for(const name of changed.slice(0,5)){
    try{await send(name);}
    catch{await say(`文件 ${name} 发送未确认，不会自动重发。确认未收到后可用 /文件 ${name} 取回。`);}
  }
  if(changed.length>5)await say('本次结果超过 5 个，已尝试自动回传前 5 个；其余请用 /文件 查看并取回。');
}
