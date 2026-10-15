import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {imageInputs,downloadMedia,MediaError} from './media.mjs';
import {paths} from './paths.mjs';
const exec=promisify(execFile);
const LIMIT=120;
function wav(pcm,rate) {
  const h=Buffer.alloc(44);h.write('RIFF');h.writeUInt32LE(pcm.length+36,4);h.write('WAVEfmt ',8);h.writeUInt32LE(16,16);h.writeUInt16LE(1,20);h.writeUInt16LE(1,22);h.writeUInt32LE(rate,24);h.writeUInt32LE(rate*2,28);h.writeUInt16LE(2,32);h.writeUInt16LE(16,34);h.write('data',36);h.writeUInt32LE(pcm.length,40);return Buffer.concat([h,Buffer.from(pcm)]);
}
async function command(bin,args,signal,run=exec) {
  try {return await run(bin,args,{signal,timeout:120000,maxBuffer:2*1024*1024,windowsHide:true,shell:false});}
  catch(e){if(signal?.aborted)throw new MediaError('已取消媒体处理');if(e.code==='ENOENT')throw new MediaError('缺少媒体组件，请在电脑安装 FFmpeg 和 whisper.cpp，详情见 README。');throw new MediaError('媒体解析或识别失败，请发送 2 分钟以内的语音或 MP4 视频。');}
}
export async function mediaInputs(items,{signal,fetcher=fetch,run=exec,decodeSilk,env=process.env}={}) {
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
  if(voice && content.playtime>LIMIT*1000)throw new MediaError('语音超过 2 分钟，请分段发送。');
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'wx-agent-media-'));await fs.chmod(dir,0o700);
  try {
    signal?.throwIfAborted();
    let bytes=await downloadMedia(content,{fetcher,signal,maxBytes:voice?4*1024*1024:50*1024*1024});
    let format;
    if(voice) {
      if(content.encode_type===6 || bytes.subarray(0,10).toString().includes('#!SILK')) {
        const silk=decodeSilk?null:await import('silk-wasm');
        if(silk && silk.getDuration(bytes)>LIMIT*1000)throw new MediaError('语音超过 2 分钟，请分段发送。');
        const decode=decodeSilk || silk.decode;
        const result=await decode(bytes,24000);
        if(result.duration>LIMIT*1000 || result.data.length>LIMIT*48000)throw new MediaError('语音超过 2 分钟，请分段发送。');
        bytes=wav(result.data,24000);format='wav';
      } else if(content.encode_type===1) {
        const rate=content.sample_rate;if(![8000,16000,24000,48000].includes(rate) || content.bits_per_sample!==16)throw new MediaError('暂不支持此 PCM 语音格式');
        bytes=wav(bytes,rate);format='wav';
      } else if(bytes.toString('ascii',0,4)==='RIFF' && bytes.toString('ascii',8,12)==='WAVE')format='wav';
      else if(content.encode_type===7)format='mp3';
      else if(bytes.toString('ascii',0,5)==='#!AMR')format='amr';
      else throw new MediaError('暂不支持此语音编码，请使用微信语音或转文字后发送。');
    } else {
      if(bytes.toString('ascii',4,8)!=='ftyp')throw new MediaError('视频暂支持 MP4，请转换格式后发送。');
      format='mov';
    }
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
    const hasAudio=probe.streams?.some(s=>s.codec_type==='audio');
    if(voice || hasAudio) {
      const model=env.WHISPER_MODEL || path.join(paths(env).dir,'models','ggml-base.bin');
      if(!await fs.stat(model).then(s=>s.isFile(),()=>false)) {
        if(voice)throw new MediaError('缺少离线识别模型，请在电脑配置 WHISPER_MODEL；也可先在微信转文字后发送。');
        result.push({type:'text',text:'未配置离线语音模型，本次仅分析视频画面，未识别音轨。'});
      } else {
        const audio=path.join(dir,'audio.wav'),output=path.join(dir,'transcript');
        try {
          await command(ffmpeg,['-nostdin','-v','error','-protocol_whitelist','file,pipe','-f',format,'-i',input,'-vn','-t',String(LIMIT),'-ac','1','-ar','16000','-c:a','pcm_s16le','-threads','1','-y',audio],signal,run);
          await command(env.WHISPER_BINARY || 'whisper-cli',['-m',model,'-f',audio,'-l','auto','-otxt','-of',output,'-nt','-t','4'],signal,run);
          const text=(await fs.readFile(output+'.txt','utf8')).trim();
          if(!text || text.length>12000)throw new MediaError('未识别出有效语音，请转文字后发送。');
          result.push({type:'text',text:'用户语音/视频音轨的离线转写（可能有识别错误）：\n'+text});
        }catch(e){if(voice || signal?.aborted)throw e;result.push({type:'text',text:'视频音轨转写失败，本次只分析画面，不推断语音内容。'});}
      }
    } else if(!voice)result.push({type:'text',text:'此视频没有音轨。'});
    return result;
  }catch(e){if(e instanceof MediaError)throw e;throw new MediaError(signal?.aborted?'已取消媒体处理':'媒体解码失败，请使用微信语音或 MP4 视频重试。');}
  finally{await fs.rm(dir,{recursive:true,force:true});}
}
