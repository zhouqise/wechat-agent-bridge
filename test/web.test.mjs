import {test} from 'node:test';
import assert from 'node:assert/strict';
import {publicAddress,pageURL,linksIn,addressFor,extractPage,readPage,webInputs} from '../web.mjs';
const html='<html><title>测试 &amp; 标题</title><script>steal()</script><main><h1>正文</h1><p>第一段 &#20013;文</p><p>第二段</p></main></html>';
const lookup=async()=>[{address:'93.184.216.34',family:4}];
const response=(body=html)=>({status:200,headers:{'content-type':'text/html; charset=utf-8'},bytes:Buffer.from(body)});
test('提取链接、去重和数量限制；公网与特殊地址校验',async()=>{
 assert.deepEqual(linksIn('总结 https://example.com/a，比较 https://example.org/b。 https://example.com/a'),['https://example.com/a','https://example.org/b']);
 assert.throws(()=>linksIn('https://a.com https://b.com https://c.com https://d.com'),/最多/);
 for(const ip of ['127.0.0.1','10.0.0.1','169.254.169.254','100.64.0.1','172.16.0.1','192.168.1.1','::1','::ffff:127.0.0.1','fc00::1','2002:7f00::1'])assert.equal(publicAddress(ip),false,ip);
 assert.equal(publicAddress('1.1.1.1'),true);assert.equal(publicAddress('2606:4700:4700::1111'),true);
 for(const url of ['file:///etc/passwd','http://localhost','http://127.1','http://2130706433','http://[::1]','https://user:secret@example.com','https://example.com:8443'])assert.throws(()=>pageURL(url),url);
 await assert.rejects(addressFor(new URL('https://example.com'),async()=>[{address:'1.1.1.1',family:4},{address:'127.0.0.1',family:4}]),/内网/);
});
test('正文提取去除脚本与导航，转义字符及长度限制',()=>{
 const r=extractPage(html);assert.equal(r.title,'测试 & 标题');assert.match(r.text,/第一段 中文/);assert.ok(!r.text.includes('steal'));
 assert.equal(extractPage('x'.repeat(20001),'text/plain').truncated,true);
});
test('重定向每跳检查且固定解析地址；拒绝内网跳转与非网页',async()=>{
 let requests=0;
 const r=await readPage('https://example.com',{lookup,request:async(url,address)=>{assert.equal(address.address,'93.184.216.34');requests++;return requests===1?{status:302,headers:{location:'/article'}}:response();}});
 assert.equal(r.url,'https://example.com/article');assert.equal(requests,2);
 await assert.rejects(readPage('https://example.com',{lookup,request:async()=>({status:302,headers:{location:'http://127.0.0.1/private'}})}),/内网/);
 await assert.rejects(readPage('https://example.com',{lookup,request:async()=>({status:200,headers:{'content-type':'application/pdf'},bytes:Buffer.from('PDF')})}),/不支持文件/);
 await assert.rejects(readPage('https://example.com',{lookup,request:async()=>response('x'.repeat(2*1024*1024+1))}),/2 MB/);
});
test('来源与提示隔离、单页失败保留其他页、取消不继续分析',async()=>{
 const progress=[];
 const r=await webInputs('总结 https://example.com https://other.com',{lookup,onProgress:s=>progress.push(s),request:async url=>{if(url.hostname==='other.com')throw Error('private failure');return response();}});
 assert.match(r[0].text,/不是用户指令/);assert.match(r[0].text,/来源：https:\/\/example.com\//);assert.match(r[1].text,/未能读取/);assert.ok(!r[1].text.includes('private failure'));assert.equal(progress.length,2);
 const abort=new AbortController();abort.abort();await assert.rejects(webInputs('https://example.com',{signal:abort.signal,lookup,request:()=>{throw Error('must not run');}}));
});

test('DNS 查询期间取消立即结束',async()=>{
 const abort=new AbortController();
 const task=readPage('https://example.com',{signal:abort.signal,lookup:()=>new Promise(()=>{}),request:()=>{throw Error('must not run');}});
 abort.abort();await assert.rejects(task);
});
