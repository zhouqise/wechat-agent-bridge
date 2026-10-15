import fs from 'node:fs/promises';
import path from 'node:path';
import {paths, privateDir, acquireLock, releaseLock, readJSON, writeJSON} from './paths.mjs';
import {serve} from './service.mjs';
import {createInterface} from 'node:readline/promises';
import QRCode from 'qrcode';
import {randomUUID} from 'node:crypto';
import {BASE, api, trustedBase, acceptBatch} from './bridge.mjs';
import {engineName,makeController} from './engines.mjs';
import {imageInputs} from './media.mjs';

const p = paths();
const dir = p.dir;
const sessionPath = p.session;
const qrPath = p.qr;
const sleep = ms => new Promise(r => setTimeout(r, ms));
let locked = false;
let controller;
let server;
let startedAt = Date.now();
let lastPollAt = null;
let lastReceivedAt = null;
let stopping = false;
let saving = Promise.resolve();
async function save(state) {
  const data = JSON.stringify(state);
  const job = saving.then(async () => {
    const temp = path.join(dir, 'session.tmp');
    await fs.writeFile(temp, data, {mode: 0o600});
    await fs.chmod(temp, 0o600);
    await fs.rename(temp, sessionPath);
  });
  saving = job.catch(() => {});
  return job;
}
async function clean() {
  if (stopping) return;
  stopping = true;
  controller?.close();
  await saving;
  await server?.close();
  if (locked) {
    await fs.rm(qrPath, {force:true});
    await releaseLock(p);
  }
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {void clean().finally(() => process.exit(0));});

async function login() {
  const qr = await api(BASE, 'ilink/bot/get_bot_qrcode?bot_type=3', {local_token_list: []});
  if (typeof qr.qrcode !== 'string' || typeof qr.qrcode_img_content !== 'string') {
    throw new Error('服务未返回有效二维码，当前账号或接口可能暂不可用');
  }
  await QRCode.toFile(qrPath, qr.qrcode_img_content, {width: 480, margin: 3});
  await fs.chmod(qrPath, 0o600);
  console.log(await QRCode.toString(qr.qrcode_img_content,{type:'terminal',small:true}));
  console.log(`请用手机微信扫描二维码；图片备份：${qrPath}`);
  console.log('扫码后请在手机上确认连接。二维码最长等待 5 分钟。');
  let base = BASE, code;
  const until = Date.now() + 300000;
  let failures = 0;
  while (Date.now() < until) {
    let result;
    try {
      result = await api(base, `ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qr.qrcode)}${code ? `&verify_code=${encodeURIComponent(code)}` : ''}`);
      failures = 0;
    } catch {
      if (++failures >= 4) throw new Error('登录轮询连续失败，请重新启动');
      await sleep(2000); continue;
    }
    switch (result.status) {
      case 'confirmed': {
        if (!result.bot_token || !result.ilink_user_id || !result.ilink_bot_id) throw new Error('缺少绑定者身份或凭证，停止连接');
        const state = {token: result.bot_token, owner: result.ilink_user_id, bot: result.ilink_bot_id,
          base: trustedBase(result.baseurl || base), cursor: '', seen: []};
        await save(state);
        await fs.rm(qrPath, {force: true});
        console.log('扫码绑定成功，凭证已保存在本机。');
        return state;
      }
      case 'scaned_but_redirect':
        base = trustedBase(`https://${result.redirect_host}`); break;
      case 'need_verifycode': {
        if (!process.stdin.isTTY) throw new Error('需要手机配对码：请在本机终端运行 wx-agent login 后输入，不要在聊天中发送验证码');
        const rl = createInterface({input: process.stdin, output: process.stdout});
        code = (await rl.question('请输入手机显示的配对数字：')).trim(); rl.close(); break;
      }
      case 'scaned': code = undefined; break;
      case 'expired': throw new Error('二维码已过期，请重新启动以生成新二维码');
      case 'verify_code_blocked': throw new Error('配对验证被限制，请稍后重试');
      case 'binded_redirect': throw new Error('服务提示已有绑定，但本程序没有可用凭证；请在微信检查已有连接');
      case 'wait': break;
      default: throw new Error('遇到未支持的登录状态，已停止');
    }
    await sleep(1000);
  }
  throw new Error('扫码等待超时，请重新启动');
}

async function main() {
  await privateDir(dir);
  await acquireLock(p);locked = true;
  if(process.argv.includes('--login') && process.argv.includes('--force')) {
    await fs.rename(sessionPath,sessionPath+'.backup').catch(e=>{if(e.code!=='ENOENT')throw e;});
  }
  let state;
  try {state = JSON.parse(await fs.readFile(sessionPath, 'utf8'));}
  catch (e) {if (e.code !== 'ENOENT') throw new Error('状态文件无法读取，请先检查备份');}
  if (!state && process.argv.includes('--daemon')) throw new Error('尚未绑定微信，请运行 wx-agent setup');
  if (!state) state = await login();
  if (!state.token || !state.owner || !Array.isArray(state.seen)) throw new Error('登录状态不完整');
  trustedBase(state.base);
  if (process.argv.includes('--login')) {console.log('微信已绑定。运行 wx-agent start 即可后台启动。');return;}
  const echo = process.argv.includes('--echo');
  let contextToken,config,cwd,engine='codex';
  let selectEngine;
  if (!echo) {
    config = await readJSON(p.config, {});
    const requested = config.workspace || p.workspace;
    await fs.mkdir(requested,{recursive:true});
    cwd = await fs.realpath(requested);
    const send=async text => {
        if (!contextToken) throw new Error('需要先收到微信消息才能回复');
        const chars = [...text];
        const limit = 16000;
        const clipped = chars.slice(0,limit).join('') + (chars.length > limit ? '\n（内容较长，微信最多展示 16000 字。）' : '');
        const parts = [...clipped];
        for (let i = 0; i < parts.length; i += 1800) {
          const sent = await api(state.base,'ilink/bot/sendmessage',{msg:{from_user_id:'',to_user_id:state.owner,
            client_id:randomUUID(),message_type:2,message_state:2,context_token:contextToken,
            item_list:[{type:1,text_item:{text:parts.slice(i,i+1800).join('')}}]}},state.token);
          if (sent.ret !== 0) throw new Error('发送未确认');
        }
        console.log('已向绑定用户发送一条引擎状态或结果。');
      };
    selectEngine=async (name,persist=false)=>{
      const next=engineName(name);
      const candidate=makeController({engine:next,cwd,config,state,save:async()=>save(state),send});
      try {
        await candidate.initialize();
        if(persist)await writeJSON(p.config,{...config,engine:next});
      }catch(e){candidate.close();throw e;}
      controller?.close();controller=candidate;engine=next;config.engine=next;
      await save(state);
    };
    await selectEngine(config.engine || 'codex');
  }
  server = await serve(p, () => ({pid:process.pid,startedAt,mode:echo?'echo':engine,engine,wechatBound:true,lastPollAt,lastReceivedAt,agentReady:!!controller?.ready,codexConnected:engine==='codex' && !!controller?.ready,workspace:cwd,task:controller?.active?(controller.approvals.size?'等待确认':'执行中'):'空闲'}), () => {void clean().finally(()=>process.exit(0));});
  console.log('桥接已启动。微信发送 /帮助 或直接发送任务；wx-agent status 查看状态。');
  let failures = 0;
  while (true) {
    try {
      const batch = await api(state.base, 'ilink/bot/getupdates', {get_updates_buf: state.cursor || ''}, state.token);
      lastPollAt = Date.now();
      await acceptBatch(state, batch, save, async body => {
        const sent = await api(state.base, 'ilink/bot/sendmessage', body, state.token);
        if (sent.ret !== 0) throw new Error('发送响应未确认成功');
        console.log('已向绑定用户回复一条测试消息。');
      }, echo ? undefined : async (text,msg,key) => {
        lastReceivedAt = Date.now();
        contextToken = msg.context_token;
        if(text==='/引擎') {await controller.say(`当前引擎：${engine}。发送 /引擎 codex 或 /引擎 claude 切换，两个引擎分别保留会话。`);return;}
        if(text.startsWith('/引擎 ')) {
          if(controller.active){await controller.say('任务执行中，请等待完成或 /取消 后再切换引擎。');return;}
          const next=text.slice(4).trim().toLowerCase();
          if(!['codex','claude'].includes(next)){await controller.say('请使用 /引擎 codex 或 /引擎 claude');return;}
          if(next===engine){await controller.say(`当前已经是 ${engine}。`);return;}
          try {await selectEngine(next,true);await controller.say(`已切换到 ${engine}，该引擎的会话独立保留。`);}
          catch {await controller.say('引擎切换失败，仍保留原引擎。请在电脑上用 wx-agent doctor --engine '+next+' 检查安装及认证配置。');}
          return;
        }
        const items=msg.item_list ?? [];
        if(items.some(i=>i.type!==1 && i.type!==2)) {
          await controller.say('这条消息包含暂不支持的内容，请使用文字或直接发送截图（PNG/JPEG/WebP）；语音、视频和文件暂不处理。');
          return;
        }
        await controller.handle(text,key,items.some(i=>i.type===2)?()=>imageInputs(items):undefined);
      });
      failures = 0;
      await sleep(1000);
    } catch (e) {
      if (e.code === -14) throw new Error('微信登录已失效，请停止并重新绑定');
      // 长轮询没有新消息时的超时不代表登录或连接故障。
      if (e.name === 'TimeoutError' || e.name === 'AbortError') continue;
      if (++failures >= 5) throw new Error('收发连续失败 5 次，已停止。请检查网络后重新启动。');
      console.log('本次收发未确认完成，稍后恢复接收；不会自动重发不确定的回复。');
      await sleep(Math.min(30000, 2000 * 2 ** failures));
    }
  }
}
try {await main();}
catch (e) {console.error(e.message.startsWith('fetch') ? '网络连接失败，请检查网络后重试。' : e.message); process.exitCode = 1;}
finally {await clean();}
