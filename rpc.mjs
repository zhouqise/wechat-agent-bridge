import {codexSettings} from './codex-config.mjs';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {EventEmitter} from 'node:events';
import {codexCommand,stopChild} from './platform.mjs';

export class CodexRPC extends EventEmitter {
  constructor({cwd, config = {}, binary, spawnFn = spawn, proxy = process.env.BRIDGE_CODEX_PROXY} = {}) {
    super(); this.next = 1; this.pending = new Map(); this.closed = false;
    this.settings=codexSettings(config);
    const env = {...process.env};
    if (proxy) {
      const u = new URL(proxy);
      if (!['http:', 'https:', 'socks5:', 'socks5h:'].includes(u.protocol) || u.username || u.password) throw new Error('代理地址不合法，请提供不含账号密码的 HTTP 或 SOCKS 地址');
      env.HTTPS_PROXY = env.HTTP_PROXY = env.ALL_PROXY = proxy;
      env.https_proxy = env.http_proxy = env.all_proxy = proxy;
    }
    const command=codexCommand(['app-server','--stdio',...this.settings.args],{env:binary?{...env,CODEX_BINARY:binary}:env});
    this.child = spawnFn(command.file, command.args, {cwd, env, stdio: ['pipe', 'pipe', 'pipe'], shell: false, windowsHide:true});
    // stderr 可能包含本机路径或工具配置，禁止直接回传微信。
    this.child.stderr.on('data', () => {});
    this.lines = createInterface({input: this.child.stdout});
    this.lines.on('line', line => {
      let m; try {m = JSON.parse(line);} catch {return;}
      if (m.method) this.emit(m.id === undefined ? 'notification' : 'request', m);
      else if (this.pending.has(m.id)) {
        const p = this.pending.get(m.id); clearTimeout(p.timer); this.pending.delete(m.id);
        if (m.error) p.reject(new Error(`Codex 请求失败：${p.method}（${m.error.code}）`));
        else p.resolve(m.result);
      }
    });
    this.child.stdin.on('error', () => this.fail());
    this.child.on('error', () => this.fail());
    this.child.on('exit', () => this.fail());
  }
  fail() {
    if (this.closed) return; this.closed = true;
    for (const p of this.pending.values()) {clearTimeout(p.timer); p.reject(new Error('Codex 连接已断开'));}
    this.pending.clear(); this.emit('disconnected');
  }
  write(message) {
    if (this.closed) throw new Error('Codex 连接已断开，请重启桥接程序');
    this.child.stdin.write(JSON.stringify(message) + '\n');
  }
  request(method, params = {}) {
    if(this.settings.model && ['thread/start','thread/resume','turn/start'].includes(method))params={...params,model:this.settings.model};
    if(this.settings.auth==='api' && ['thread/start','thread/resume'].includes(method))params={...params,model:this.settings.model,modelProvider:'wx_agent_api'};
    return new Promise((resolve, reject) => {
      const id = this.next++;
      const timer = setTimeout(() => {this.pending.delete(id); reject(new Error(`Codex 请求超时：${method}`));}, 60000);
      this.pending.set(id, {resolve, reject, timer, method});
      try {this.write({id, method, params});} catch (e) {clearTimeout(timer);this.pending.delete(id);reject(e);}
    });
  }
  respond(id, result) {this.write({id, result});}
  reject(id) {this.write({id, error: {code: -32601, message: 'Unsupported client request'}});}
  async initialize() {
    await this.request('initialize', {clientInfo: {name:'weixin_codex_bridge', title:'微信 Codex 桥接', version:'0.14.0'}});
    this.write({method:'initialized', params:{}});
  }
  close() {stopChild(this.child); this.fail(); this.lines.close();}
}
