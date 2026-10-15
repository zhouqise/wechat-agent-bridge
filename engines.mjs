import {CodexRPC} from './rpc.mjs';
import {ClaudeRPC} from './claude.mjs';
import {Controller} from './controller.mjs';
export function engineName(value='codex') {
  if(!['codex','claude'].includes(value))throw new Error('引擎只能是 codex 或 claude');
  return value;
}
export function engineState(state,engine,cwd) {
  engineName(engine);
  if(!state[engine] || (state[engine].workspace && state[engine].workspace!==cwd))state[engine]={};
  state[engine].workspace=cwd;return state[engine];
}
export function makeController({engine,cwd,config,state,save,send}) {
  engineName(engine);
  const proxy=process.env[engine==='codex'?'BRIDGE_CODEX_PROXY':'BRIDGE_CLAUDE_PROXY'] || config[engine==='codex'?'codexProxy':'claudeProxy'];
  const rpc=engine==='codex'?new CodexRPC({cwd,proxy,config}):new ClaudeRPC({cwd,proxy,auth:config.claudeAuth || 'local'});
  return new Controller({rpc,cwd,state:engineState(state,engine,cwd),save,send,label:engine==='codex'?'Codex':'Claude Code'});
}
