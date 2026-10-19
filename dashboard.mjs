import {fileURLToPath} from 'node:url';
import http from 'node:http';
import fs from 'node:fs/promises';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {paths,readJSON} from './paths.mjs';
import {userNames,requireUser,profileState} from './users.mjs';
import {workspace} from './workspace.mjs';
import {projectList} from './projects.mjs';
import {control} from './service.mjs';
const run=promisify(execFile);
export async function startDashboard({base=paths().baseDir,port=0}={}) {
  const token=randomBytes(32).toString('hex');let origin;
  const resolveUser=async name=>name==='default'?paths({WX_CODEX_HOME:base}):requireUser(base,name);
  const server=http.createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
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
      const {action,user='default',value='',operation}=JSON.parse(raw);
      if(action==='users'){
        const names=['default',...await userNames(base)];
        const users=await Promise.all(names.map(async name=>{const p=await resolveUser(name),status=await profileState(p),config=await readJSON(p.config,{});return {name,status,engine:config.engine || 'codex',workspace:status?.workspace || projectList(config,p.workspace)[config.currentProject || 'default'] || p.workspace};}));return reply(200,{users});
      }
      const p=await resolveUser(user);
      if(action==='workspace'){if(typeof value!=='string' || !value.trim())throw Error('请输入完整目录路径');return reply(200,await workspace(p,value));}
      if(action==='inspect')return reply(200,await control(p,'admin',{action:'inspect'}));
      if(action==='admin'){
        if(!['engine','project','new','switch','delete','clear','notifications'].includes(operation))throw Error('未知操作');
        return reply(200,await control(p,'admin',{action:operation,value}));
      }
      if(action==='model')return reply(200,await control(p,'model',{model:value}));
      if(action==='models')return reply(200,await control(p,'models'));
      if(action==='stop')return reply(200,await control(p,'stop-if-idle'));
      if(action==='start'){
        await run(process.execPath,[fileURLToPath(new URL('./wx-agent.mjs',import.meta.url)),'start'],{env:{...process.env,WX_CODEX_HOME:base,WX_AGENT_USER:user==='default'?'':user},timeout:30000,maxBuffer:8192,windowsHide:true});return reply(200,{ok:true});
      }
      if(action==='logs'){
        const file=await fs.open(p.log,'r').catch(()=>null);if(!file)return reply(200,{text:'暂无日志'});
        try{const {size}=await file.stat(),buffer=Buffer.alloc(Math.min(size,16000));await file.read(buffer,0,buffer.length,Math.max(0,size-buffer.length));
          // Logs are local-only. Redact credential-shaped values as defense in depth.
          const text=buffer.toString().replace(/(Bearer\s+)[^\s]+/gi,'$1[redacted]').replace(/((?:token|api[_-]?key|authorization)\s*[=:]\s*)[^\s,}]+/gi,'$1[redacted]').replace(/sk-[\w-]+/g,'[redacted]');return reply(200,{text});
        }finally{await file.close();}
      }
      reply(400,{error:'未知操作'});
    }catch(e){reply(400,{error:['ENOENT','ECONNREFUSED'].includes(e.code)?'服务未运行，请先启动':e.message?.slice(0,300) || '操作失败'});}
  });
  server.requestTimeout=15000;server.headersTimeout=10000;
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  origin=`http://127.0.0.1:${server.address().port}`;
  return {server,url:origin+'/#'+token,origin,token};
}
