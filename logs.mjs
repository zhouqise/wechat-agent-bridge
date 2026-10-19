import fs from 'node:fs/promises';
import {constants} from 'node:fs';
const clearing=new Set();
export function redactLog(text){return text.replace(/(Bearer\s+)[^\s]+/gi,'$1[redacted]').replace(/((?:token|api[_-]?key|authorization)["']?\s*[=:]\s*["']?)[^\s,"'}]+/gi,'$1[redacted]').replace(/sk-[\w-]+/g,'[redacted]');}
async function openLog(file,write=false){
 const before=await fs.lstat(file).catch(e=>{if(e.code==='ENOENT')return null;throw e;});if(!before)return null;
 if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1)throw Error('日志必须为独立普通文件');
 const handle=await fs.open(file,(write?constants.O_RDWR:constants.O_RDONLY)|(constants.O_NOFOLLOW || 0));
 try{const after=await handle.stat();if(!after.isFile()||after.nlink!==1||before.dev!==after.dev||before.ino!==after.ino)throw Error('日志必须为独立普通文件');return handle;}catch(e){await handle.close();throw e;}
}
export async function readLogs(p){
 const file=await openLog(p.log);if(!file)return {text:'暂无日志',updatedAt:null,readAt:Date.now(),truncated:false};
 try{const {size,mtimeMs}=await file.stat(),start=Math.max(0,size-16000),buffer=Buffer.alloc(size-start);const {bytesRead}=await file.read(buffer,0,buffer.length,start);let text=buffer.subarray(0,bytesRead).toString('utf8');if(start){const nl=text.indexOf('\n');text=nl<0?'（末尾单行过长，暂不展示）':text.slice(nl+1);}return {text:redactLog(text),updatedAt:mtimeMs,readAt:Date.now(),truncated:start>0};}finally{await file.close();}
}
export async function clearLogs(p,{afterTruncate=async()=>{}}={}){
 if(clearing.has(p.log))throw Error('日志正在清除，请稍后刷新');clearing.add(p.log);let cleared=0;const opened=[];
 try{
  for(const name of [p.log+'.1',p.log]){const file=await openLog(name,true);opened.push({name,file,stat:file?await file.stat():null});}
  for(const entry of opened){if(!entry.file)continue;await entry.file.truncate(0);cleared++;await afterTruncate(entry.name);}
  // Rotation can replace either path while their original descriptors stay valid.
  for(const {name,stat} of opened){const current=await fs.lstat(name).catch(e=>{if(e.code==='ENOENT')return null;throw e;});if(!!current!==!!stat || current && (current.dev!==stat.dev||current.ino!==stat.ino||!current.isFile()||current.isSymbolicLink()))throw Error('日志清除期间发生轮转，请刷新后重试');}
  return {ok:true,cleared};
 }catch(e){throw Object.assign(Error(['日志必须为独立普通文件','日志清除期间发生轮转，请刷新后重试'].includes(e.message)?e.message:'日志清除未完全完成，请刷新后检查'),{cleared});}
 finally{await Promise.all(opened.map(e=>e.file?.close()));clearing.delete(p.log);}
}
