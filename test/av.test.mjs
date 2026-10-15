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
 await assert.rejects(mediaInputs([{type:3,voice_item:{playtime:121000}}]),/2 分钟/);
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
