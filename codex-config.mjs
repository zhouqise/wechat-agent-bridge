import {engineAuth} from './auth-config.mjs';
// Build child-process overrides without changing the user's Codex configuration.
export function codexSettings(config={},env=process.env) {
  const auth=config.codexAuth || 'local';
  if(!['local','api'].includes(auth))throw new Error('Codex 认证方式只能是 local 或 api');
  if(auth==='local')return {auth, ...(config.codexModel?{model:config.codexModel}:{}),args:config.codexModel?['-c',`model=${JSON.stringify(config.codexModel)}`]:[]};
  const {apiKeyEnv:keyEnv,baseUrl}=engineAuth(config,'codex',env);
  if(!env[keyEnv]?.trim())throw new Error('Codex API Key 环境变量未设置，请在启动桥接的终端中设置');
  const model=config.codexModel || env.OPENAI_MODEL;
  if(typeof model!=='string' || !model.trim() || /[\x00-\x1f]/.test(model))throw new Error('请配置服务商提供的 Codex API 模型 ID');
  const provider={name:'WeChat Agent API',base_url:baseUrl,env_key:keyEnv,wire_api:'responses',requires_openai_auth:false};
  const toml='{ '+Object.entries(provider).map(([k,v])=>`${k} = ${JSON.stringify(v)}`).join(', ')+' }';
  return {auth,model,args:['-c','model_provider="wx_agent_api"','-c',`model=${JSON.stringify(model)}`,'-c',`model_providers.wx_agent_api=${toml}`]};
}
