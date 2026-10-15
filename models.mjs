import {codexSettings} from './codex-config.mjs';
export function modelName(value) {
  if(typeof value!=='string' || !/^[A-Za-z0-9][A-Za-z0-9._:/@+\[\]-]{0,199}$/.test(value))throw new Error('模型名不合法，请输入服务商提供的模型 ID，不要输入密钥或空格');
  return value;
}
export function modelInfo(config,engine) {
  return {engine,model:config[engine+'Model'] || (engine==='codex' && config.codexAuth==='api'?process.env.OPENAI_MODEL:'') || null};
}
export function modelConfig(config,engine,value) {
  if(!['codex','claude'].includes(engine))throw new Error('引擎只能是 codex 或 claude');
  return {...config,[engine+'Model']:modelName(value)};
}
export function prepareModel(config,engine,value) {
  const next=modelConfig(config,engine,value);
  const settings=engine==='codex'?codexSettings(next):null;
  return {config:next,apply(controller) {
    if(engine==='codex')controller.rpc.settings=settings;
    else {controller.rpc.model=next.claudeModel;controller.rpc.observedModel=null;}
    controller.loaded=false;
  }};
}

export async function modelListText(config,engine,rpc) {
  const info=modelInfo(config,engine);
  const header=`当前引擎：${engine}\n模型设置：${info.model || '沿用引擎默认模型'}`;
  const usage='发送 /模型 模型ID 切换（终端：wx-agent model 模型ID）。';
  if(engine==='codex' && config.codexAuth==='api')return `${header}\n\nAPI 模式暂不能自动获取服务商可用模型清单，请以服务商控制台的模型 ID 为准。\n${usage}`;
  if(!rpc && engine==='claude')return `${header}\n\n桥接未运行，启动后可查询 Claude Code 模型目录。\n${usage}`;
  if(!rpc)return `${header}\n\n桥接未运行，启动后可查询 Codex 模型目录。\n${usage}`;
  let timer;
  try {
    const result=await Promise.race([rpc.request('model/list',{limit:100,includeHidden:false}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('timeout')),8000);})]);
    const ids=[...new Set((result?.data || []).filter(m=>!m.hidden).map(m=>m.model || m.id).filter(id=>{try {modelName(id);return true;}catch{return false;}}))];
    if(!ids.length)throw new Error('empty');
    return `${header}${engine==='claude'?'\n最近任务实际模型：'+(result.currentModel || '尚未收到任务启动信息'):''}\n\n${engine==='claude'?'Claude Code':'Codex'} 返回的可选模型：\n${ids.slice(0,50).map(id=>'/模型 '+id).join('\n')}${result.nextCursor || ids.length>50?'\n（仅显示首批模型，也可直接输入其他模型 ID。）':''}\n\n模型目录不保证账号额度或服务商权限。${usage}`;
  }catch {return `${header}\n\n暂时无法获取 ${engine==='claude'?'Claude Code':'Codex'} 模型目录，请稍后重试。${engine==='claude'?'\n备用 CLI 别名（不是账号授权清单）：\n/模型 sonnet\n/模型 opus':''}\n仍可直接输入已知模型 ID。\n${usage}`;}
  finally{clearTimeout(timer);}
}
