import {randomBytes} from 'node:crypto';
const titleOf=text=>String(text || '').replace(/[\x00-\x1f\x7f]/g,' ').trim().slice(0,60);
export function ensureConversations(state){
  if(!state.conversations)state.conversations=[];
  if(!state.conversations.some(c=>c.id===state.currentConversation)){
    const entry={id:randomBytes(4).toString('hex'),title:state.threadId?'原有会话':'新会话',createdAt:Date.now(),updatedAt:Date.now(),threadId:state.threadId || null,lastResult:state.lastResult || null};
    state.conversations.push(entry);state.currentConversation=entry.id;
  }
  state.nextConversationNumber=Math.max(state.nextConversationNumber || 1,...state.conversations.map(c=>(c.number || 0)+1));
  for(const c of state.conversations)if(!c.number)c.number=state.nextConversationNumber++;
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
  const current=state.conversations.find(c=>c.id===state.currentConversation);
  return `当前：${current.title}（序号 ${current.number}）\n会话 ID：${current.id}\n会话列表 ${page}/${pages}（${all.length} 个）\n\n`+all.slice((page-1)*10,page*10).map(c=>`${c.number}. ${[...c.title].slice(0,30).join('')}${[...c.title].length>30?'…':''}${c.id===state.currentConversation?' 【当前】':''}\nID：${c.id}\n/切换会话 ${c.id}\n快捷：/切换会话 ${c.number}\n/删除会话 ${c.id}`).join('\n\n')+'\n\n复制上面的完整命令即可。也可输入 /切换会话 ID。\n序号固定，不随排序变化；删除后不复用。\n/新会话 可选名称'+(pages>1?`\n/会话 ${page<pages?page+1:1}`:'');
}
export function changeConversation(state,action,value){
  syncConversation(state);
  let target;
  if(action==='new'){
    if(state.conversations.length>=100)throw Error('当前项目和引擎已达到 100 个会话，请先删除不再需要的会话');
    if([...String(value || '')].length>60)throw Error('会话名称最多 60 字');
    target={id:randomBytes(4).toString('hex'),title:titleOf(value)||'新会话',createdAt:Date.now(),updatedAt:Date.now(),threadId:null,lastResult:null};state.conversations.push(target);
  }else{
    target=state.conversations.find(c=>c.id===value) || (/^[1-9]\d{0,6}$/.test(value)?state.conversations.find(c=>c.number===Number(value)):undefined);if(!target)throw Error('会话编号不存在；请发送 /会话 查看当前项目和引擎的列表');
    if(action==='delete'){
      const removedId=target.id;state.conversations=state.conversations.filter(c=>c.id!==removedId);
      if(removedId!==state.currentConversation)return {id:removedId,changed:false};
      target=[...state.conversations].sort((a,b)=>b.updatedAt-a.updatedAt)[0];
      if(!target){state.currentConversation=null;state.threadId=null;state.lastResult=null;target=ensureConversations(state);}
    }else if(action!=='switch')throw Error('未知会话操作');
  }
  state.currentConversation=target.id;state.threadId=target.threadId;state.lastResult=target.lastResult;state.active=null;target.updatedAt=Date.now();
  return {id:target.id,changed:true};
}
export const isConversationMutation=text=>/^\/(新会话|切换会话|删除会话)(?:\s|$)/.test(text);
