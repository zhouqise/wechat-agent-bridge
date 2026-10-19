const $=id=>document.getElementById(id);
let token=location.hash.slice(1),user='default',busy=false,epoch=0,context='',authLoaded='',follow=true,logLoading=false;
if(token){sessionStorage.setItem('wx-agent-token',token);history.replaceState(null,'','/');}else token=sessionStorage.getItem('wx-agent-token') || '';
async function api(action,extra={}){const r=await fetch('/api',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({action,user,...extra})});const data=await r.json();if(!r.ok || data.error)throw Error(data.error || '请求失败');return data;}
function invalidate(){epoch++;$('pair-panel').hidden=true;$('pair-qr').hidden=true;$('pair-qr').removeAttribute('src');$('pair-code').value='';authLoaded='';$('auth-save').disabled=true;for(const id of ['auth-url','auth-env','auth-model'])$(id).value='';$('auth-info').textContent='请读取所选用户的认证配置';$('model-results').replaceChildren();$('output').textContent='';$('log-info').textContent='';}
async function refresh(){
 const selected=user,data=await api('users');if(selected!==user)return;
 $('users').replaceChildren();for(const u of data.users){const b=document.createElement('button');b.className='user'+(u.name===user?' selected':'');b.textContent=u.name+' · '+(u.status?.status==='starting'?'启动或配置中':u.status?'运行中':u.bound?'已停止':'未绑定');b.onclick=()=>act(async()=>{user=u.name;invalidate();await refresh();if($('log-panel').open)await loadLogs();});$('users').append(b);}
 const u=data.users.find(u=>u.name===user);if(!u)return;const s=u.status,next=user+':'+(s?.engine || u.engine);if(context!==next){invalidate();context=next;}
 $('title').textContent=user+' 的工作区';$('engine').value=s?.engine || u.engine;
 const running=!!s && s.status!=='starting',idle=running && s.task==='空闲';
 $('set-workspace').disabled=$('set-project').disabled=!!s && !idle;
 $('workspace-path').value=s?.workspace || u.workspace || '';$('start').disabled=!!s || u.bound===false;$('pair-start').disabled=!!s || !!u.bound;$('stop').disabled=!idle;
 $('auth-save').disabled=!!s || authLoaded!==user+':'+$('auth-engine').value;
 $('set-model').disabled=!!s && !idle;
 for(const id of ['set-engine','set-notifications','new','clear'])$(id).disabled=!idle;
 $('models').disabled=!running;
 $('project').replaceChildren(...(u.projectEntries || []).map(p=>{const o=document.createElement('option');o.value=p.path;o.textContent=p.name+' · '+p.path;o.selected=p.path===(s?.workspace || u.workspace);return o;}));
 $('status').textContent=s?.status==='starting'?`服务正在启动或配置（例如扫码绑定）\n工作区：${u.workspace}`:s?`引擎：${s.engine} · ${s.agentReady?'已连接':'连接恢复中'}\n微信：${({connected:'接收正常',retrying:'网络重试中',connecting:'连接中'})[s.health?.wechat] || '未知'} · 任务：${s.task}\n模型：${s.model || '默认'}\n工作区：${s.workspace}\n最近接收检查：${s.lastPollAt?new Date(s.lastPollAt).toLocaleString():'尚未成功'}`:`服务已停止\n工作区：${u.workspace}`;
 $('conversations').replaceChildren();$('tasks').textContent='服务未运行';if(!running)return;
 const stamp=epoch,detail=await api('inspect');if(stamp!==epoch)return;$('notifications').value=detail.notifications;
 $('tasks').textContent=[detail.active?`执行中 ${detail.active.id}：${detail.active.stage || '准备中'}`:'当前无执行任务',...detail.queue.map(t=>`等待 ${t.id}：${t.title || '附件任务'}`)].join('\n');
 for(const c of detail.conversations){const row=document.createElement('div');row.className='conversation';const title=document.createElement('span');title.textContent=`${c.number}. ${c.title}${c.id===detail.current?' · 当前':''}\nID: ${c.id}`;row.append(title);for(const [text,op] of [['切换','switch'],['删除','delete']]){const b=document.createElement('button');b.textContent=text;b.disabled=!idle;b.onclick=()=>{if(op==='delete'&&!confirm('删除此桥接会话记录？项目文件和引擎历史保留。'))return;act(()=>admin(op,c.id));};row.append(b);}$('conversations').append(row);}
}
async function act(fn){if(busy)return;busy=true;$('message').textContent='处理中…';try{const result=await fn();$('message').textContent=typeof result==='string'?result:'已更新';}catch(e){$('message').textContent=e.message;}finally{busy=false;}}
async function admin(operation,value=''){await api('admin',{operation,value});await refresh();}
async function loadLogs(){
 if(logLoading)return;logLoading=true;const stamp=epoch,selected=user;
 try{const r=await api('logs');if(stamp!==epoch||selected!==user)return;const same=$('output').textContent===r.text,pos=$('output').scrollTop;$('output').textContent=r.text || '日志为空';$('log-info').textContent=`${selected} · 文件更新：${r.updatedAt?new Date(r.updatedAt).toLocaleString():'暂无'} · 读取：${new Date(r.readAt).toLocaleTimeString()}${same?' · 暂无新内容':''}${r.truncated?' · 仅显示末尾日志':''} · ${follow?'跟随最新':'已暂停跟随'}`;if(follow)$('output').scrollTop=$('output').scrollHeight;else $('output').scrollTop=pos;}catch(e){if(stamp===epoch&&selected===user)$('log-info').textContent=e.message;}finally{logLoading=false;}
}
$('output').onscroll=()=>{follow=$('output').scrollHeight-$('output').clientHeight-$('output').scrollTop<30;};
$('log-follow').onclick=()=>{follow=true;$('output').scrollTop=$('output').scrollHeight;};
$('logs').onclick=()=>act(async()=>{$('log-panel').open=true;follow=true;await loadLogs();$('log-panel').scrollIntoView({block:'nearest'});});
$('log-panel').ontoggle=()=>{if($('log-panel').open)void loadLogs();};
$('logs-clear').onclick=()=>{if(confirm(`清除 ${user} 的当前及轮转日志？无法恢复，配置、会话和工作文件保留。`))act(async()=>{await api('logs-clear',{confirm:true});await loadLogs();return '日志已清除；服务可继续写入新日志';});};
$('models').onclick=()=>act(async()=>{
 const stamp=epoch,r=await api('models');if(stamp!==epoch)return;$('model-results').replaceChildren();const heading=document.createElement('p');heading.textContent=r.items?`${r.engine} 可选模型 · 当前：${r.currentModel || '引擎默认'}`:'请重启升级后的服务以显示模型列表';$('model-results').append(heading);
 for(const m of r.items || []){const b=document.createElement('button');b.textContent=m.label;b.onclick=()=>{$('model').value=m.id;};$('model-results').append(b);}const note=document.createElement('p');note.className='hint';note.textContent=r.message || '';$('model-results').append(note);
});
$('refresh').onclick=()=>act(async()=>{invalidate();await refresh();if($('log-panel').open)await loadLogs();});
for(const a of ['start','stop'])$(a).onclick=()=>act(async()=>{await api(a);if(a==='stop')await new Promise(r=>setTimeout(r,500));await refresh();});
for(const a of ['engine','notifications'])$('set-'+a).onclick=()=>act(()=>admin(a,$(a).value));
$('set-model').onclick=()=>act(async()=>{await api('model',{value:$('model').value});$('model-results').replaceChildren();await refresh();});
$('new').onclick=()=>act(()=>admin('new',$('name').value));$('clear').onclick=()=>{if(confirm('清空当前用户、目录、引擎的全部桥接会话，并新建一个？项目文件和引擎历史保留。'))act(()=>admin('clear'));};
async function setWorkspace(value){const r=await api('workspace',{value});await refresh();return r.applied==='live'?'工作目录已切换：'+r.workspace:'工作目录已保存，下次启动生效：'+r.workspace;}
$('set-workspace').onclick=()=>act(()=>setWorkspace($('workspace-path').value));$('set-project').onclick=()=>act(()=>setWorkspace($('project').value));
act(refresh);
setInterval(()=>{if(!busy && !['INPUT','SELECT'].includes(document.activeElement?.tagName))act(refresh);},10000);
setInterval(()=>{if($('log-panel').open)void loadLogs();},3000);

async function loadAuth(){const stamp=epoch,selectedEngine=$('auth-engine').value,r=await api('auth-read',{engine:selectedEngine});if(stamp!==epoch||selectedEngine!==$('auth-engine').value)return;$('auth-mode').value=r.auth;$('auth-url').value=r.baseUrl;$('auth-env').value=r.apiKeyEnv;$('auth-model').value=r.model;authLoaded=user+':'+selectedEngine;$('auth-info').textContent=`${selectedEngine} · 环境变量${r.keyPresent?'已设置':'未设置'}（不代表远端认证有效）`;const data=await api('users');if(stamp===epoch)$('auth-save').disabled=!!data.users.find(u=>u.name===user)?.status;}
$('auth-load').onclick=()=>act(loadAuth);$('auth-engine').onchange=()=>{authLoaded='';$('auth-save').disabled=true;act(loadAuth);};
$('auth-save').onclick=()=>act(async()=>{if(authLoaded!==user+':'+$('auth-engine').value)throw Error('请先读取当前认证配置');await api('auth-save',{engine:$('auth-engine').value,auth:$('auth-mode').value,baseUrl:$('auth-url').value,apiKeyEnv:$('auth-env').value,model:$('auth-model').value});invalidate();await refresh();await loadAuth();return '认证已保存，下次启动生效；不同认证配置的会话独立保留';});

const pairingByUser=new Map();let pairLoading=false;
function showPair(r){$('pair-panel').hidden=false;const labels={starting:'正在准备二维码',waiting:'请扫码并在手机确认',scanned:'已扫码，等待手机确认','need-code':'请输入手机显示的配对码',committing:'正在保存绑定，请稍候',bound:'已绑定，尚未启动','starting-service':'绑定成功，正在启动服务',completed:'绑定成功，服务已启动',failed:'绑定失败',cancelled:'已取消'};$('pair-status').textContent=r.message || labels[r.phase] || r.phase;$('pair-qr').hidden=!r.qrDataUrl;if(r.qrDataUrl)$('pair-qr').src=r.qrDataUrl;else $('pair-qr').removeAttribute('src');$('pair-code-row').hidden=r.phase!=='need-code';$('pair-cancel').disabled=['bound','completed','failed','cancelled'].includes(r.phase);}
async function pollPair(){const id=pairingByUser.get(user);if(!id||pairLoading)return;pairLoading=true;const stamp=epoch,selected=user;try{const r=await api('pairing-status',{operationId:id});if(stamp!==epoch||selected!==user)return;showPair(r);if(r.terminal){pairingByUser.delete(user);await refresh();}}catch(e){if(stamp===epoch){$('pair-status').textContent=e.message;pairingByUser.delete(user);}}finally{pairLoading=false;}}
async function beginPair(){const stamp=epoch,r=await api('pairing-start');if(stamp!==epoch)return;pairingByUser.set(user,r.operationId);showPair(r);await pollPair();}
$('create-user').onclick=()=>act(async()=>{const r=await api('user-create',{value:$('new-user-name').value.trim()});user=r.user;invalidate();await refresh();await beginPair();return '用户已创建，请完成微信绑定';});
$('pair-start').onclick=()=>act(beginPair);
$('pair-submit').onclick=()=>act(async()=>{const code=$('pair-code').value;$('pair-code').value='';await api('pairing-code',{operationId:pairingByUser.get(user),value:code});await pollPair();});
$('pair-cancel').onclick=()=>act(async()=>{const stamp=epoch,r=await api('pairing-cancel',{operationId:pairingByUser.get(user)});if(stamp===epoch){showPair(r);pairingByUser.delete(user);await refresh();}});
setInterval(()=>{void pollPair();},1000);
