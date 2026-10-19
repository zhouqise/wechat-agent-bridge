export function engineAuth(config,engine,env=process.env){
 if(!['codex','claude'].includes(engine))throw Error('引擎只能是 codex 或 claude');
 const auth=config[engine+'Auth'] || 'local';if(!['local','api'].includes(auth))throw Error('认证方式只能是 local 或 api');
 const apiKeyEnv=config[engine+'ApiKeyEnv'] || (engine==='codex'?'OPENAI_API_KEY':'ANTHROPIC_API_KEY');
 if(typeof apiKeyEnv!=='string'||apiKeyEnv.length>128||!/^[A-Za-z_][A-Za-z0-9_]*$/.test(apiKeyEnv))throw Error('API Key 环境变量名称不合法');
 const value=config[engine+'BaseUrl'] || env[engine==='codex'?'OPENAI_BASE_URL':'ANTHROPIC_BASE_URL'] || (engine==='codex'?'https://api.openai.com/v1':'https://api.anthropic.com');
 let url;try{if(typeof value!=='string'||value.length>1024)throw Error();url=new URL(value);}catch{throw Error('API 地址不合法');}
 if((url.protocol!=='https:' && !(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)))||url.username||url.password||url.search||url.hash)throw Error('API 地址须为 HTTPS（本机回环允许 HTTP），且不含账号、密钥、查询参数或片段');
 return {auth,apiKeyEnv,baseUrl:url.href.replace(/\/$/,'')};
}
export function claudeEnvironment(config={},env=process.env){
 const result={...env};if((config.claudeAuth || 'local')!=='api')return result;
 const settings=engineAuth(config,'claude',env);
 result.ANTHROPIC_API_KEY=env[settings.apiKeyEnv];result.ANTHROPIC_BASE_URL=settings.baseUrl;
 delete result.CLAUDE_CODE_OAUTH_TOKEN;delete result.ANTHROPIC_AUTH_TOKEN;return result;
}
