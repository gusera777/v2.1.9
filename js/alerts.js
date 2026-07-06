import { state, getLastResult } from './state.js';
import { CONST } from './constants.js';
import { fmtPrice } from './ui/dom-helpers.js';

/* ═══════════════════════════════════════════════════════════
   ALERTS
   ═══════════════════════════════════════════════════════════ */
export function beep(){
  try{
    const ctxA = new (window.AudioContext||window.webkitAudioContext)();
    const o = ctxA.createOscillator(), g = ctxA.createGain();
    o.type='sine'; o.frequency.value=880; g.gain.value=0.08;
    o.connect(g); g.connect(ctxA.destination);
    o.start(); o.stop(ctxA.currentTime+0.18);
  }catch(e){}
}
export function notify(sig){
  if(state.sound) beep();
  if(state.notif && state.notifPermission){
    try{
      new Notification(`GUSERA SATS — ${sig.side} ${state.symbol}`, {
        body: `Harga ${fmtPrice(sig.price)} · Skor ${sig.score.toFixed(0)}/${getLastResult()?getLastResult().maxScoreRef:CONST.MAX_SCORE_WITH_VOLUME} · SL ${fmtPrice(sig.sl)} · TP1 ${fmtPrice(sig.tp1)}`,
      });
    }catch(e){}
  }
}
