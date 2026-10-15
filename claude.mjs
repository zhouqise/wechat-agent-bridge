import {EventEmitter} from 'node:events';
import {randomUUID} from 'node:crypto';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createInterface} from 'node:readline';
import fs from 'node:fs/promises';
import path from 'node:path';
import {claudeCommand,stopChild} from './platform.mjs';
const exec=promisify(execFile);
const TOOLS=['Read','Glob','Grep','Bash','Edit','Write'];

export function claudeInput(input) {
  return input.map(item=>{
    if(item.type==='text')return {type:'text',text:item.text};
    const m=item.type==='image' && item.url?.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
    if(!m)throw new Error('不支持的 Claude 图像输入');
    return {type:'image',source:{type:'base64',media_type:m[1],data:m[2]}};
  });
}
export async function inWorkspace(cwd,value) {
  if(typeof value!=='string' || !value)return false;
  const root=await fs.realpath(cwd);let current=path.resolve(root,value),suffix=[];
  while(true) {
    try {current=path.join(await fs.realpath(current),...suffix);break;}
    catch(e){if(e.code!=='ENOENT')return false;const parent=path.dirname(current);if(parent===current)return false;suffix.unshift(path.basename(current));current=parent;}
  }
  const relative=path.relative(root,current);
  return relative==='' || (!relative.startsWith('..'+path.sep) && relative!=='..' && !path.isAbsolute(relative));
}
export class ClaudeRPC extends EventEmitter {
  constructor({cwd,proxy,auth='local',binary,spawnFn=spawn,check=exec}={}) {
    super();Object.assign(this,{cwd,proxy,auth,spawnFn,check});this.pending=new Map();this.closed=false;
    if(!['local','api'].includes(auth))throw new Error('Claude 认证方式只能是 local 或 api');
    this.env={...process.env};if(binary)this.env.CLAUDE_BINARY=binary;
    if(auth==='api'){delete this.env.CLAUDE_CODE_OAUTH_TOKEN;delete this.env.ANTHROPIC_AUTH_TOKEN;}
    if(proxy){const u=new URL(proxy);if(!['http:','https:','socks5:','socks5h:'].includes(u.protocol)||u.username||u.password)throw new Error('Claude 代理地址不合法');
      this.env.HTTPS_PROXY=this.env.HTTP_PROXY=this.env.ALL_PROXY=proxy;
      this.env.https_proxy=this.env.http_proxy=this.env.all_proxy=proxy;}
  }
  async initialize() {
    if(this.auth==='api' && !this.env.ANTHROPIC_API_KEY)throw new Error('请在启动桥接的终端设置 ANTHROPIC_API_KEY；不要在微信中发送密钥');
    const c=claudeCommand(['--version'],{env:this.env});
    try{await this.check(c.file,c.args,{cwd:this.cwd,env:this.env,windowsHide:true,timeout:10000});}
    catch{throw new Error('Claude Code 不可用，请在电脑上安装并登录 Claude Code 后重试');}
  }
  async request(method,p={}) {
    if(this.closed)throw new Error('Claude 适配器已关闭');
    if(method==='thread/start' || method==='thread/resume') {
      if(this.run)throw new Error('任务仍在执行');
      this.threadId=p.threadId || randomUUID();this.resume=method==='thread/resume';this.instructions=p.developerInstructions;
      return {thread:{id:this.threadId}};
    }
    if(method==='turn/start') {
      if(this.run)throw new Error('已有任务执行中');
      const turnId=randomUUID(), content=claudeInput(p.input);
      const args=['-p','--input-format','stream-json','--output-format','stream-json','--verbose',
        '--permission-prompt-tool','stdio','--permission-mode','default','--setting-sources',this.auth==='local'?'user':'',
        '--settings',JSON.stringify({disableAllHooks:true,permissions:{ask:TOOLS}}),
        '--strict-mcp-config','--mcp-config','{"mcpServers":{}}','--no-chrome','--disable-slash-commands',
        '--tools',TOOLS.join(','),'--append-system-prompt',this.instructions || '仅操作当前工作区，用中文回复。',
        this.resume?'--resume':'--session-id',this.threadId];
      const command=claudeCommand(args,{env:this.env});
      const child=this.spawnFn(command.file,command.args,{cwd:this.cwd,env:this.env,stdio:['pipe','pipe','pipe'],shell:false,windowsHide:true});
      const run={child,turnId,threadId:this.threadId,content,initialized:false};this.run=run;
      run.lines=createInterface({input:child.stdout});
      child.stderr.on('data',()=>{});
      child.stdin.on('error',()=>this.finish(run,'failed','Claude 通信失败，请检查本机登录及网络。'));
      child.on('error',()=>this.finish(run,'failed','Claude 启动失败，请检查本机安装。'));
      child.on('exit',()=>this.finish(run,'failed','Claude 提前退出，请检查登录、网络或发送 /新会话 后重试。'));
      run.lines.on('line',line=>{let m;try{m=JSON.parse(line);}catch{return;}void this.message(run,m).catch(()=>this.finish(run,'failed','Claude 协议处理失败，请检查 CLI 版本。'));});
      run.timer=setTimeout(()=>this.finish(run,'failed','Claude 初始化超时，请检查电脑。'),30000);run.timer.unref?.();
      this.write(run,{type:'control_request',request_id:'initialize',request:{subtype:'initialize',hooks:{}}});
      return {turn:{id:turnId}};
    }
    if(method==='turn/interrupt') {
      if(this.run && p.turnId===this.run.turnId)this.finish(this.run,'interrupted','已停止本次 Claude 任务。');
      return {};
    }
    throw new Error('不支持的 Claude 适配请求');
  }
  write(run,message) {if(this.run===run && !run.child.stdin.destroyed)run.child.stdin.write(JSON.stringify(message)+'\n');}
  notify(run,method,params) {this.emit('notification',{method,params:{threadId:run.threadId,turnId:run.turnId,...params}});}
  async message(run,m) {
    if(this.run!==run)return;
    if(m.type==='control_response' && m.response?.request_id==='initialize') {
      if(m.response.subtype!=='success')return this.finish(run,'failed','Claude 不支持当前通信协议，请更新 Claude Code。');
      if(run.initialized)return;run.initialized=true;clearTimeout(run.timer);
      this.write(run,{type:'user',session_id:run.threadId,message:{role:'user',content:run.content},parent_tool_use_id:null});
      run.content=null;return;
    }
    if(m.type==='system' && m.subtype==='init' && m.session_id===run.threadId){this.resume=true;return;}
    if(m.type==='control_request') {
      const r=m.request;
      if(r?.subtype!=='can_use_tool' || !TOOLS.includes(r.tool_name))return this.write(run,{type:'control_response',response:{subtype:'error',request_id:m.request_id,error:'Unsupported request'}});
      const tool=r.tool_name,input=r.input || {};
      if(tool!=='Bash' && !await inWorkspace(this.cwd,tool==='Glob'||tool==='Grep'?(input.path || '.') : input.file_path)) {
        return this.write(run,{type:'control_response',response:{subtype:'success',request_id:m.request_id,response:{behavior:'deny',message:'只能访问配置工作区内的文件'}}});
      }
      if(this.run!==run)return;
      this.pending.set(m.request_id,{run,input});
      this.emit('request',{id:m.request_id,method:'bridge/tool/requestApproval',params:{threadId:run.threadId,turnId:run.turnId,tool,input}});return;
    }
    if(m.type==='control_cancel_request') {
      this.pending.delete(m.request_id);this.notify(run,'serverRequest/resolved',{requestId:m.request_id});return;
    }
    if(m.type==='result') {
      this.resume=true;
      if(m.is_error || m.subtype!=='success')return this.finish(run,'failed',/not logged in|authentication|invalid.*key|unauthorized/i.test(m.result || '')?'Claude 未登录或认证失效，请在电脑上检查 Claude Code 登录或 ANTHROPIC_API_KEY，然后重试。':'Claude 未完成任务，请检查本机登录、网络、模型额度或审批结果后重试。');
      return this.finish(run,'completed',typeof m.result==='string'?m.result:'未产生文字结果。');
    }
  }
  respond(id,result) {
    const p=this.pending.get(id);if(!p)return;this.pending.delete(id);
    this.write(p.run,{type:'control_response',response:{subtype:'success',request_id:id,response:result.decision==='accept'?{behavior:'allow',updatedInput:p.input}:{behavior:'deny',message:'用户未批准本次操作'}}});
  }
  reject(id){this.respond(id,{decision:'decline'});}
  finish(run,status,text) {
    if(this.run!==run)return;
    this.run=null;clearTimeout(run.timer);this.pending.clear();run.lines.close();stopChild(run.child);
    this.notify(run,'item/completed',{item:{id:run.turnId,type:'agentMessage',phase:'final_answer',text}});
    this.notify(run,'turn/completed',{turn:{id:run.turnId,status}});
  }
  close() {this.closed=true;if(this.run)this.finish(this.run,'interrupted','桥接已停止。');}
}
