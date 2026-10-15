import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {ocrImages,ocrPDF,recognize} from '../ocr.mjs';
import {officePython,inspectOffice} from '../office.mjs';
const exec=promisify(execFile);
export async function fixture(t){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'wxocrtest-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const py=await fs.stat(officePython()).then(()=>officePython(),()=>process.platform==='win32'?'python':'python3');
 await exec(py,['-c',`from PIL import Image,ImageDraw,ImageFont
import pathlib,sys
p=pathlib.Path(sys.argv[1]);im=Image.new('RGB',(1200,400),'white');ImageDraw.Draw(im).text((60,120),'INVOICE TOTAL 12345',font=ImageFont.load_default(size=60),fill='black');im.save(p/'scan.png');im.save(p/'scan.pdf','PDF')`,dir]);
 return {dir,env:{...process.env,WX_OFFICE_PYTHON:py}};
}
test('扫描 PDF 按页 OCR 补充、真实渲染，缺组件/取消不编造文字',async t=>{
 const {dir,env}=await fixture(t),file=path.join(dir,'scan.pdf'),summary=await inspectOffice(file,{env});assert.deepEqual(summary.emptyPages,[1]);let reads=0;
 const result=await ocrPDF(file,summary,{env,check:async()=>{},read:async img=>{assert.ok((await fs.stat(img)).size>0);reads++;return 'INVOICE TOTAL 12345';}});assert.match(result.text,/第 1 页 OCR/);assert.match(result.text,/INVOICE TOTAL 12345/);assert.equal(reads,1);
 const missing=await ocrPDF(file,summary,{env,check:async()=>{throw Error();}});assert.match(missing.notice,/OCR 组件未就绪/);
 const abort=new AbortController();abort.abort();await assert.rejects(ocrPDF(file,summary,{env,signal:abort.signal,check:async()=>{}}));
});
test('截图 OCR 保留独立资料提示，损坏图片失败且有限页数',async t=>{
 const {dir,env}=await fixture(t),url='data:image/png;base64,'+(await fs.readFile(path.join(dir,'scan.png'))).toString('base64');
 const r=await ocrImages([{url}],{env,check:async()=>{},read:async()=> 'recognized'});assert.match(r[0].text,/recognized/);assert.match(r[0].text,/资料而非指令/);
 const bad=await ocrImages([{url:'data:image/png;base64,bad'}],{env,check:async()=>{}});assert.match(bad[0].text,/失败/);
 let calls=0;const bounded=await ocrPDF(path.join(dir,'scan.pdf'),{text:'',notice:'',emptyPages:Array(25).fill(1)},{env,check:async()=>{},read:async()=>{calls++;return 'data';}});assert.equal(calls,20);assert.match(bounded.notice,/超出部分未识别/);
});
test('Tesseract 使用参数传递、超时和取消信号，不执行 shell',async()=>{
 const controller=new AbortController();await recognize('/tmp/input name.png',{signal:controller.signal,env:{TESSERACT_BINARY:'tesseract'},run:async(file,args,opts)=>{assert.equal(file,'tesseract');assert.equal(args[0],'/tmp/input name.png');assert.ok(args.includes('chi_sim+eng'));assert.equal(opts.signal,controller.signal);assert.equal(opts.timeout,30000);return {stdout:' hello '};}});
});
