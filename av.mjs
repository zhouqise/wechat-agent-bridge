import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {paths} from './paths.mjs';
import {imageInputs,downloadMedia,MediaError} from './media.mjs';
const exec=promisify(execFile);
const LIMIT=1800, SEGMENT=120;
async function command(bin,args,signal,run=exec,timeout=120000) {
  try {return await run(bin,args,{signal,timeout,maxBuffer:2*1024*1024,windowsHide:true,shell:false});}
  catch(e){if(signal?.aborted)throw new MediaError('已取消媒体处理');if(e.code==='ENOENT')throw new MediaError('缺少媒体组件，请在电脑安装 FFmpeg，详情见 README。');throw new MediaError('媒体解析或识别失败，请检查组件或重新发送 MP4 视频。');}
}
export async function mediaInputs(items,{signal,fetcher=fetch,run=exec,env=process.env,onProgress=()=>{}}={}) {
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
    signal?.throwIfAborted();onProgress('正在下载视频（最大 200 MB）');
    let bytes=await downloadMedia(content,{fetcher,signal,maxBytes:200*1024*1024,timeoutMs:300000});
    if(bytes.toString('ascii',4,8)!=='ftyp')throw new MediaError('视频暂支持 MP4，请转换格式后发送。');
    const format='mov';
    const input=path.join(dir,'input');await fs.writeFile(input,bytes,{mode:0o600});bytes=null;
    const ffmpeg=env.FFMPEG_BINARY || 'ffmpeg',ffprobe=env.FFPROBE_BINARY || 'ffprobe';
    const probe=JSON.parse((await command(ffprobe,['-v','error','-protocol_whitelist','file,pipe','-f',format,'-show_format','-show_streams','-of','json',input],signal,run)).stdout);
    const duration=Number(probe.format?.duration);
    if(!Number.isFinite(duration) || duration<=0 || duration>LIMIT)throw new MediaError('媒体时长无效或超过 30 分钟，请分段发送。');
    const result=[...images];
    const frameCount=Math.max(6,Math.ceil(duration/60));
    if(!voice) {
      if(!probe.streams?.some(s=>s.codec_type==='video'))throw new MediaError('视频中没有可读取画面。');
      result.push({type:'text',text:`用户发送了 ${duration.toFixed(1)} 秒视频。以下为均匀抽取的 ${frameCount} 个画面，仅代表采样时刻，不能据此断言所有动作或细节。`});
      for(let i=0;i<frameCount;i++) {
        signal?.throwIfAborted();
        onProgress(`正在抽帧 ${i+1}/${frameCount}`);
        const time=duration*i/frameCount,file=path.join(dir,`frame-${i}.jpg`);
        await command(ffmpeg,['-nostdin','-v','error','-protocol_whitelist','file,pipe','-f',format,'-ss',String(time),'-i',input,'-frames:v','1','-vf','scale=768:768:force_original_aspect_ratio=decrease','-threads','1','-y',file],signal,run);
        const frame=await fs.readFile(file);if(frame.length>2*1024*1024)throw new MediaError('视频画面过大');
        result.push({type:'text',text:`画面时间 ${time.toFixed(1)} 秒`},{type:'image',url:'data:image/jpeg;base64,'+frame.toString('base64')});
      }
    }
    if(!probe.streams?.some(s=>s.codec_type==='audio')) {
      result.push({type:'text',text:'视频没有音轨，本次只分析抽样画面，不推断语音或背景音内容。'});
    } else {
      const model=env.WHISPER_MODEL || path.join(paths(env).dir,'models','ggml-base.bin');
      try {
        if(!await fs.stat(model).then(s=>s.isFile(),()=>false))throw new MediaError('未配置视频音轨识别模型');
        const segments=Math.ceil(duration/SEGMENT);let used=0;
        result.push({type:'text',text:'请按视频时间段结合画面与对应字幕共同分析，再汇总整体内容。字幕可能错漏，不代表说话人身份或非语音音效；不补造缺失内容。字幕时间相对各段起点，需加上该段起点才是视频绝对时间。'});
        for(let i=0;i<segments;i++) {
          signal?.throwIfAborted();
          const start=i*SEGMENT,end=Math.min(duration,start+SEGMENT);
          onProgress(`正在转写音轨 ${i+1}/${segments}（${start}–${end.toFixed(1)} 秒），可发送 /取消`);
          const audio=path.join(dir,`audio-${i}.wav`),output=path.join(dir,`transcript-${i}`);
          try {
            await command(ffmpeg,['-nostdin','-v','error','-protocol_whitelist','file,pipe','-f',format,'-ss',String(start),'-i',input,'-map','0:a:0','-vn','-t',String(end-start),'-ac','1','-ar','16000','-c:a','pcm_s16le','-threads','1','-y',audio],signal,run);
            await command(env.WHISPER_BINARY || 'whisper-cli',['-m',model,'-f',audio,'-l','auto','-osrt','-of',output,'-t','4'],signal,run,600000);
            if((await fs.stat(output+'.srt')).size>64000)throw new MediaError('音轨转写过长');
            const transcript=(await fs.readFile(output+'.srt','utf8')).trim();
            if(!transcript || transcript.length>16000 || used+transcript.length>120000)throw new MediaError('转写为空或超过文字上限');
            used+=transcript.length;
            result.push({type:'text',text:`视频第 ${i+1}/${segments} 段，绝对时间 ${start}–${end.toFixed(1)} 秒；以下 SRT 时间相对本段起点：\n`+transcript});
          }catch {
            if(signal?.aborted)throw new MediaError('已取消媒体处理');
            result.push({type:'text',text:`视频 ${start}–${end.toFixed(1)} 秒音轨转写未完成（组件异常、超时、无可识别文字或文字超限）。必须告知用户此段仅分析画面，不得推断语音内容。可运行 wx-agent media-check 检查。`});
          }finally {
            await fs.rm(audio,{force:true});await fs.rm(output+'.srt',{force:true});
          }
        }
      }catch {
        if(signal?.aborted)throw new MediaError('已取消媒体处理');
        result.push({type:'text',text:'视频有音轨，但音轨转写未完成（可能缺少组件/模型、超时或没有可识别文字）。必须向用户明确说明本次仅分析画面，不得推断语音内容；可在电脑运行 wx-agent media-check 检查。'});
      }
    }
    return result;
  }catch(e){if(e instanceof MediaError)throw e;throw new MediaError(signal?.aborted?'已取消媒体处理':'媒体解码失败，请使用微信语音或 MP4 视频重试。');}
  finally{await fs.rm(dir,{recursive:true,force:true});}
}
