import {randomBytes} from 'node:crypto';
const titleOf=text=>String(text || '').replace(/[\x00-\x1f\x7f]/g,' ').trim().slice(0,60);
export function ensureConversations(state){
  if(!state.conversations)state.conversations=[];
  if(!state.conversations.some(c=>c.id===state.currentConversation)){
    const entry={id:randomBytes(4).toString('hex'),title:state.threadId?'原有会话':'新会话',createdAt:Date.now(),updatedAt:Date.now(),threadId:state.threadId || null,lastResult:state.lastResult || null};
    state.conversations.push(entry);state.currentConversation=entry.id;
  }
  return state.conversations.find(c=>c.id===state.currentConversation);
}
export function syncConversation(state,text){
  const c=ensureConversations(state);c.threadId=state.threadId || null;c.lastResult=state.lastResult || null;
  if(text){if(c.title==='新会话')c.title=titleOf(text) || '附件任务';c.updatedAt=Date.now();}
  return c;
}
export function conversationList(state,page=1){
  syncConversation(state);
  const all=[...state.conversations].sort((a,b)=>b.updatedAt-a.updatedAt),pages=Math.max(1,Math.ceil(all.length/10));
  if(!Number.isInteger(page)||page<1||page>pages)throw Error(`页码须在 1–${pages} 之间`);
  return `当前会话：${state.currentConversation}\n会话列表 ${page}/${pages}（${all.length} 个，仅当前项目和引擎）\n`+all.slice((page-1)*10,page*10).map(c=>`${c.id===state.currentConversation?'★':'·'} ${c.id} ${c.title}\n  最近使用：${new Date(c.updatedAt).toISOString().slice(0,16).replace('T',' ')} UTC`).join('\n')+'\n/切换会话 编号\n/删除会话 编号\n/新会话 可选名称'+(pages>1?'\n/会话 页码':'');
}
export function changeConversation(state,action,value){
  syncConversation(state);
  let target;
  if(action==='new'){
    if(state.conversations.length>=100)throw Error('当前项目和引擎已达到 100 个会话，请先删除不再需要的会话');
    if([...String(value || '')].length>60)throw Error('会话名称最多 60 字');
    target={id:randomBytes(4).toString('hex'),title:titleOf(value)||'新会话',createdAt:Date.now(),updatedAt:Date.now(),threadId:null,lastResult:null};state.conversations.push(target);
  }else{
    target=state.conversations.find(c=>c.id===value);if(!target)throw Error('会话编号不存在；请发送 /会话 查看当前项目和引擎的列表');
    if(action==='delete'){
      state.conversations=state.conversations.filter(c=>c.id!==value);
      if(value!==state.currentConversation)return {id:value,changed:false};
      target=[...state.conversations].sort((a,b)=>b.updatedAt-a.updatedAt)[0];
      if(!target){state.currentConversation=null;state.threadId=null;state.lastResult=null;target=ensureConversations(state);}
    }else if(action!=='switch')throw Error('未知会话操作');
  }
  state.currentConversation=target.id;state.threadId=target.threadId;state.lastResult=target.lastResult;state.active=null;target.updatedAt=Date.now();
  return {id:target.id,changed:true};
}
export const isConversationMutation=text=>/^\/(新会话|切换会话|删除会话)(?:\s|$)/.test(text);
