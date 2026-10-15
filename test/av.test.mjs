import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {mediaInputs} from '../av.mjs';
const media={full_url:'https://novac2c.cdn.weixin.qq.com/c2c/download?q=test'};
test('微信附带的语音转写无需下载或执行组件',async()=>{
 const r=await mediaInputs([{type:3,voice_item:{text:'请检查这个项目'}}],{fetcher:()=>{throw Error('unexpected');}});
 assert.match(r[0].text,/请检查这个项目/);
 await assert.rejects(mediaInputs([{type:3,voice_item:{text:'a'.repeat(12001)}}]),/过长/);
});
test('拒绝多段、过长、非官方下载及不支持视频格式',async()=>{
 await assert.rejects(mediaInputs([{type:3},{type:5}]),/最多/);
 await assert.rejects(mediaInputs([{type:3,voice_item:{playtime:121000}}]),/转文字/);
 await assert.rejects(mediaInputs([{type:5,video_item:{media:{full_url:'http://localhost/x'}}}]),/下载/);
 await assert.rejects(mediaInputs([{type:5,video_item:{media}}],{fetcher:async()=>new Response('playlist')}),/MP4/);
});
test('视频抽帧携带时间、不推断无音轨内容，临时文件清理',async()=>{
 let dir;
 const bytes=Buffer.alloc(32);bytes.write('ftyp',4);
 const r=await mediaInputs([{type:5,video_item:{media}}],{env:{},fetcher:async()=>new Response(bytes),run:async(bin,args)=>{
   assert.ok(args.includes('file,pipe'));
   if(bin==='ffprobe'){dir=path.dirname(args.at(-1));return {stdout:JSON.stringify({format:{duration:'6'},streams:[{codec_type:'video'}]})};}
   await fs.writeFile(args.at(-1),Buffer.from([255,216,255]));return {stdout:''};
 }});
 assert.equal(r.filter(i=>i.type==='image').length,6);assert.ok(r.some(i=>i.text?.includes('没有音轨')));
 assert.equal(await fs.stat(dir).then(()=>true,()=>false),false);
});
test('取消媒体处理不启动外部进程且清理临时目录',async()=>{
 const c=new AbortController();c.abort();
 await assert.rejects(mediaInputs([{type:5,video_item:{media}}],{signal:c.signal,run:()=>{throw Error('unexpected');}}),/取消/);
});
test('无转写的语音直接提示重发文字，不下载、不调用识别',async()=>{
 await assert.rejects(mediaInputs([{type:3,voice_item:{media}}],{fetcher:()=>{throw Error('must not download');},run:()=>{throw Error('must not run');}}),/重新发送文字/);
});
test('视频音轨转写含时间戳并与画面合并，不影响微信语音规则',async t=>{
 const os=await import('node:os');const home=await fs.mkdtemp(path.join(os.tmpdir(),'wx-transcript-'));t.after(()=>fs.rm(home,{recursive:true,force:true}));
 const model=path.join(home,'model.bin');await fs.writeFile(model,'fixture');
 const bytes=Buffer.alloc(32);bytes.write('ftyp',4);let temp,whisper=0;
 const r=await mediaInputs([{type:5,video_item:{media}}],{env:{WHISPER_MODEL:model},fetcher:async()=>new Response(bytes),run:async(bin,args)=>{
   if(bin==='ffprobe'){temp=path.dirname(args.at(-1));return {stdout:JSON.stringify({format:{duration:'6'},streams:[{codec_type:'video'},{codec_type:'audio'}]})};}
   if(bin==='whisper-cli'){whisper++;assert.ok(args.includes('-osrt'));await fs.writeFile(args[args.indexOf('-of')+1]+'.srt','1\n00:00:00,000 --> 00:00:02,000\n请查看屏幕上的错误\n');}
   else await fs.writeFile(args.at(-1),Buffer.from([255,216,255]));return {stdout:''};
 }});
 assert.equal(whisper,1);assert.equal(r.filter(i=>i.type==='image').length,6);assert.match(r.at(-1).text,/00:00:02,000/);assert.ok(r.some(i=>i.text?.includes('共同分析')));assert.equal(await fs.stat(temp).then(()=>true,()=>false),false);
});
test('音轨组件缺失或转写失败明确降级，取消不会降级后继续任务',async t=>{
 const os=await import('node:os');const home=await fs.mkdtemp(path.join(os.tmpdir(),'wx-audiofail-'));t.after(()=>fs.rm(home,{recursive:true,force:true}));const model=path.join(home,'model');await fs.writeFile(model,'fixture');
 const bytes=Buffer.alloc(32);bytes.write('ftyp',4);
 for(const mode of ['missing','failed','cancel']) {
   const abort=new AbortController();
   const task=mediaInputs([{type:5,video_item:{media}}],{signal:abort.signal,env:{WHISPER_MODEL:mode==='missing'?path.join(home,'missing'):model},fetcher:async()=>new Response(bytes),run:async(bin,args)=>{
     if(bin==='ffprobe')return {stdout:JSON.stringify({format:{duration:'6'},streams:[{codec_type:'video'},{codec_type:'audio'}]})};
     if(bin==='whisper-cli'){if(mode==='cancel')abort.abort();throw Error('private-detail');}
     await fs.writeFile(args.at(-1),Buffer.from([255,216,255]));return {stdout:''};
   }});
   if(mode==='cancel')await assert.rejects(task,/取消/);else {const result=await task;assert.match(result.at(-1).text,/仅分析画面/);assert.ok(!result.at(-1).text.includes('private-detail'));}
 }
});

test('30 分钟边界、200 MB 限制与分段失败保留其他字幕',async t=>{
 const os=await import('node:os');const dir=await fs.mkdtemp(path.join(os.tmpdir(),'wx-long-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const model=path.join(dir,'model');await fs.writeFile(model,'fixture');const bytes=Buffer.alloc(32);bytes.write('ftyp',4);
 let duration=1800,parts=0;const offsets=[],progress=[];
 const options={env:{WHISPER_MODEL:model},fetcher:async()=>new Response(bytes),onProgress:s=>progress.push(s),run:async(bin,args,opts)=>{
  if(bin==='ffprobe')return {stdout:JSON.stringify({format:{duration},streams:[{codec_type:'video'},{codec_type:'audio'}]})};
  if(bin==='whisper-cli'){
   assert.equal(opts.timeout,600000);parts++;if(parts===2)throw Error('fixture failure');
   await fs.writeFile(args[args.indexOf('-of')+1]+'.srt','1\n00:00:00,000 --> 00:00:01,000\n字幕');
  } else {if(args.includes('-vn')){offsets.push(Number(args[args.indexOf('-ss')+1]));assert.equal(args[args.indexOf('-t')+1],'120');}await fs.writeFile(args.at(-1),'fixture');}
  return {stdout:''};
 }};
 const r=await mediaInputs([{type:5,video_item:{media}}],options);
 assert.equal(r.filter(i=>i.type==='image').length,30);assert.equal(parts,15);assert.deepEqual(offsets,Array.from({length:15},(_,i)=>i*120));
 assert.ok(r.some(i=>i.text?.includes('120–240.0 秒音轨转写未完成')));assert.match(r.at(-1).text,/1680–1800.0/);assert.ok(progress.some(s=>s.includes('15/15')));
 duration=1800.1;await assert.rejects(mediaInputs([{type:5,video_item:{media}}],options),/30 分钟/);
 await assert.rejects(mediaInputs([{type:5,video_item:{media}}],{...options,fetcher:async()=>new Response(bytes,{headers:{'content-length':String(200*1024*1024+17)}})}),/大小限制/);
});
