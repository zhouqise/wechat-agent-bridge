import fs from 'node:fs/promises';
import path from 'node:path';
import {randomBytes,randomUUID,createHash,createCipheriv} from 'node:crypto';
import {api} from './bridge.mjs';
import {outputFile,inspectOffice} from './office.mjs';
export async function sendOfficeFile({cwd,name,state,contextToken,fetcher=fetch,apiFn=api,inspect=inspectOffice}) {
  if(!contextToken)throw new Error('需要微信会话上下文');
  const file=await outputFile(cwd,name);await inspect(file);
  const bytes=await fs.readFile(file);if(bytes.length>20*1024*1024)throw new Error('文件超过 20 MB');
  const key=randomBytes(16),filekey=randomBytes(16).toString('hex'),cipher=createCipheriv('aes-128-ecb',key,null);
  const encrypted=Buffer.concat([cipher.update(bytes),cipher.final()]);
  const ticket=await apiFn(state.base,'ilink/bot/getuploadurl',{filekey,media_type:3,to_user_id:state.owner,rawsize:bytes.length,rawfilemd5:createHash('md5').update(bytes).digest('hex'),filesize:encrypted.length,no_need_thumb:true,aeskey:key.toString('hex')},state.token);
  let url;
  try {
    url=new URL(ticket.upload_full_url || 'https://novac2c.cdn.weixin.qq.com/c2c/upload?encrypted_query_param='+encodeURIComponent(ticket.upload_param || '')+'&filekey='+filekey);
    if((!ticket.upload_full_url && !ticket.upload_param) || url.protocol!=='https:' || url.hostname!=='novac2c.cdn.weixin.qq.com' || url.username || url.password || url.port || url.hash)throw Error();
  }catch{throw new Error('微信文件上传地址不受支持');}
  const response=await fetcher(url.href,{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:encrypted,redirect:'error',signal:AbortSignal.timeout(30000)});
  const param=response.headers.get('x-encrypted-param');await response.body?.cancel();
  if(!response.ok || !param)throw new Error('微信文件上传未确认');
  const sent=await apiFn(state.base,'ilink/bot/sendmessage',{msg:{from_user_id:'',to_user_id:state.owner,client_id:randomUUID(),message_type:2,message_state:2,context_token:contextToken,item_list:[{type:4,file_item:{file_name:path.basename(file),len:String(bytes.length),media:{encrypt_query_param:param,aes_key:Buffer.from(key.toString('hex')).toString('base64'),encrypt_type:1}}}]}},state.token);
  if(sent.ret!==0)throw new Error('文件发送未确认');
}
