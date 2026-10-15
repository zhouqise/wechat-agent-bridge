import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {officeInputs,inspectOffice,officePython,outputFile} from '../office.mjs';
import {sendOfficeFile} from '../file-send.mjs';
const exec=promisify(execFile),url='https://novac2c.cdn.weixin.qq.com/c2c/download?q=fixture';
async function fixture(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'wx-pdf-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return dir;}
test('PDF 文字层按页提取，扫描/空白页明确标记，加密与损坏拒绝',async t=>{
 const dir=await fixture(t),py=await fs.stat(officePython()).then(()=>officePython(),()=>process.platform==='win32'?'python':'python3');
 await exec(py,['-c',`from pypdf import PdfWriter
from pypdf.generic import DictionaryObject,NameObject,DecodedStreamObject
import pathlib,sys
p=pathlib.Path(sys.argv[1]);w=PdfWriter();page=w.add_blank_page(width=300,height=300)
font=DictionaryObject({NameObject('/Type'):NameObject('/Font'),NameObject('/Subtype'):NameObject('/Type1'),NameObject('/BaseFont'):NameObject('/Helvetica')})
page[NameObject('/Resources')]=DictionaryObject({NameObject('/Font'):DictionaryObject({NameObject('/F1'):w._add_object(font)})})
stream=DecodedStreamObject();stream.set_data(b'BT /F1 12 Tf 20 200 Td (Hello PDF test) Tj ET');page[NameObject('/Contents')]=w._add_object(stream)
w.add_blank_page(width=300,height=300);w.write(p/'sample.pdf');w.encrypt('secret');w.write(p/'locked.pdf')`,dir]);
 const inspect=(file,opts={})=>inspectOffice(file,{...opts,env:{...process.env,WX_OFFICE_PYTHON:py}});
 const summary=await inspect(path.join(dir,'sample.pdf'));assert.match(summary.text,/第 1 页\nHello PDF test/);assert.match(summary.text,/第 2 页/);assert.match(summary.text,/未进行 OCR/);assert.equal(summary.pages,2);
 await assert.rejects(inspect(path.join(dir,'locked.pdf')),/无法解析/);
 const bytes=await fs.readFile(path.join(dir,'sample.pdf'));
 const r=await officeInputs([{type:4,file_item:{file_name:'sample.pdf',media:{full_url:url}}}],dir,{check:async()=>{},inspect,fetcher:async()=>new Response(bytes)});assert.match(r[0].text,/Hello PDF test/);assert.match(r[0].text,/原文件不要覆盖/);
 await assert.rejects(officeInputs([{type:4,file_item:{file_name:'fake.pdf',media:{full_url:url}}}],dir,{check:async()=>{},inspect,fetcher:async()=>new Response('not pdf')}),/有效的 PDF/);
 await fs.copyFile(path.join(dir,'sample.pdf'),path.join(dir,'wx-agent-output','result.pdf'));assert.match(await outputFile(dir,'result.pdf'),/result.pdf$/);
});
test('常用文本不依赖 Python，编码和截断提示，二进制/超限/取消拒绝',async t=>{
 const dir=await fixture(t);
 for(const ext of ['txt','md','csv','tsv','json','log','yaml','yml','xml']) {
  const r=await officeInputs([{type:4,file_item:{file_name:'file.'+ext,media:{full_url:url}}}],dir,{check:()=>{throw Error('must not check Python');},fetcher:async()=>new Response('测试文本\n第二行')});assert.match(r[0].text,/测试文本/);
 }
 const p=path.join(dir,'utf16.txt');await fs.writeFile(p,Buffer.concat([Buffer.from([255,254]),Buffer.from('中文测试','utf16le')]));assert.equal((await inspectOffice(p)).text,'中文测试');
 await fs.writeFile(p,'x'.repeat(30001));assert.equal((await inspectOffice(p)).text.length,30000);assert.equal((await inspectOffice(p)).truncated,true);
 await fs.writeFile(p,Buffer.from([0,1,2,3]));await assert.rejects(inspectOffice(p),/无法解析/);
 await assert.rejects(officeInputs([{type:4,file_item:{file_name:'big.txt',media:{full_url:url}}}],dir,{fetcher:async()=>new Response('x',{headers:{'content-length':String(21*1024*1024)}})}),/大小限制/);
 const abort=new AbortController();abort.abort();await assert.rejects(inspectOffice(p,{signal:abort.signal}),/取消/);
});
test('PDF 和文本回传使用同一附件流程',async t=>{
 const dir=await fixture(t);await fs.mkdir(path.join(dir,'wx-agent-output'));await fs.writeFile(path.join(dir,'wx-agent-output','result.md'),'# 测试结果');
 let sent;
 await sendOfficeFile({cwd:dir,name:'result.md',state:{base:'https://ilinkai.weixin.qq.com',owner:'owner',token:'fixture'},contextToken:'context',apiFn:async(b,endpoint,body)=>{if(endpoint.endsWith('getuploadurl'))return {upload_param:'ticket'};sent=body;return {ret:0};},fetcher:async()=>new Response('',{headers:{'x-encrypted-param':'fixture'}})});
 assert.equal(sent.msg.item_list[0].file_item.file_name,'result.md');assert.equal(sent.msg.to_user_id,'owner');
});
