import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {imageInputs,downloadMedia,MediaError} from './media.mjs';
const exec=promisify(execFile);
const LIMIT=120;
async function command(bin,args,signal,run=exec) {
  try {return await run(bin,args,{signal,timeout:120000,maxBuffer:2*1024*1024,windowsHide:true,shell:false});}
  catch(e){if(signal?.aborted)throw new MediaError('已取消媒体处理');if(e.code==='ENOENT')throw new MediaError('缺少媒体组件，请在电脑安装 FFmpeg，详情见 README。');throw new MediaError('媒体解析或识别失败，请发送 2 分钟以内的语音或 MP4 视频。');}
}
export async function mediaInputs(items,{signal,fetcher=fetch,run=exec,env=process.env}={}) {
  const av=items.filter(i=>i.type===3 || i.type===5);
  if(av.length>1)throw new MediaError('每条消息最多处理一段语音或一个视频。');
  const images=await imageInputs(items,{fetcher,signal});
  if(!av.length)return images;
  const item=av[0],voice=item.type===3,content=voice?item.voice_item:item.video_item;
  if(!content)throw new MediaError('媒体信息缺失，请重新发送。');
  const transcript=voice && typeof content.text==='string'?content.text.trim():'';
  if(transcript) {
    if(transcript.length>12000)throw new MediaError('语音转文字过长，请分段发送。');
    return [{type:'text',text:'以下是用户语音的微信转文字（可能有识别错误）：\n'+transcript},...images];
  }
  if(voice)throw new MediaError('这条语音没有微信附带的转文字，请在微信转成文字后重新发送文字内容。');
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'wx-agent-media-'));await fs.chmod(dir,0o700);
  try {
    signal?.throwIfAborted();
    let bytes=await downloadMedia(content,{fetcher,signal,maxBytes:voice?4*1024*1024:50*1024*1024});
    if(bytes.toString('ascii',4,8)!=='ftyp')throw new MediaError('视频暂支持 MP4，请转换格式后发送。');
    const format='mov';
    const input=path.join(dir,'input');await fs.writeFile(input,bytes,{mode:0o600});
    const ffmpeg=env.FFMPEG_BINARY || 'ffmpeg',ffprobe=env.FFPROBE_BINARY || 'ffprobe';
    const probe=JSON.parse((await command(ffprobe,['-v','error','-protocol_whitelist','file,pipe','-f',format,'-show_format','-show_streams','-of','json',input],signal,run)).stdout);
    const duration=Number(probe.format?.duration);
    if(!Number.isFinite(duration) || duration<=0 || duration>LIMIT)throw new MediaError('媒体时长无效或超过 2 分钟，请分段发送。');
    const result=[...images];
    if(!voice) {
      if(!probe.streams?.some(s=>s.codec_type==='video'))throw new MediaError('视频中没有可读取画面。');
      result.push({type:'text',text:`用户发送了 ${duration.toFixed(1)} 秒视频。以下为均匀抽取的 6 个画面，仅代表采样时刻，不能据此断言所有动作或细节。`});
      for(let i=0;i<6;i++) {
        signal?.throwIfAborted();
        const time=duration*i/6,file=path.join(dir,`frame-${i}.jpg`);
        await command(ffmpeg,['-nostdin','-v','error','-protocol_whitelist','file,pipe','-f',format,'-ss',String(time),'-i',input,'-frames:v','1','-vf','scale=768:768:force_original_aspect_ratio=decrease','-threads','1','-y',file],signal,run);
        const frame=await fs.readFile(file);if(frame.length>2*1024*1024)throw new MediaError('视频画面过大');
        result.push({type:'text',text:`画面时间 ${time.toFixed(1)} 秒`},{type:'image',url:'data:image/jpeg;base64,'+frame.toString('base64')});
      }
    }
    result.push({type:'text',text:'本次仅分析视频抽样画面，未识别音轨。不要推断语音或背景音内容；如需分析，请用户补充文字。'});
    return result;
  }catch(e){if(e instanceof MediaError)throw e;throw new MediaError(signal?.aborted?'已取消媒体处理':'媒体解码失败，请使用微信语音或 MP4 视频重试。');}
  finally{await fs.rm(dir,{recursive:true,force:true});}
}
