import {randomBytes, createHash} from 'node:crypto';

export const BASE = 'https://ilinkai.weixin.qq.com';
const info = {channel_version: '2.4.10', bot_agent: 'WeixinCodexBridge/0.1.0'};

export function trustedBase(value) {
  const u = new URL(value);
  if (u.protocol !== 'https:' || !u.hostname.endsWith('.weixin.qq.com') ||
      u.username || u.password || u.port || u.pathname !== '/' || u.search || u.hash) {
    throw new Error('拒绝非微信 HTTPS 服务地址');
  }
  return u.origin;
}

export async function api(base, endpoint, body, token, fetcher = fetch) {
  const headers = {'iLink-App-Id': 'bot', 'iLink-App-ClientVersion': String(0x02040a)};
  if (body !== undefined) {
    Object.assign(headers, {'Content-Type': 'application/json', AuthorizationType: 'ilink_bot_token',
      'X-WECHAT-UIN': Buffer.from(String(randomBytes(4).readUInt32BE())).toString('base64')});
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  const response = await fetcher(`${trustedBase(base)}/${endpoint}`, {
    method: body === undefined ? 'GET' : 'POST', headers,
    body: body === undefined ? undefined : JSON.stringify(token ? {...body, base_info: info} : body),
    signal: AbortSignal.timeout(40000), redirect: 'error',
  });
  if (!response.ok) throw new Error(`微信 HTTP 请求失败（${response.status}）`);
  const data = await response.json();
  for (const field of ['ret', 'errcode']) {
    if (data[field] !== undefined && data[field] !== 0) {
      const err = new Error(`微信接口返回错误码 ${Number(data[field])}`);
      err.code = data[field];
      throw err;
    }
  }
  return data;
}

export function textFor(msg, owner, allowMedia = false) {
  if (!owner || msg.from_user_id !== owner || msg.group_id || msg.message_type !== 1 ||
      msg.message_state !== 2 || !msg.context_token) return null;
  const text = (msg.item_list ?? []).filter(x => x.type === 1 && typeof x.text_item?.text === 'string')
    .map(x => x.text_item.text).join('\n').trim();
  if (!text && !(allowMedia && (msg.item_list ?? []).some(x=>x.type !== 1))) return null;
  return text;
}

export function replyFor(msg, owner) {
  const text = textFor(msg, owner);
  if (text === null) return null;
  if (text === '/状态') return '微信通道已连通。当前为回声测试模式，尚未接入 Codex。';
  return `收到：${[...text].slice(0, 1000).join('')}`;
}

// 先保存消息摘要再发送：网络结果不明确时不自动重发。可能漏回，但不会盲目重试。
export async function acceptBatch(state, batch, save, send, handle) {
  for (const msg of batch.msgs ?? []) {
    const text = handle ? textFor(msg, state.owner, true) : replyFor(msg, state.owner);
    if (text === null) continue;
    const id = msg.message_id ?? msg.client_id ?? msg.seq;
    if (id === undefined) continue;
    const key = createHash('sha256').update(`${state.owner}:${id}`).digest('hex');
    if (state.seen.includes(key)) continue;
    state.seen = [...state.seen, key].slice(-4096);
    await save(state);
    if (handle) { await handle(text, msg, key); continue; }
    await send({msg: {from_user_id: '', to_user_id: state.owner, client_id: `echo-${key}`,
      message_type: 2, message_state: 2, context_token: msg.context_token,
      item_list: [{type: 1, text_item: {text}}]}});
  }
  if (batch.get_updates_buf) state.cursor = batch.get_updates_buf;
  await save(state);
}
