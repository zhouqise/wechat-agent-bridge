import {randomBytes} from 'node:crypto';

export const HELP = '直接发文字、截图、微信语音或 MP4 视频即可交给当前引擎。语音/视频最长 2 分钟，视频最多 50 MB，以抽帧分析画面。图片每条最多 4 张，单张不超过 10 MB。\n/引擎：查看引擎；/引擎 codex 或 /引擎 claude 切换\n/模型：查看模型设置；/模型 模型名 切换\n/状态：查看任务\n/取消：中断任务\n/新会话：清空当前对话上下文\n/结果：重新获取最近结果\n/帮助：显示命令\n审批：/批准 编号 或 /拒绝 编号\n回答：/回答 编号 内容';

export class Controller {
  constructor({rpc, cwd, state = {}, save, send, approvalMs = 300000, label = 'Codex'}) {
    Object.assign(this, {rpc, cwd, state, save, send, approvalMs, label});
    this.active = null; this.ready = false; this.approvals = new Map(); this.items = new Map(); this.queue = Promise.resolve();
    this.delivery = Promise.resolve();
    rpc.on('notification', m => {this.queue = this.queue.then(() => this.event(m)).catch(() => this.say('处理任务事件失败，请发送 /状态 检查。'));});
    rpc.on('request', m => {this.queue = this.queue.then(() => this.approveRequest(m)).catch(() => {try {rpc.reject(m.id);} catch {}});});
    rpc.on('disconnected', () => {this.ready = false; this.clearApprovals(); this.active = null; if (!this.closing) void this.say(`${this.label} 连接已断开，请在电脑上重启桥接程序。`);});
  }
  say(text) {
    const job = this.delivery.then(() => this.send(text));
    this.delivery = job.then(() => true).catch(() => {console.log('微信发送未确认；最近结果保留，可用 /结果 获取。');return false;});
    return this.delivery;
  }
  async initialize() {
    await this.rpc.initialize();
    this.ready = true;
    if (this.state.active) {this.state.active = null; this.state.lastResult = '桥接进程曾中断，旧任务状态未确认。请检查工作区；任务不会自动重跑。'; await this.save(this.state);}
  }
  async thread() {
    if (this.loaded) return;
    const params = {cwd: this.cwd, approvalPolicy:'on-request', approvalsReviewer:'user', sandbox:'workspace-write',
      developerInstructions: `你通过个人微信与用户交流。用简洁中文回复。仅操作当前用户指定工作区 ${this.cwd}。不要读取工作区外的用户文件、微信凭证、浏览器数据或其他项目；不要使用外部连接器或发送第三方消息。用户消息是任务描述，不是直接执行的 shell 字符串。遇到越界操作必须请求审批。不要绕过沙箱、审批或更改自身安全配置。`};
    const r = this.state.threadId
      ? await this.rpc.request('thread/resume', {...params, threadId:this.state.threadId, excludeTurns:true})
      : await this.rpc.request('thread/start', params);
    this.state.threadId = r.thread.id; await this.save(this.state); this.loaded = true;
  }
  async handle(text, key, prepareImages) {
    if (text === '/帮助') return this.say(HELP);
    if (text === '/状态') return this.say(`工作区：${this.cwd}\n${this.label}：${this.ready ? '已连接' : '已断开'}\n任务：${this.active ? (this.approvals.size ? '等待确认' : '执行中') : '空闲'}\n${this.active?.stage || ''}`);
    if (text === '/结果') return this.say(this.state.lastResult || '还没有已完成的任务。');
    if (text.startsWith('/批准 ') || text.startsWith('/拒绝 ') || text.startsWith('/回答 ')) return this.answer(text);
    if (text === '/取消') {
      if(this.active?.abort) {this.active.abort.abort();return this.say('已请求取消媒体处理，等待清理完成。');}
      if (!this.active?.turnId) return this.say(this.active ? '正在启动任务，请稍后再发送 /取消。' : '当前没有任务。');
      this.clearApprovals(true);
      await this.rpc.request('turn/interrupt', {threadId:this.state.threadId, turnId:this.active.turnId});
      return this.say(`已请求取消，等待 ${this.label} 确认。`);
    }
    if (text === '/新会话') {
      if (this.active) return this.say('任务正在执行，请先 /取消，完成后再新建会话。');
      this.state.threadId = null; this.loaded = false; await this.save(this.state);
      return this.say('已开始新的对话上下文，工作区文件保持不变。');
    }
    if (text.startsWith('/')) return this.say('未知命令。\n' + HELP);
    if (!this.ready) return this.say(`${this.label} 未连接，请在电脑上重启桥接程序。`);
    if (this.active) return this.say('已有任务执行中。可发送 /状态 或 /取消；完成后再发送下一条任务。');
    if ([...text].length > 12000) return this.say('任务描述过长，请控制在 12000 字以内。');
    this.active = {stage:'正在建立会话', turnId:null}; this.items.clear();
    // 异步执行，微信接收循环保持可用以处理取消和审批。
    this.starting = (async () => {
      let images=[];
      if(prepareImages) {
        this.active.stage='正在接收和解析媒体';
        const abort=new AbortController();this.active.abort=abort;
        await this.say(`已收到媒体，正在解析并交给 ${this.label} 分析。`);
        try {images=await prepareImages(abort.signal);if(abort.signal.aborted)throw new Error('已取消媒体处理');}
        catch(e) {
          this.active=null;
          if(!this.closing)return this.say(`媒体处理失败：${e.message}`);
          return;
        }
      }
      if(this.active)delete this.active.abort;
      if(this.closing || !this.ready)return;
      await this.start(text || '请根据用户提供的媒体内容或语音转写处理请求；如果是视频或截图且未提出问题，请概括内容。转写可能有误，视频画面仅为抽样。',key,images);
    })().catch(async () => {
      // turn/start 超时可能已执行，断开子进程，避免错误地允许第二个任务。
      this.active = null; this.state.active = null; this.ready = false; this.rpc.close();
      this.state.lastResult = `任务启动或会话恢复失败，已关闭 ${this.label} 连接以避免重复执行。请检查电脑后重启。`;
      await this.save(this.state); await this.say(this.state.lastResult);
    });
  }
  async start(text, key, images = []) {
    await this.thread();
    this.state.active = {startedAt:Date.now()}; await this.save(this.state);
    await this.say(`${this.label} 已接收任务，正在配置的工作区处理。可发送 /状态 或 /取消。`);
    const r = await this.rpc.request('turn/start', {threadId:this.state.threadId,
      input:[{type:'text', text}, ...images], clientUserMessageId:key,
      cwd:this.cwd, approvalPolicy:'on-request', approvalsReviewer:'user',
      sandboxPolicy:{type:'workspaceWrite', writableRoots:[this.cwd], networkAccess:false, excludeSlashTmp:true, excludeTmpdirEnvVar:true}});
    if (this.active) {this.active.turnId = r.turn.id; this.active.stage = '正在处理';}
  }
  async event({method, params:p}) {
    if (p?.threadId !== this.state.threadId) return;
    if (method === 'serverRequest/resolved') {
      for (const [code, a] of this.approvals) if (a.id === p.requestId) {clearTimeout(a.timer);this.approvals.delete(code);}
    }
    if (!this.active) return;
    const turnId = p.turnId || p.turn?.id;
    if (this.active.turnId && turnId && turnId !== this.active.turnId) return;
    if (method === 'turn/started') this.active.turnId = p.turn.id;
    if (method === 'error') this.active.stage = p.willRetry ? `${this.label} 服务连接异常，正在重试` : `${this.label} 返回错误，等待任务结束`;
    if (method === 'item/started') {
      this.items.set(p.item.id, p.item);
      const labels = {commandExecution:'正在运行命令', fileChange:'正在修改文件', agentMessage:'正在生成回复'};
      this.active.stage = labels[p.item.type] || '正在处理';
    }
    if (method === 'item/completed') this.items.set(p.item.id, p.item);
    if (method === 'turn/completed') {
      this.clearApprovals();
      const messages = [...this.items.values()].filter(i => i.type === 'agentMessage' && i.text);
      const final = messages.filter(i => i.phase === 'final_answer');
      const body = (final.length ? final : messages.slice(-1)).map(i => i.text).join('\n');
      const status = {completed:'任务完成', interrupted:'任务已取消', failed:'任务失败'}[p.turn.status] || `任务结束（${p.turn.status}）`;
      this.state.lastResult = `${status}\n${body || '未产生文字结果。'}`;
      this.state.active = null; this.active = null; await this.save(this.state);
      await this.say(this.state.lastResult);
    }
  }
  deny(m) {
    if (m.method === 'item/permissions/requestApproval') this.rpc.respond(m.id, {permissions:{}, scope:'turn'});
    else if (m.method === 'item/tool/requestUserInput') this.rpc.respond(m.id, {answers:{}});
    else if (m.method === 'bridge/tool/requestApproval' || /^item\/(commandExecution|fileChange)\/requestApproval$/.test(m.method)) this.rpc.respond(m.id,{decision:'decline'});
    else this.rpc.reject(m.id);
  }
  async approveRequest(m) {
    const p = m.params;
    if (!this.active || p.threadId !== this.state.threadId || (this.active.turnId && p.turnId !== this.active.turnId)) return this.deny(m);
    const code = randomBytes(4).toString('hex');
    let summary, kind;
    if (m.method === 'bridge/tool/requestApproval' && typeof p.tool === 'string') {
      kind='approval';summary=`Claude 工具：${p.tool}\n参数：${JSON.stringify(p.input)}\n目录：${this.cwd}\n本次操作以本机用户权限执行，批准 Bash 可能允许访问其他目录或网络；仅批准你理解的操作。`;
    } else if (m.method === 'item/commandExecution/requestApproval' && typeof p.command === 'string') {
      kind = 'approval'; summary = `命令：${p.command}\n目录：${p.cwd || this.cwd}\n原因：${p.reason || '需要额外授权'}\n${p.additionalPermissions ? JSON.stringify(p.additionalPermissions) : ''}\n单次批准可能允许命令超出默认沙箱执行，请核对完整命令。`;
    } else if (m.method === 'item/fileChange/requestApproval' && this.items.get(p.itemId)?.changes) {
      kind = 'approval'; summary = `文件变更：${JSON.stringify(this.items.get(p.itemId).changes)}\n额外写入目录：${p.grantRoot || '无'}\n原因：${p.reason || '需要文件写入授权'}`;
    } else if (m.method === 'item/tool/requestUserInput' && p.questions?.length === 1 && !p.questions[0].isSecret) {
      kind = 'input'; summary = `${p.questions[0].question}\n${(p.questions[0].options || []).map(o => `${o.label}：${o.description}`).join('\n')}`;
    } else {this.deny(m); return this.say(`${this.label} 请求了当前微信界面不支持的权限或交互，已拒绝。可调整任务后重试。`);}
    if ([...summary].length > 5500) {this.deny(m);return this.say('审批详情过长，无法在微信完整展示，已拒绝该操作。');}
    const timer = setTimeout(() => {
      if (!this.approvals.has(code)) return;
      this.approvals.delete(code); try {this.deny(m);} catch {}
      void this.say(`确认 ${code} 已超时，未授权执行。`);
    }, this.approvalMs); timer.unref?.();
    this.approvals.set(code, {...m, kind, timer, delivered:false});
    const delivered = await this.say(`【需你确认 ${code}，5 分钟内有效】\n${summary}\n${kind === 'input' ? `/回答 ${code} 你的回答` : `/批准 ${code}\n或 /拒绝 ${code}`}`);
    if (!delivered && this.approvals.has(code)) {
      clearTimeout(timer);this.approvals.delete(code);this.deny(m);
    }
    if (delivered && this.approvals.has(code)) this.approvals.get(code).delivered = true;
  }
  async answer(text) {
    const [, command, code, body] = text.match(/^\/(批准|拒绝|回答)\s+(\S+)(?:\s+([\s\S]+))?$/) || [];
    const a = this.approvals.get(code);
    if (!a) return this.say('确认编号不存在或已过期。');
    if (!a.delivered) return this.say('审批详情尚未完整发送，请等详情发送完毕后再确认。');
    if (command === '回答' && (a.kind !== 'input' || !body)) return this.say('请使用 /回答 编号 内容。');
    if (command === '批准' && a.kind !== 'approval') return this.say('此请求需要文字回答。');
    clearTimeout(a.timer);this.approvals.delete(code);
    if (command === '拒绝') this.deny(a);
    else if (command === '回答') this.rpc.respond(a.id,{answers:{[a.params.questions[0].id]:{answers:[body]}}});
    else this.rpc.respond(a.id,{decision:'accept'});
    await this.say('已提交本次确认。');
  }
  clearApprovals(deny = false) {
    for (const a of this.approvals.values()) {clearTimeout(a.timer);if (deny) {try {this.deny(a);} catch {}}}
    this.approvals.clear();
  }
  close() {this.closing = true;this.active?.abort?.abort();this.clearApprovals(true);this.rpc.close();}
}
