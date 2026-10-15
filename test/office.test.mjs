import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createDecipheriv} from 'node:crypto';
import {officePython,inspectOffice,officeInputs,outputFile} from '../office.mjs';
import {sendOfficeFile} from '../file-send.mjs';
const exec=promisify(execFile),url='https://novac2c.cdn.weixin.qq.com/c2c/download?q=fixture';
async function fixtures(t) {
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'wx-office-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const py=await fs.stat(officePython()).then(()=>officePython(),()=>process.platform==='win32'?'python':'python3');
 await exec(py,['-c',`import sys,pathlib,zipfile
from openpyxl import Workbook
from docx import Document
from pptx import Presentation
p=pathlib.Path(sys.argv[1]);w=Workbook();w.active['A1']='收入';w.active['B1']=123;w.active['C1']='=B1*2';w.save(p/'table.xlsx')
d=Document();d.add_paragraph('文档内容');d.add_table(rows=1,cols=1).cell(0,0).text='表格内容';d.save(p/'document.docx')
r=Presentation();s=r.slides.add_slide(r.slide_layouts[1]);s.shapes.title.text='演示标题';s.placeholders[1].text='演示内容';r.save(p/'slides.pptx')
with zipfile.ZipFile(p/'invalid.docx','w') as z:z.writestr('word/document.xml','<!DOCTYPE x><a/>')`,dir]);
 const inspect=(file,opts={})=>inspectOffice(file,{...opts,env:{...process.env,WX_OFFICE_PYTHON:py}});
 return {dir,inspect};
}
test('三种 Office 读取文字/表格/公式，保留唯一原件及文本副本',async t=>{
 const {dir,inspect}=await fixtures(t);
 for(const [name,expected] of [['table.xlsx','收入'],['document.docx','文档内容'],['slides.pptx','演示标题']]) {
   const bytes=await fs.readFile(path.join(dir,name));
   const inputs=await officeInputs([{type:4,file_item:{file_name:'../../'+name,media:{full_url:url}}}],dir,{check:async()=>{},inspect,fetcher:async()=>new Response(bytes)});
   assert.match(inputs[0].text,new RegExp(expected));assert.ok(inputs[0].text.includes('wx-agent-input'));assert.ok(inputs[0].text.includes('不要覆盖'));
 }
 assert.equal((await fs.readdir(path.join(dir,'wx-agent-input'))).length,3);
 await assert.rejects(inspect(path.join(dir,'invalid.docx')),/无法解析/);
});
test('旧格式拒绝、解析失败清理、输出路径越界/符号链接拒绝',async t=>{
 const {dir}=await fixtures(t);
 await assert.rejects(officeInputs([{type:4,file_item:{file_name:'old.xls'}}],dir),/旧版/);
 await assert.rejects(officeInputs([{type:4,file_item:{file_name:'bad.docx',media:{full_url:url}}}],dir,{check:async()=>{},fetcher:async()=>new Response('bad')}),/有效/);
 assert.equal((await fs.readdir(path.join(dir,'wx-agent-input'))).length,0);
 await assert.rejects(outputFile(dir,'../table.xlsx'),/仅允许/);
 await fs.symlink(path.join(dir,'table.xlsx'),path.join(dir,'wx-agent-output','link.xlsx')).catch(()=>{});
 await assert.rejects(outputFile(dir,'link.xlsx'));
});
test('文件回传只发授权输出，CDN 加密且无机器人凭据，发送不自动重试',async t=>{
 const {dir,inspect}=await fixtures(t);await fs.mkdir(path.join(dir,'wx-agent-output'));const bytes=await fs.readFile(path.join(dir,'table.xlsx'));await fs.writeFile(path.join(dir,'wx-agent-output','result.xlsx'),bytes);
 let key,calls=0,sent;
 await sendOfficeFile({cwd:dir,name:'result.xlsx',state:{base:'https://ilinkai.weixin.qq.com',owner:'owner',token:'secret'},contextToken:'ctx',inspect,
 apiFn:async(base,endpoint,body,token)=>{assert.equal(token,'secret');calls++;if(endpoint.endsWith('getuploadurl')){key=Buffer.from(body.aeskey,'hex');assert.equal(body.media_type,3);return {upload_param:'ticket'};}sent=body;return {ret:0};},
 fetcher:async(u,opts)=>{assert.equal(opts.redirect,'error');assert.equal(opts.headers.Authorization,undefined);const d=createDecipheriv('aes-128-ecb',key,null);assert.deepEqual(Buffer.concat([d.update(opts.body),d.final()]),bytes);return new Response('',{headers:{'x-encrypted-param':'download'}});}});
 assert.equal(calls,2);assert.equal(sent.msg.to_user_id,'owner');assert.equal(sent.msg.item_list[0].file_item.file_name,'result.xlsx');
});
test('拒绝非微信上传地址，发送失败只尝试一次',async t=>{
 const {dir,inspect}=await fixtures(t);await fs.mkdir(path.join(dir,'wx-agent-output'));await fs.copyFile(path.join(dir,'table.xlsx'),path.join(dir,'wx-agent-output','result.xlsx'));
 const base={cwd:dir,name:'result.xlsx',state:{base:'https://ilinkai.weixin.qq.com',owner:'owner',token:'secret'},contextToken:'ctx',inspect};
 await assert.rejects(sendOfficeFile({...base,apiFn:async()=>({upload_full_url:'https://evil.example/upload'}),fetcher:()=>{throw Error('must not fetch');}}),/地址不受支持/);
 let sends=0;
 await assert.rejects(sendOfficeFile({...base,apiFn:async(b,endpoint)=>{if(endpoint.endsWith('getuploadurl'))return {upload_param:'ok'};sends++;throw Error('network');},fetcher:async()=>new Response('',{headers:{'x-encrypted-param':'ok'}})}));assert.equal(sends,1);
});
