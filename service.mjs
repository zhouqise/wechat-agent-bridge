import net from 'node:net';
import fs from 'node:fs/promises';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {readJSON,writeJSON} from './paths.mjs';

export async function control(p,command='status',params={}) {
  const token=(await readJSON(p.controlToken,{})).token;
  return new Promise((resolve,reject)=>{
    const socket=net.createConnection(p.socket);let text='';
    const timer=setTimeout(()=>{socket.destroy();reject(new Error('管理接口超时'));},command==='models'?12000:2000);
    socket.on('connect',()=>socket.write(JSON.stringify({...params,command,token})+'\n'));
    socket.on('data',buf=>{
      text+=buf.toString();
      if(text.length>32000){socket.destroy();return;}
      if(text.includes('\n')) {try {const result=JSON.parse(text.split('\n')[0]);clearTimeout(timer);socket.destroy();resolve(result);}catch{clearTimeout(timer);socket.destroy();reject(new Error('管理接口响应异常'));}}
    });
    socket.on('error',e=>{clearTimeout(timer);reject(e);});
    socket.on('close',()=>{clearTimeout(timer);reject(new Error('管理连接关闭'));});
  });
}
export async function serve(p,status,stop,setModel,listModels) {
  const win=p.platform==='win32';
  const token=randomBytes(32).toString('hex');
  if(!win && Buffer.byteLength(p.socket)>100)throw new Error('数据目录路径过长，请用 WX_CODEX_HOME 指定较短路径');
  if(!win)await fs.rm(p.socket,{force:true});
  const server=net.createServer(socket=>{
    let data='';socket.setTimeout(2000,()=>socket.destroy());
    socket.on('error',()=>{});
    socket.on('data',buf=>{
      data+=buf.toString();if(data.length>1024){socket.destroy();return;}
      if(!data.includes('\n'))return;
      let command,request;
      try {
        request=JSON.parse(data.split('\n')[0]);command=request.command;
        if(typeof request.token!=='string' || request.token.length!==64 || !timingSafeEqual(Buffer.from(request.token),Buffer.from(token))) {
          socket.end('{"error":"unauthorized"}\n');socket.removeAllListeners('data');return;
        }
      }catch{socket.destroy();return;}
      if(command==='status')socket.end(JSON.stringify({service:'wx-codex',...status()})+'\n');
      else if(command==='stop-if-idle') {if(status().task!=='空闲')socket.end('{"error":"busy"}\n');else {socket.end(JSON.stringify({service:'wx-codex',stopping:true})+'\n');stop();}}
      else if(command==='stop') {socket.end(JSON.stringify({service:'wx-codex',stopping:true})+'\n');setTimeout(stop,100);}
      else if(command==='models' && listModels) {
        socket.setTimeout(12000);
        Promise.resolve().then(listModels).then(text=>socket.end(JSON.stringify({text})+'\n'),()=>socket.end('{"error":"无法获取模型目录"}\n'));
      }
      else if(command==='model' && setModel) {
        Promise.resolve().then(()=>setModel(request.model)).then(result=>socket.end(JSON.stringify(result)+'\n'),e=>socket.end(JSON.stringify({error:e.message})+'\n'));
      }
      else socket.end('{"error":"unknown command"}\n');
      socket.removeAllListeners('data');
    });
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(p.socket,resolve);});
  try {
    if(!win)await fs.chmod(p.socket,0o600);
    await writeJSON(p.controlToken,{token});
  }catch(e){server.close();throw e;}
  return {close:async()=>{
    await new Promise(resolve=>server.close(resolve));
    if(!win)await fs.rm(p.socket,{force:true});
    await fs.rm(p.controlToken,{force:true});
  }};
}
