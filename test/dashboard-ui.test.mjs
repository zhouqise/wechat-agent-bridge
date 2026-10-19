import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
test('日志晚到失败不覆盖切换后的用户',async()=>{
 const elements=new Map(),get=id=>{if(!elements.has(id))elements.set(id,{textContent:'',replaceChildren(){},removeAttribute(){},append(){},value:'',disabled:false});return elements.get(id);};
 const context=vm.createContext({document:{getElementById:get,activeElement:null,createElement:()=>({})},location:{hash:''},sessionStorage:{getItem:()=>'',setItem(){}},history:{replaceState(){}},fetch:async()=>({ok:true,json:async()=>({users:[]})}),setInterval(){},setTimeout,clearTimeout,console});
 vm.runInContext(await fs.readFile(new URL('../dashboard/dashboard.js',import.meta.url),'utf8'),context);await new Promise(r=>setTimeout(r,0));
 vm.runInContext("api=()=>new Promise((resolve,reject)=>{globalThis.failLog=reject});globalThis.pendingLog=loadLogs();",context);
 get('log-info').textContent='B 的日志';vm.runInContext("user='b';epoch++;failLog(Error('A 的错误'));",context);await context.pendingLog;assert.equal(get('log-info').textContent,'B 的日志');
});

test('bound未结束时继续查询，启动成功后才停止轮询',async()=>{
 const elements=new Map(),get=id=>{if(!elements.has(id))elements.set(id,{textContent:'',replaceChildren(){},removeAttribute(){},append(){},value:'',disabled:false});return elements.get(id);};
 const context=vm.createContext({document:{getElementById:get,activeElement:null,createElement:()=>({})},location:{hash:''},sessionStorage:{getItem:()=>'',setItem(){}},history:{replaceState(){}},fetch:async()=>({ok:true,json:async()=>({users:[]})}),setInterval(){},setTimeout,clearTimeout,console});
 vm.runInContext(await fs.readFile(new URL('../dashboard/dashboard.js',import.meta.url),'utf8'),context);await new Promise(r=>setTimeout(r,0));
 vm.runInContext("pairingByUser.set('default','operation');api=async()=>({phase:'bound',terminal:false});globalThis.poll=pollPair();",context);await context.poll;assert.equal(vm.runInContext("pairingByUser.has('default')",context),true);
 vm.runInContext("api=async action=>action==='users'?{users:[]}:{phase:'completed',terminal:true};globalThis.poll=pollPair();",context);await context.poll;assert.equal(vm.runInContext("pairingByUser.has('default')",context),false);assert.match(get('pair-status').textContent,/服务已启动/);
});

test('选API后读取保留选择，过期读取不覆盖新选择',async()=>{
 const elements=new Map(),get=id=>{if(!elements.has(id))elements.set(id,{textContent:'',replaceChildren(){},removeAttribute(){},append(){},value:'',disabled:false});return elements.get(id);};
 const context=vm.createContext({document:{getElementById:get,activeElement:null,createElement:()=>({})},location:{hash:''},sessionStorage:{getItem:()=>'',setItem(){}},history:{replaceState(){}},fetch:async()=>({ok:true,json:async()=>({users:[]})}),setInterval(){},setTimeout,clearTimeout,console});
 vm.runInContext(await fs.readFile(new URL('../dashboard/dashboard.js',import.meta.url),'utf8'),context);await new Promise(r=>setTimeout(r,0));
 get('auth-engine').value='claude';get('auth-mode').value='api';get('auth-mode').onchange();
 vm.runInContext("api=async(action,args)=>action==='users'?{users:[]}:{auth:args.auth || 'local',savedAuth:'local',baseUrl:'',effectiveBaseUrl:'https://proxy.example',baseUrlSource:'environment',apiKeyEnv:'ANTHROPIC_API_KEY',keyPresent:true,model:'opus'}",context);
 await get('auth-load').onclick();assert.equal(get('auth-mode').value,'api');assert.match(get('auth-info').textContent,/https:\/\/proxy.example/);
 vm.runInContext("api=()=>new Promise(r=>{globalThis.resolveAuth=r});globalThis.pending=loadAuth();",context);get('auth-mode').value='local';get('auth-mode').onchange();context.resolveAuth({auth:'api'});await context.pending;assert.equal(get('auth-mode').value,'local');
});
