import {PairingManager} from './pairing-manager.mjs';
import {authView,saveAuth,saveModel} from './auth-settings.mjs';
import {fileURLToPath} from 'node:url';
import http from 'node:http';
import fs from 'node:fs/promises';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import {paths,readJSON,privateDir,acquireLock,releaseLock} from './paths.mjs';
import {userNames,requireUser,profileState,provisionUser,removeStoppedUser} from './users.mjs';
import {readLogs,clearLogs} from './logs.mjs';
import {workspace} from './workspace.mjs';
import {projectList} from './projects.mjs';
import {control} from './service.mjs';
const run=promisify(execFile);
export async function startDashboard({base=paths().baseDir,port=0,pairingOptions={}}={}) {
  const token=randomBytes(32).toString('hex');let origin;
  const resolveUser=async name=>name==='default'?paths({WX_CODEX_HOME:base}):requireUser(base,name);
  const startService=async user=>{await run(process.execPath,[fileURLToPath(new URL('./wx-agent.mjs',import.meta.url)),'start'],{env:{...process.env,WX_CODEX_HOME:base,WX_AGENT_USER:user==='default'?'':user},timeout:30000,maxBuffer:8192,windowsHide:true});};
  const pairing=new PairingManager({resolveUser,startService,...pairingOptions});
  const server=http.createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    const reply=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};
    try {
      if(req.headers.host!==new URL(origin).host || req.headers.origin && req.headers.origin!==origin)return reply(403,{error:'来源不允许'});
      if(req.method==='GET' && ['/','/dashboard.js','/dashboard.css'].includes(req.url)){
        const name=req.url==='/'?'dashboard.html':req.url.slice(1);
        res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html; charset=utf-8');res.end(await fs.readFile(new URL('./dashboard/'+name,import.meta.url)));return;
      }
      const auth=req.headers.authorization || '',expected='Bearer '+token;
      if(Buffer.byteLength(auth)!==Buffer.byteLength(expected)||!timingSafeEqual(Buffer.from(auth),Buffer.from(expected)))return reply(401,{error:'请使用终端输出的完整管理链接'});
      if(req.url!=='/api' || req.method!=='POST' || req.headers.origin!==origin || req.headers['content-type']!=='application/json')return reply(403,{error:'请求不允许'});
      req.setEncoding('utf8');let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>4096)return reply(413,{error:'请求过大'});}
      const body=JSON.parse(raw),{action,user='default',value='',operation,confirm}=body;
      if(action==='users'){
        const names=['default',...await userNames(base)];
        const users=await Promise.all(names.map(async name=>{const p=await resolveUser(name),status=await profileState(p),config=await readJSON(p.config,{});return {name,status,bound:!!(await readJSON(p.session,{})).owner,engine:config.engine || 'codex',projectEntries:Object.entries(projectList(config,p.workspace)).map(([name,path])=>({name,path})),workspace:status?.workspace || projectList(config,p.workspace)[config.currentProject || 'default'] || p.workspace};}));return reply(200,{users});
      }
      if(action==='user-create'){await privateDir(base);const guard={lock:path.join(base,'users.lock')};await acquireLock(guard);try{const created=await provisionUser(base,value);return reply(200,{ok:true,user:value,workspace:created.workspace,bound:false});}finally{await releaseLock(guard);}}
      if(action==='user-remove'){if(confirm!==true)throw Error('请确认删除已停止用户');const archive=await removeStoppedUser(base,user);return reply(200,{ok:true,archive});}
      const p=await resolveUser(user);
      if(action==='pairing-start')return reply(200,await pairing.begin(user));
      if(action==='pairing-status')return reply(200,pairing.status(user,body.operationId));
      if(action==='pairing-code')return reply(200,pairing.code(user,body.operationId,value));
      if(action==='pairing-cancel')return reply(200,await pairing.cancel(user,body.operationId));
      if(action==='workspace'){if(typeof value!=='string' || !value.trim())throw Error('请输入完整目录路径');return reply(200,await workspace(p,value));}
      if(action==='inspect')return reply(200,await control(p,'admin',{action:'inspect'}));
      if(action==='admin'){
        if(!['engine','project','new','switch','delete','clear','notifications'].includes(operation))throw Error('未知操作');
        return reply(200,await control(p,'admin',{action:operation,value}));
      }
      if(action==='model')return reply(200,await saveModel(p,value));
      if(action==='auth-read')return reply(200,authView(await readJSON(p.config,{}),body.engine,process.env,body.auth));
      if(action==='auth-save'){const {action:_,user:__,...input}=body;return reply(200,await saveAuth(p,input));}
      if(action==='models')return reply(200,await control(p,'models'));
      if(action==='stop')return reply(200,await control(p,'stop-if-idle'));
      if(action==='start'){try{await startService(user);}catch{throw Error('启动未确认成功，请查看状态和日志后重试');}return reply(200,{ok:true});}
      if(action==='logs')return reply(200,await readLogs(p));
      if(action==='logs-clear'){if(confirm!==true)throw Error('请确认清除当前用户日志');return reply(200,await clearLogs(p));}
      reply(400,{error:'未知操作'});
    }catch(e){reply(400,{...(e.cleared!==undefined?{cleared:e.cleared}:{}),error:['ENOENT','ECONNREFUSED'].includes(e.code)?'服务未运行，请先启动':e.message?.slice(0,300) || '操作失败'});}
  });
  server.requestTimeout=15000;server.headersTimeout=10000;
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  origin=`http://127.0.0.1:${server.address().port}`;
  return {server,url:origin+'/#'+token,origin,token,close:async()=>{await pairing.close();await new Promise(r=>server.close(r));}};
}
