import {setTimeout as delay} from 'node:timers/promises';
import {BASE,api,trustedBase} from './bridge.mjs';
export async function pairWechat({signal,onQr=async()=>{},onPhase=()=>{},getCode,commit,request,sleep,timeoutMs=300000}={}){
 const bounded=signal?AbortSignal.any([signal,AbortSignal.timeout(timeoutMs)]):AbortSignal.timeout(timeoutMs);
 const check=()=>{if(bounded.aborted)throw Error(signal?.aborted?'扫码已取消':'二维码等待超时，请重试');};
 const pause=sleep || (ms=>delay(ms,undefined,{signal:bounded}));
 const call=request || ((base,endpoint,body)=>api(base,endpoint,body,undefined,(url,options)=>fetch(url,{...options,signal:AbortSignal.any([options.signal,bounded])})));
 check();let qr;try{qr=await call(BASE,'ilink/bot/get_bot_qrcode?bot_type=3',{local_token_list:[]});}catch{check();throw Error('获取微信二维码失败，请重试');}check();
 if(typeof qr.qrcode!=='string'||!qr.qrcode||typeof qr.qrcode_img_content!=='string'||qr.qrcode_img_content.length>16000)throw Error('微信未返回有效二维码');
 await onQr(qr.qrcode_img_content);check();onPhase('waiting');let base=BASE,code,failures=0;
 while(true){
  check();let result;
  try{result=await call(base,`ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qr.qrcode)}${code?`&verify_code=${encodeURIComponent(code)}`:''}`);failures=0;}
  catch{check();if(++failures>=4)throw Error('登录轮询连续失败，请重试');await pause(2000);continue;}
  check();code=undefined;
  switch(result.status){
   case 'confirmed':{
    if(!result.bot_token||!result.ilink_user_id||!result.ilink_bot_id)throw Error('缺少绑定身份或凭证，未保存');
    const state={token:result.bot_token,owner:result.ilink_user_id,bot:result.ilink_bot_id,base:trustedBase(result.baseurl || base),cursor:'',seen:[]};
    // From this point cancellation waits for the rename outcome. Never release
    // the user's lock while this commit can still complete.
    check();onPhase('committing');await commit(state);onPhase('bound');return state;
   }
   case 'scaned_but_redirect':base=trustedBase(`https://${result.redirect_host}`);break;
   case 'need_verifycode':onPhase('need-code');if(!getCode)throw Error('需要手机配对码');code=await getCode(bounded);check();if(!/^\d{1,12}$/.test(code))throw Error('请输入手机显示的数字配对码');onPhase('waiting');break;
   case 'scaned':onPhase('scanned');break;
   case 'expired':throw Error('二维码已过期，请重试');
   case 'verify_code_blocked':throw Error('配对验证被限制，请稍后重试');
   case 'binded_redirect':throw Error('微信提示已有绑定，请先检查已有连接');
   case 'wait':break;
   default:throw Error('微信返回未支持的绑定状态');
  }
  try{await pause(1000);}catch{check();throw Error('扫码等待中止');}
 }
}
