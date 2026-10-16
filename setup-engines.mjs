import {codexSettings} from './codex-config.mjs';
import {modelName} from './models.mjs';
export async function configureEngines({old={},ask,check=async()=>{},log=()=>{},env=process.env}) {
  const raw=(await ask(`配置引擎：1 codex / 2 claude / 3 both（两个都配置；回车使用 ${old.engine || 'codex'}）：`)).trim().toLowerCase() || old.engine || 'codex';
  const mode=({1:'codex',2:'claude',3:'both'})[raw] || raw;
  if(!['codex','claude','both'].includes(mode))throw Error('请选择 codex、claude 或 both（也可输入 1、2、3）');
  const engines=mode==='both'?['codex','claude']:[mode],config={...old};
  for(const engine of engines)await check(engine);
  for(const engine of engines){
    const label=engine==='codex'?'Codex':'Claude Code';log(`正在配置 ${label}`);
    const auth=(await ask(`${label} 认证 local（本机登录/配置）/ api（环境变量 API Key），回车保留 ${old[engine+'Auth'] || 'local'}：`)).trim() || old[engine+'Auth'] || 'local';
    if(!['local','api'].includes(auth))throw Error('认证方式请输入 local 或 api');config[engine+'Auth']=auth;
    if(engine==='codex' && auth==='api'){
      config.codexBaseUrl=(await ask(`Codex API 基础地址（回车保留 ${old.codexBaseUrl || env.OPENAI_BASE_URL || 'https://api.openai.com/v1'}）：`)).trim() || old.codexBaseUrl || env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
      config.codexApiKeyEnv=(await ask(`Codex 密钥环境变量名称（回车保留 ${old.codexApiKeyEnv || 'OPENAI_API_KEY'}，不要输入密钥）：`)).trim() || old.codexApiKeyEnv || 'OPENAI_API_KEY';
      log('Codex API 需要 Responses API；密钥只从环境变量读取。');
    }
    if(engine==='claude' && auth==='api')log('Claude API Key 从 ANTHROPIC_API_KEY 读取；自定义接口使用 ANTHROPIC_BASE_URL 环境变量，不要在向导输入密钥。');
    const current=old[engine+'Model'] || (engine==='codex'&&auth==='api'?env.OPENAI_MODEL:'') || '';
    const model=(await ask(`${label} 模型（回车保留 ${current || '引擎默认'}；输入 default 沿用引擎默认）：`)).trim();
    config[engine+'Model']=model==='default'?'':model?modelName(model):current;
    const field=engine+'Proxy',value=(await ask(`${label} 代理（回车保留 ${old[field] || '直连'}，输入 direct 改为直连）：`)).trim();
    config[field]=value==='direct'?'':value || old[field] || '';
    if(config[field]){const u=new URL(config[field]);if(!['http:','https:','socks5:','socks5h:'].includes(u.protocol)||u.username||u.password)throw Error('请输入不含账号密码的 HTTP/SOCKS 代理地址');}
    if(engine==='codex')codexSettings(config,env);
    if(engine==='claude'&&auth==='api'&&!env.ANTHROPIC_API_KEY?.trim())throw Error('请在启动终端设置 ANTHROPIC_API_KEY，再运行 setup；不要把密钥发到微信');
  }
  config.engine=mode==='both'?(await ask(`默认引擎 codex / claude（回车保留 ${old.engine || 'codex'}）：`)).trim().toLowerCase() || old.engine || 'codex':mode;
  if(!['codex','claude'].includes(config.engine))throw Error('默认引擎只能是 codex 或 claude');
  return {config,engines};
}
