import {codexSettings} from './codex-config.mjs';
export function modelName(value) {
  if(typeof value!=='string' || !/^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,199}$/.test(value))throw new Error('模型名不合法，请输入服务商提供的模型 ID，不要输入密钥或空格');
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
    else controller.rpc.model=next.claudeModel;
    controller.loaded=false;
  }};
}
