import {createHash} from 'node:crypto';
import {CodexRPC} from './rpc.mjs';
import {ClaudeRPC} from './claude.mjs';
import {Controller} from './controller.mjs';
export function engineName(value='codex') {
  if(!['codex','claude'].includes(value))throw new Error('引擎只能是 codex 或 claude');
  return value;
}
export function engineState(state,engine,cwd) {
  engineName(engine);
  state.projectSessions ||= {};
  const key=createHash('sha256').update(cwd).digest('hex');
  const slot=state.projectSessions[key] ||= {};
  if(!slot[engine])slot[engine]=state[engine] && (!state[engine].workspace || state[engine].workspace===cwd)?state[engine]:{};
  slot[engine].workspace=cwd;state[engine]=slot[engine];return slot[engine];
}
export function makeController({engine,cwd,config,state,save,send,onFinish}) {
  engineName(engine);
  const proxy=process.env[engine==='codex'?'BRIDGE_CODEX_PROXY':'BRIDGE_CLAUDE_PROXY'] || config[engine==='codex'?'codexProxy':'claudeProxy'];
  const rpc=engine==='codex'?new CodexRPC({cwd,proxy,config}):new ClaudeRPC({cwd,proxy,auth:config.claudeAuth || 'local',model:config.claudeModel});
  return new Controller({rpc,cwd,state:engineState(state,engine,cwd),save,send,onFinish,quiet:config.notifications!=='verbose',label:engine==='codex'?'Codex':'Claude Code'});
}
