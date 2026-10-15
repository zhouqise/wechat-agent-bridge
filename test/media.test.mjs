import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createCipheriv} from 'node:crypto';
import {imageInputs,MediaError} from '../media.mjs';
import {acceptBatch} from '../bridge.mjs';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6ioAAAAASUVORK5CYII=','base64');
const key=Buffer.alloc(16,7);
const item=media=>({type:2,image_item:{media}});
const url='https://novac2c.cdn.weixin.qq.com/c2c/download?q=test';
function encrypt(){const c=createCipheriv('aes-128-ecb',key,null);return Buffer.concat([c.update(png),c.final()]);}
test('三种微信密钥表示解密为 Codex 图像输入',async()=>{
  const variants=[item({full_url:url,aes_key:key.toString('base64')}),item({full_url:url,aes_key:Buffer.from(key.toString('hex')).toString('base64')}),{type:2,image_item:{aeskey:key.toString('hex'),media:{encrypt_query_param:'a&b',aes_key:'ignored'}}}];
  for(const i of variants){
    const result=await imageInputs([i],{fetcher:async(u,opts)=>{assert.equal(opts.redirect,'error');assert.equal(opts.headers,undefined);if(!i.image_item.media.full_url)assert.ok(u.includes('a%26b'));return new Response(encrypt());}});
    assert.deepEqual(result,[{type:'image',url:'data:image/png;base64,'+png.toString('base64')}]);
  }
});
test('明文图片支持；非图片、坏密钥与私网地址拒绝且错误不含凭据',async()=>{
  assert.equal((await imageInputs([item({full_url:url})],{fetcher:async()=>new Response(png)})).length,1);
  for(const media of [{full_url:'http://127.0.0.1/private'},{full_url:'https://novac2c.cdn.weixin.qq.com.evil.test/a'},{full_url:url,aes_key:'secret-invalid'}]){
    await assert.rejects(imageInputs([item(media)],{fetcher:async()=>new Response(png)}),e=>e instanceof MediaError && !e.message.includes('secret-invalid'));
  }
  await assert.rejects(imageInputs([item({full_url:url})],{fetcher:async()=>new Response('<html>error</html>')}),/格式/);
});
test('图片数量、声明长度和流式实际长度均受限',async()=>{
  await assert.rejects(imageInputs(Array(5).fill(item({full_url:url}))),/4/);
  await assert.rejects(imageInputs([item({full_url:url})],{maxBytes:10,fetcher:async()=>new Response(png,{headers:{'content-length':'100'}})}),/大小/);
  await assert.rejects(imageInputs([item({full_url:url})],{maxBytes:10,fetcher:async()=>new Response(png)}),/大小/);
});
test('纯图片消息到达处理器，重复消息和非绑定用户不下载',async()=>{
  const state={owner:'u',seen:[]};let n=0;
  const msg={from_user_id:'u',message_type:1,message_state:2,context_token:'ctx',message_id:1,item_list:[item({full_url:url})]};
  await acceptBatch(state,{msgs:[msg,msg,{...msg,from_user_id:'other',message_id:2}]},async()=>{},async()=>{},async(text,m)=>{n++;assert.equal(text,'');assert.equal(m.item_list[0].type,2);});
  assert.equal(n,1);
});
