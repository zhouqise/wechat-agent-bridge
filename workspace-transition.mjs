// The daemon owns this operation until cleanup finishes, including during shutdown.
export class WorkspaceTransition {
  constructor(hooks){Object.assign(this,hooks);this.operation=null;this.phase='idle';}
  async run(value){
    if(this.operation)throw Error('工作目录正在切换，请稍后重试');
    const check=()=>{if(this.isStopping())throw Error('服务正在停止，未切换工作目录');};
    check();
    const operation=Promise.resolve().then(async()=>{
      let candidate,published=false;
      try{
        this.phase='preparing';const next=await this.prepare(value);check();
        if(next.unchanged)return next.result;
        candidate=this.create(next);await candidate.initialize();check();
        if(!candidate.ready)throw Error('目标引擎连接已断开');
        await this.persist(next,candidate);check();
        if(!candidate.ready)throw Error('目标引擎连接已断开');
        // No await between the final stop check and entering commit. Once begun,
        // shutdown waits for commit and publication; it cannot cancel a rename.
        this.phase='committing';await this.commit(next,candidate);
        const result=this.publish(next,candidate);published=true;return result;
      }finally{
        if(candidate && !published){try{candidate.close();}catch{}}
        this.phase='idle';
      }
    });
    this.operation=operation;
    try{return await operation;}finally{if(this.operation===operation)this.operation=null;}
  }
  async wait(){await this.operation?.catch(()=>{});}
}
