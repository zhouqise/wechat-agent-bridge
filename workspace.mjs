import fs from 'node:fs/promises';
import {readJSON,writeJSON,privateDir,acquireLock,releaseLock,alive} from './paths.mjs';
import {projectPath,prepareWorkspace} from './projects.mjs';
import {control} from './service.mjs';

// Online mutations belong to the daemon. An uncertain IPC result is never retried offline.
export async function workspace(p,value){
  let status;
  try{status=await control(p);}catch(e){
    if(!['ENOENT','ECONNREFUSED'].includes(e.code))throw Error('服务状态未确认，请稍后查询；未修改目录');
    const pid=Number(await fs.readFile(p.lock,'utf8').catch(()=>''));
    if(alive(pid))throw Error('服务正在启动或管理连接不可用，请稍后查询状态；未修改目录');
  }
  if(status){
    if(status.service!=='wx-codex' || !status.workspace)throw Error('当前服务不支持目录管理');
    if(value===undefined)return {ok:true,workspace:status.workspace,project:status.project,conversation:status.conversation,applied:'live'};
    try{return await control(p,'admin',{action:'workspace',value});}
    catch{throw Error('切换结果未确认，请用 wx-agent workspace 查询；不会自动重试');}
  }
  if(value===undefined){const config=await readJSON(p.config,{});return {ok:true,workspace:await projectPath(config,p.workspace,config.currentProject || 'default'),project:config.currentProject || 'default',conversation:null,applied:'next-start'};}
  await privateDir(p.dir);await acquireLock(p);
  try{
    const config=await readJSON(p.config,{}),next=await prepareWorkspace(config,p.workspace,value);
    await writeJSON(p.config,next.config);
    return {ok:true,workspace:next.cwd,project:next.project,conversation:null,applied:'next-start'};
  }finally{await releaseLock(p);}
}
