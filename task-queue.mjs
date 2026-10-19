import {randomBytes} from 'node:crypto';
// One scheduler per bound user. Payloads stay in memory; only recovery counts persist.
export class TaskQueue {
  constructor({run,say,save=async()=>{},state={},textMs=1500,mediaMs=8000,maxMs=20000,quiet=false,available=()=>true}) {
    Object.assign(this,{run,say,save,state,textMs,mediaMs,maxMs,quiet,available});this.pending=[];this.active=null;
    this.recovered=(state.waiting || 0)+(state.running?1:0);state.waiting=0;state.running=null;
  }
  get busy(){return !!this.active || this.pending.length>0;}
  async persist(){this.state.waiting=this.pending.length;this.state.running=this.active?.id || null;await this.save();}
  async enqueue(text,items,key,contextToken){
    if(this.closed)return this.say('任务队列已关闭，请在电脑检查并重启服务。');
    if(this.recovered){await this.say(`上次进程中断时有 ${this.recovered} 个未确认任务；未自动重跑，请核对后重发。`);this.recovered=0;}
    const now=Date.now(),last=this.pending.at(-1),merge=last && !last.sealed && now<last.due;
    const task=merge?last:{id:randomBytes(3).toString('hex'),text:'',items:[],key,contextToken,created:now};
    const combined=[task.text,text].filter(Boolean).join('\n'),all=[...task.items,...items.filter(i=>i.type!==1)];
    if(combined.length>12000 || all.filter(i=>i.type===2).length>4 || all.filter(i=>i.type===4).length>4 || all.filter(i=>i.type===5 || i.type===3).length>1 || all.length>10) return this.say('合并内容超过限制：最多 12000 字、4 张图片、4 个文件、1 个视频。请 /开始 提交当前内容后分批发送。');
    if(!merge && this.pending.length>=10)return this.say('等待队列已满（10 个），请等待或 /取消 编号。');
    Object.assign(task,{text:combined,items:all,contextToken,due:Math.min(task.created+this.maxMs,now+(all.length?this.mediaMs:this.textMs))});
    if(!merge)this.pending.push(task);
    await this.persist();this.arm();
    if(!merge && (!this.quiet || all.length || this.active || !this.available()))await this.say(`已接收任务 ${task.id}${all.length?'，等待 8 秒合并后续说明或附件':'，短暂合并连续消息'}。${this.active?'正在排队。':''}发送 /开始 立即提交，/任务 查看。`);
  }
  arm(){clearTimeout(this.timer);if(this.closed || this.active || !this.pending.length)return;this.timer=setTimeout(()=>{void this.pump().catch(()=>{this.close();void this.say('任务队列无法保存，已暂停接收，请重启并检查磁盘。');});},Math.max(0,this.pending[0].due-Date.now()));this.timer.unref?.();}
  async pump(){
    if(this.closed || this.active || !this.pending.length)return;
    if(this.pending[0].due>Date.now()){this.arm();return;}
    if(!this.available()){this.timer=setTimeout(()=>{this.arm();},1000);this.timer.unref?.();return;}
    const task=this.pending.shift();this.active=task;
    try{await this.persist();await this.run(task);}
    catch{await this.say(`任务 ${task.id} 未完成，请检查 /状态；不会自动重跑。`);}
    finally{this.active=null;await this.persist();this.arm();}
  }
  async command(text){
    if(['/任务','/队列'].includes(text)){await this.say([this.active?`执行中：${this.active.id}`:'当前无执行任务',...this.pending.map(t=>`${t.id} ${t.sealed || t.due<=Date.now()?'排队':'正在合并'}：${(t.text || '附件任务').slice(0,80)}`)].join('\n'));return true;}
    if(text==='/开始'){for(const t of this.pending){t.sealed=true;t.due=0;}this.arm();await this.say(this.pending.length?'已提交等待中的内容。':'没有等待提交的内容。');return true;}
    if(text==='/清空队列'){this.pending=[];clearTimeout(this.timer);await this.persist();await this.say('已清空等待队列，执行中的任务保持运行。');return true;}
    if(text.startsWith('/取消 ')){
      const id=text.slice(4).trim(),i=this.pending.findIndex(t=>t.id===id);
      if(i<0){await this.say(this.active?.id===id?'该任务正在执行，请用 /取消 中断。':'未找到等待中的任务编号。');return true;}
      this.pending.splice(i,1);await this.persist();this.arm();await this.say(`已移除任务 ${id}。`);return true;
    }
    if(text==='/取消' && !this.active && this.pending.length){const t=this.pending.shift();await this.persist();this.arm();await this.say(`已移除任务 ${t.id}。`);return true;}
    return false;
  }
  close(){this.closed=true;clearTimeout(this.timer);}
}
