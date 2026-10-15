import {test} from 'node:test';
import assert from 'node:assert/strict';
import {trustedBase, replyFor, acceptBatch, api} from '../bridge.mjs';

const message = {message_id: 7, from_user_id: 'owner', to_user_id: 'bot', message_type: 1,
  message_state: 2, context_token: 'ctx', item_list: [{type: 1, text_item: {text: '测试'}}]};
test('仅允许腾讯 HTTPS 地址，拒绝伪后缀、端口和用户信息', () => {
  assert.equal(trustedBase('https://ilinkai.weixin.qq.com'), 'https://ilinkai.weixin.qq.com');
  for (const url of ['http://ilinkai.weixin.qq.com', 'https://weixin.qq.com.evil.org', 'https://evilweixin.qq.com', 'https://user@ilinkai.weixin.qq.com', 'https://ilinkai.weixin.qq.com:8443']) {
    assert.throws(() => trustedBase(url));
  }
});
test('仅回复绑定者的完整私聊文字消息，拒绝群聊、机器人和缺少上下文的消息', () => {
  assert.equal(replyFor(message, 'owner'), '收到：测试');
  for (const change of [{from_user_id: 'stranger'}, {message_type: 2}, {group_id: 'group'}, {context_token: ''}, {message_state: 1}]) {
    assert.equal(replyFor({...message, ...change}, 'owner'), null);
  }
  assert.equal(replyFor(message, ''), null);
});
test('持久化后才发送，重放不会再次发送；发送不明确失败不自动重发', async () => {
  const state = {owner: 'owner', seen: [], cursor: ''};
  let saved = 0, sent = 0;
  const send = async () => {assert.ok(saved > 0); sent++; throw new Error('timeout');};
  await assert.rejects(acceptBatch(state, {msgs: [message], get_updates_buf: 'next'}, async () => saved++, send));
  assert.equal(state.cursor, '');
  await acceptBatch(state, {msgs: [message], get_updates_buf: 'next'}, async () => saved++, send);
  assert.equal(sent, 1);
  assert.equal(state.cursor, 'next');
});
test('鉴权失败只输出错误码，不泄露服务器响应及凭证', async () => {
  await assert.rejects(api('https://ilinkai.weixin.qq.com', 'ilink/bot/getupdates', {}, 'secret', async () => ({ok:true, json:async()=>({ret:-14, errmsg:'secret'})})), e => e.code === -14 && !e.message.includes('secret'));
});
