import {authSession} from './auth-sessions.mjs';
import {CodexRPC} from './rpc.mjs';
import {ClaudeRPC} from './claude.mjs';
import {Controller} from './controller.mjs';
export function engineName(value='codex') {
  if(!['codex','claude'].includes(value))throw new Error('引擎只能是 codex 或 claude');
  return value;
}
export function engineState(state,engine,cwd,config={}) {
  engineName(engine);
  return authSession(state,engine,cwd,config);
}
export function makeController({engine,cwd,config,state,save,send,onFinish}) {
  engineName(engine);
  const proxy=process.env[engine==='codex'?'BRIDGE_CODEX_PROXY':'BRIDGE_CLAUDE_PROXY'] || config[engine==='codex'?'codexProxy':'claudeProxy'];
  const rpc=engine==='codex'?new CodexRPC({cwd,proxy,config}):new ClaudeRPC({cwd,proxy,config,auth:config.claudeAuth || 'local',model:config.claudeModel});
  return new Controller({rpc,cwd,state:engineState(state,engine,cwd,config),save,send,onFinish,quiet:config.notifications!=='verbose',label:engine==='codex'?'Codex':'Claude Code'});
}
