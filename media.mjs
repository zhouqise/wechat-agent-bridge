import {createDecipheriv} from 'node:crypto';

const CDN='https://novac2c.cdn.weixin.qq.com/c2c/download';
export class MediaError extends Error {}
function downloadURL(media) {
  let url;
  try {
    if(media.full_url)url=new URL(media.full_url);
    else if(typeof media.encrypt_query_param==='string' && media.encrypt_query_param)url=new URL(CDN+'?encrypted_query_param='+encodeURIComponent(media.encrypt_query_param));
    else throw new Error();
    // Only the official CDN is supported; never attach the bot token or follow redirects.
    if(url.protocol!=='https:' || url.hostname!=='novac2c.cdn.weixin.qq.com' || url.username || url.password || url.port || url.hash)throw new Error();
  }catch{throw new MediaError('图片下载地址缺失或不受支持，请重新发送截图。');}
  return url.href;
}
function aesKey(image) {
  if(image.aeskey) {
    if(typeof image.aeskey!=='string' || !/^[a-f\d]{32}$/i.test(image.aeskey))throw new MediaError('图片解密信息无效，请重新发送截图。');
    return Buffer.from(image.aeskey,'hex');
  }
  const encoded=image.media?.aes_key;
  if(!encoded)return null;
  if(typeof encoded!=='string')throw new MediaError('图片解密信息无效，请重新发送截图。');
  const decoded=Buffer.from(encoded,'base64');
  if(decoded.length===16)return decoded;
  if(decoded.length===32 && /^[a-f\d]{32}$/i.test(decoded.toString()))return Buffer.from(decoded.toString(),'hex');
  throw new MediaError('图片解密信息无效，请重新发送截图。');
}
function mime(bytes) {
  if(bytes.length>=8 && bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')))return 'image/png';
  if(bytes.length>=3 && bytes[0]===255 && bytes[1]===216 && bytes[2]===255)return 'image/jpeg';
  if(bytes.length>=12 && bytes.toString('ascii',0,4)==='RIFF' && bytes.toString('ascii',8,12)==='WEBP')return 'image/webp';
  throw new MediaError('图片格式暂不支持或文件损坏，请发送 PNG、JPEG 或 WebP 截图。');
}
async function boundedBytes(response,maxBytes) {
  if(!response.ok)throw new MediaError(`图片下载失败（HTTP ${response.status}），请重新发送。`);
  const declared=Number(response.headers.get('content-length'));
  if(declared>maxBytes){await response.body?.cancel();throw new MediaError('图片超过大小限制，请缩小后重新发送。');}
  if(!response.body)throw new MediaError('图片内容为空，请重新发送。');
  const reader=response.body.getReader();let total=0;const chunks=[];
  try {
    while(true){const {value,done}=await reader.read();if(done)break;total+=value.length;
      if(total>maxBytes){await reader.cancel();throw new MediaError('图片超过大小限制，请缩小后重新发送。');}
      chunks.push(Buffer.from(value));
    }
  }finally{reader.releaseLock();}
  return Buffer.concat(chunks,total);
}
// Images stay in memory; Codex receives data URLs rather than CDN credentials or local paths.
export async function imageInputs(items,{fetcher=fetch,maxBytes=10*1024*1024,signal}={}) {
  const images=items.filter(i=>i.type===2);
  if(images.length>4)throw new MediaError('每条消息最多处理 4 张图片，请分批发送。');
  const inputs=[];let total=0;
  for(const item of images) {
    try {
      const image=item.image_item || {},media=image.media || {};
      const url=downloadURL(media),key=aesKey(image);
      const response=await fetcher(url,{redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(30000)]):AbortSignal.timeout(30000)});
      let bytes=await boundedBytes(response,maxBytes);
      if(key){try{const decipher=createDecipheriv('aes-128-ecb',key,null);bytes=Buffer.concat([decipher.update(bytes),decipher.final()]);}catch{throw new MediaError('图片解密失败，请重新发送截图。');}}
      total+=bytes.length;
      if(total>20*1024*1024)throw new MediaError('本条消息的图片总大小超过 20 MB，请分批发送。');
      inputs.push({type:'image',url:`data:${mime(bytes)};base64,${bytes.toString('base64')}`});
    }catch(e){if(e instanceof MediaError)throw e;throw new MediaError('图片下载超时或连接失败，请稍后重新发送。');}
  }
  return inputs;
}

export async function downloadMedia(item,{fetcher=fetch,maxBytes=50*1024*1024,signal}={}) {
  try {
    const response=await fetcher(downloadURL(item.media || {}),{redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(30000)]):AbortSignal.timeout(30000)});
    let bytes=await boundedBytes(response,maxBytes);
    const key=aesKey(item);
    if(key){const d=createDecipheriv('aes-128-ecb',key,null);bytes=Buffer.concat([d.update(bytes),d.final()]);}
    return bytes;
  }catch {if(signal?.aborted)throw new MediaError('已取消媒体处理');throw new MediaError('媒体下载或解密失败，可能超过大小限制，请重新发送较短的语音或视频。');}
}
