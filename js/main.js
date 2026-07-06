/* ═══════════════════════════════════════════════════════════
   GUSERA · SATS — Self-Aware Trend System (web port)
   Port dari Pine Script v6 "Self-Aware Trend System [GUSERA]"
   Semua komputasi berjalan client-side di browser.
   ─────────────────────────────────────────────────────────
   Entry point orkestrator: main loop (runCycle/processAndRender), wiring UI
   (event listener tombol/tab/form), toast, download CSV, reset, dan init awal.
   Logic murni (indikator, engine, self-learning) dan render/DOM sudah dipecah
   ke modul terpisah — lihat MODULES.md untuk peta lengkapnya.
   ═══════════════════════════════════════════════════════════ */
import { state, getLastResult, setLastResult } from './state.js';
import { CONST } from './constants.js';
import { clamp, presetParams, tfToMinutes } from './utils.js';
import { computeTrendWeights } from './self-learning.js';
import { computeEngine } from './engine.js';
import { fetchCandles, parseCsv } from './api-client.js';
import {
  persistedHistory, persistedSkipped,
  loadPersistedHistory, loadPersistedSkipped,
  resetPersistedHistory, resetPersistedSkipped,
  syncPersistedHistory, syncPersistedSkipped,
} from './history-store.js';
import { setStatus, setModalStatus, setConn, fmtPrice } from './ui/dom-helpers.js';
import { drawGauge, drawChart } from './ui/charts.js';
import { renderAll, historyRows } from './ui/render.js';
import { updateProfilePanel } from './ui/profile.js';
import { exportFullHistoryExcel } from './xlsx-export.js';
import { notify } from './alerts.js';

/* ═══════════════════════════════════════════════════════════
   MAIN LOOP
   ═══════════════════════════════════════════════════════════ */
let prevSignalCount = 0;

async function runCycle(){
  try{
    setConn('', 'Sinkron');
    const candles = await fetchCandles();
    state.candles = candles;
    processAndRender(candles);
    setConn('live','Live');
    setStatus('');
  }catch(err){
    setConn('err','Error');
    // Rotasi key/rate-limit sekarang murni ditangani server-side oleh proxy Worker
    // (lihat worker/index.js) — dari sisi client, error yang sampai ke sini cuma
    // berupa: transient (koneksi ke proxy, sudah di-retry otomatis via withRetry),
    // atau pesan apa adanya dari proxy (mis. "semua key server kena limit").
    let hint = ' — cek koneksi, atau pakai mode CSV di Pengaturan.';
    if(err.isTransient) hint = ' — koneksi ke proxy server bermasalah (sudah dicoba ulang otomatis). Cek internet Anda, atau pakai mode CSV.';
    setStatus('Fetch gagal: '+err.message+hint, 'err');
  }
}

function processAndRender(candles){
  if(candles.length<60){ setStatus('Data terlalu sedikit ('+candles.length+' candle). Perbesar outputsize atau cek symbol/interval.', 'err'); return; }
  const tfMinutes = tfToMinutes(state.interval);
  const pp = presetParams(state.preset, tfMinutes);
  // Bobot confluence dipelajari dari riwayat SEBELUM cycle ini (persistedHistory belum
  // di-sync dengan sinyal cycle ini di titik ini) — supaya sinyal baru tidak "mempengaruhi
  // diri sendiri" secara sirkular. Lihat computeConfluenceWeights().
  const weights = computeTrendWeights();
  const cfg = {
    atrLen: pp.atrLen, baseMult: pp.baseMult, erLen: pp.erLen, rsiLen: pp.rsiLen, slMult: pp.slMult,
    tpMode: state.tpMode, qualityStrength: state.qualityStrength,
    useAsym: state.useAsym, useCharFlip: state.useCharFlip, useEffAtr: state.useEffAtr,
    useBreakeven: state.useBreakeven,
    useCandleConfirm: state.useCandleConfirm,
    requirePatternConfluence: state.useRequirePattern,
    structWeight: weights.structWeight, momWeight: weights.momWeight,
    patternWeight: weights.patternWeight,
    tqiEffWeight: weights.tqiEffWeight, tqiVolWeight: weights.tqiVolWeight,
  };
  const res = computeEngine(candles, cfg);
  res.confluenceWeights = weights; // dipakai renderAll() untuk tooltip transparansi bobot yang dipelajari
  syncPersistedHistory(res.signals); // simpan trade yang closed cycle ini ke riwayat permanen
  syncPersistedSkipped(res.skippedSignals); // simpan hasil simulasi sinyal terlewat yang sudah resolve
  // Ambang self-learning yang dipakai di atas untuk menggerbang entry cycle ini (lihat
  // computeEngine) — dipakai lagi di sini murni untuk ditampilkan di UI, jadi angka yang
  // ditampilkan (kartu "Ambang Skor") DIJAMIN sama dengan yang benar-benar menentukan
  // entry mana yang dieksekusi, bukan dihitung ulang terpisah dan berpotensi berbeda.
  state.currentThreshold = res.entryThreshold;
  setLastResult(res); // set before notify() so it always reflects the current cycle's maxScoreRef
  if(res.signals.length>prevSignalCount){
    const newSigs = res.signals.slice(prevSignalCount);
    newSigs.forEach(s=>notify(s)); // semua signals di sini sudah lolos ambang self-learning (lihat computeEngine)
  }
  prevSignalCount = res.signals.length;
  renderAll(res, candles);
}

function startLoop(){
  if(state.timer) clearInterval(state.timer);
  runCycle();
  state.timer = setInterval(runCycle, state.refreshMs);
}
function stopLoop(){ if(state.timer){ clearInterval(state.timer); state.timer=null; } }

/* ═══════════════════════════════════════════════════════════
   UI WIRING
   ═══════════════════════════════════════════════════════════ */
const overlay = document.getElementById('overlay');
document.getElementById('settingsBtn').onclick = ()=> overlay.classList.add('open');
document.getElementById('closeModalBtn').onclick = ()=> overlay.classList.remove('open');

document.querySelectorAll('.tabBtn').forEach(btn=>{
  btn.onclick = ()=>{
    document.querySelectorAll('.tabBtn').forEach(b=>b.classList.remove('active'));
    document.querySelectorAll('.tabPane').forEach(p=>p.classList.remove('active'));
    btn.classList.add('active');
    document.querySelector(`.tabPane[data-pane="${btn.dataset.tab}"]`).classList.add('active');
  };
});

function collectSettingsFromForm(){
  state.apiKey = document.getElementById('apiKeyInput').value.trim();
  state.refreshMs = parseInt(document.getElementById('refreshSel').value,10);
  state.outputSize = clamp(parseInt(document.getElementById('outputSizeInput').value,10)||300,100,500);
  state.preset = document.getElementById('presetSel').value;
  state.tpMode = document.getElementById('tpModeSel').value;
  state.qualityStrength = clamp(parseFloat(document.getElementById('qualityStrengthInput').value)||0.4,0,1);
  state.useAsym = document.getElementById('asymToggle').checked;
  state.useCharFlip = document.getElementById('charFlipToggle').checked;
  state.useEffAtr = document.getElementById('effAtrToggle').checked;
  state.useBreakeven = document.getElementById('breakevenToggle').checked;
  state.useAdaptiveThreshold = document.getElementById('adaptiveThresholdToggle').checked;
  state.useCandleConfirm = document.getElementById('candleConfirmToggle').checked;
  state.useRequirePattern = document.getElementById('requirePatternToggle').checked;
  state.notif = document.getElementById('notifToggle').checked;
  state.sound = document.getElementById('soundToggle').checked;
  state.symbol = document.getElementById('symbolSel').value;
  state.interval = document.getElementById('tfSel').value;
  updatePriceCardTitle();
}

const LS_KEY = 'gusera_sats_api_key';
function persistApiKey(){
  try{
    if(state.apiKey) localStorage.setItem(LS_KEY, state.apiKey);
    else localStorage.removeItem(LS_KEY); // key pribadi dikosongkan -> proxy pakai pool server-nya sendiri
  }catch(e){ /* Safari private mode / storage disabled — ignore */ }
}
function restoreApiKey(){
  let saved = null;
  try{ saved = localStorage.getItem(LS_KEY); }catch(e){}
  const key = saved || '';
  document.getElementById('apiKeyInput').value = key;
  state.apiKey = key;
  updateApiKeyStatusUI();
}

/* Dulu menampilkan index/ukuran pool (auto-switch key ditangani di client). Sekarang
   rotasi key sepenuhnya server-side di proxy Worker (lihat worker/index.js) — client
   tidak lagi tahu maupun perlu tahu key mana yang sedang dipakai di server, jadi
   statusnya disederhanakan jadi "mode" saja: pakai key pribadi, atau pakai proxy. */
function updateApiKeyStatusUI(){
  const usingCustom = !!(state.apiKey && state.apiKey.trim());
  const label = usingCustom ? 'Pakai API key pribadi (langsung, tanpa pool server)' : 'Pakai proxy server (key aman, auto-switch di server)';
  const modalEl = document.getElementById('apiKeyPoolStatus');
  if(modalEl) modalEl.textContent = label;
  const profEl = document.getElementById('profApiKeyStatus');
  if(profEl) profEl.textContent = usingCustom ? 'Key pribadi' : 'Proxy server';
}

document.getElementById('saveStartBtn').onclick = async ()=>{
  collectSettingsFromForm();
  // Tidak lagi memblokir kalau apiKeyInput kosong — proxy server selalu tersedia sebagai
  // fallback (lihat worker/index.js), jadi key pribadi kini benar-benar opsional.
  persistApiKey();
  updateApiKeyStatusUI();
  setModalStatus('Pengaturan disimpan.', 'ok');
  overlay.classList.remove('open');
  prevSignalCount = 0;
  startLoop();
};

document.getElementById('csvLoadBtn').onclick = ()=>{
  const text = document.getElementById('csvInput').value;
  if(!text.trim()){ setModalStatus('Tempel data CSV dulu.', 'err'); return; }
  try{
    const { candles, skipped } = parseCsv(text);
    stopLoop();
    state.csvMode = true;
    collectSettingsFromForm();
    prevSignalCount = 0;
    processAndRender(candles);
    setConn('', 'Mode CSV');
    const skipMsg = skipped>0 ? ` (${skipped} baris rusak/tidak valid dilewati)` : '';
    setModalStatus('Data CSV dimuat: '+candles.length+' candle.'+skipMsg, skipped>0?'warn':'ok');
    overlay.classList.remove('open');
  }catch(e){ setModalStatus('Gagal parse CSV: '+e.message, 'err'); }
};

document.getElementById('startBtn').onclick = async ()=>{
  collectSettingsFromForm();
  // Tidak lagi memblokir kalau apiKeyInput kosong — proxy server selalu tersedia sebagai
  // fallback dengan auto-switch key di sisi server (lihat worker/index.js).
  if(state.notif && 'Notification' in window){
    try{ const p = await Notification.requestPermission(); state.notifPermission = p==='granted'; }catch(e){}
  }
  prevSignalCount = 0;
  startLoop();
};

document.getElementById('symbolSel').onchange = ()=>{ state.symbol = document.getElementById('symbolSel').value; updatePriceCardTitle(); if(state.timer) startLoop(); };
document.getElementById('tfSel').onchange = ()=>{ state.interval = document.getElementById('tfSel').value; if(state.timer) startLoop(); };

function updatePriceCardTitle(){
  const el = document.getElementById('priceCardTitle');
  if(el) el.textContent = 'Harga '+state.symbol;
}

let resizeT=null;
window.addEventListener('resize', ()=>{
  clearTimeout(resizeT);
  resizeT = setTimeout(()=>{
    if(getLastResult() && state.candles.length) drawChart(getLastResult(), state.candles);
  }, 120);
});
// iOS Safari fires orientationchange separately/earlier than resize in some versions
window.addEventListener('orientationchange', ()=>{
  setTimeout(()=>{ if(getLastResult() && state.candles.length) drawChart(getLastResult(), state.candles); }, 250);
});
function currentCfg(){
  const tfMinutes = tfToMinutes(state.interval);
  const pp = presetParams(state.preset, tfMinutes);
  const weights = computeTrendWeights();
  return { atrLen: pp.atrLen, baseMult: pp.baseMult, erLen: pp.erLen, rsiLen: pp.rsiLen, slMult: pp.slMult,
    tpMode: state.tpMode, qualityStrength: state.qualityStrength, useAsym: state.useAsym, useCharFlip: state.useCharFlip, useEffAtr: state.useEffAtr,
    useBreakeven: state.useBreakeven,
    useCandleConfirm: state.useCandleConfirm,
    requirePatternConfluence: state.useRequirePattern,
    structWeight: weights.structWeight, momWeight: weights.momWeight,
    patternWeight: weights.patternWeight,
    tqiEffWeight: weights.tqiEffWeight, tqiVolWeight: weights.tqiVolWeight };
}

/* ═══════════════════════════════════════════════════════════
   TOAST
   ═══════════════════════════════════════════════════════════ */
let toastT=null;
function toast(msg){
  const el = document.getElementById('toast');
  if(!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(()=> el.classList.remove('show'), 2600);
}

/* ═══════════════════════════════════════════════════════════
   DOWNLOAD RIWAYAT (CSV, maks 100 baris)
   ═══════════════════════════════════════════════════════════ */
function csvEscape(v){
  const s = String(v);
  return /[",\n]/.test(s) ? '"'+s.replace(/"/g,'""')+'"' : s;
}
function downloadHistoryCsv(){
  if(!getLastResult()){
    toast('Belum ada riwayat sinyal untuk diunduh.');
    return;
  }
  const { rows: rowsDesc } = historyRows(getLastResult());
  if(!rowsDesc.length){
    toast('Belum ada riwayat sinyal untuk diunduh.');
    return;
  }
  const rows = rowsDesc.slice().reverse(); // chronological, oldest→newest
  const header = ['Waktu','Simbol','Timeframe','Sisi','Kualitas','Harga','Skor','Purity','Pola','PatternScore','SL','TP1','TP1_Hit','TP2','TP2_Hit','TP3','TP3_Hit','Status','RealizedR'];
  const lines = [header.join(',')];
  rows.forEach(s=>{
    lines.push([
      s.time, state.symbol, state.interval, s.side, s.valid===false?'Lemah':'Valid', fmtPrice(s.price), s.score.toFixed(1), s.tqi.toFixed(2),
      s.pattern || '', s.patternScore!=null?s.patternScore.toFixed(1):'0',
      fmtPrice(s.sl), fmtPrice(s.tp1), s.hit[0]?'YES':'NO', fmtPrice(s.tp2), s.hit[1]?'YES':'NO',
      fmtPrice(s.tp3), s.hit[2]?'YES':'NO', s.status, s.realizedR!=null?s.realizedR.toFixed(2):''
    ].map(csvEscape).join(','));
  });
  const csv = '\uFEFF'+lines.join('\r\n'); // BOM so Excel/Numbers on iOS read it correctly
  const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date().toISOString().slice(0,19).replace(/[:T]/g,'-');
  a.href = url;
  a.download = `gusera-sats-riwayat_${state.symbol.replace('/','')}_${stamp}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(()=> URL.revokeObjectURL(url), 1000);
  toast('Riwayat diunduh ('+rows.length+' baris).');
}

/* ═══════════════════════════════════════════════════════════
   RESET
   ═══════════════════════════════════════════════════════════ */
function resetUI(){
  document.getElementById('priceNow').textContent = '—';
  document.getElementById('priceNow').className = 'priceNow';
  document.getElementById('priceSub').textContent = 'Klik Mulai untuk memuat data';
  const priceChangeEl = document.getElementById('priceChange');
  if(priceChangeEl){ priceChangeEl.textContent=''; priceChangeEl.className='price-change'; }
  const sparkCanvas = document.getElementById('sparkCanvas');
  if(sparkCanvas){ const c=sparkCanvas.getContext('2d'); c.clearRect(0,0,sparkCanvas.width,sparkCanvas.height); }
  const engineTag = document.getElementById('engineTag');
  if(engineTag){
    engineTag.textContent='—'; engineTag.className='trendTag';
    engineTag.style.background = '#1c2027'; engineTag.style.color = 'var(--text-dim)'; engineTag.style.border = '1px solid var(--border)';
  }
  const tqiDescEl = document.getElementById('tqiDesc');
  if(tqiDescEl){ tqiDescEl.textContent = 'Menunggu Analisis Trend…'; }
  const trendTag = document.getElementById('trendTag');
  trendTag.textContent = '—';
  trendTag.className = 'trendTag';
  trendTag.style.background = '#1c2027'; trendTag.style.color = 'var(--text-dim)'; trendTag.style.border = '1px solid var(--border)';
  trendTag.title = '';
  const slConfTag = document.getElementById('slConfTag');
  if(slConfTag){
    slConfTag.textContent='—'; slConfTag.className='trendTag';
    slConfTag.style.background = '#1c2027'; slConfTag.style.color = 'var(--text-dim)'; slConfTag.style.border = '1px solid var(--border)';
  }
  const slConfFill = document.getElementById('slConfFill');
  if(slConfFill){ slConfFill.style.width='0%'; slConfFill.className='factor-fill fill-green'; }
  const slVotesMsg = document.getElementById('slVotesMsg');
  if(slVotesMsg){ slVotesMsg.textContent=''; slVotesMsg.className='statusMsg'; }
  const tqiSlTag = document.getElementById('tqiSlTag');
  if(tqiSlTag){
    tqiSlTag.textContent='—'; tqiSlTag.className='trendTag';
    tqiSlTag.style.background = '#1c2027'; tqiSlTag.style.color = 'var(--text-dim)'; tqiSlTag.style.border = '1px solid var(--border)';
    tqiSlTag.title = '';
  }
  const tqiSlFill = document.getElementById('tqiSlFill');
  if(tqiSlFill){ tqiSlFill.style.width='0%'; tqiSlFill.className='factor-fill fill-green'; }
  const tqiSlMsg = document.getElementById('tqiSlMsg');
  if(tqiSlMsg){ tqiSlMsg.textContent=''; tqiSlMsg.className='statusMsg'; }
  setStatus('');
  document.getElementById('tqiVal').textContent = '—';
  document.getElementById('tqiRegime').textContent = '—';
  drawGauge(null);
  ['fEr','fVol','fStruct','fMom'].forEach(id=> document.getElementById(id).style.width='0%');
  ['fErV','fVolV','fStructV','fMomV'].forEach(id=> document.getElementById(id).textContent='—');
  document.getElementById('posStatus').textContent='FLAT';
  document.getElementById('posStatus').className='statusPill flat';
  ['tEntry','tSl','tTp1','tTp2','tTp3','tMode'].forEach(id=>{ document.getElementById(id).textContent='—'; });
  ['tTp1','tTp2','tTp3'].forEach(id=>{ document.getElementById(id).className='v'; });
  document.getElementById('tScore').textContent='—';
  document.getElementById('tScoreMax').textContent='';
  document.getElementById('tScoreFill').style.width='0%';
  document.getElementById('sWinRate').textContent='—'; document.getElementById('sWinRate').className='v';
  document.getElementById('sAvgR').textContent='—'; document.getElementById('sAvgR').className='v';
  document.getElementById('sCount').textContent='—';
  document.getElementById('sStreak').textContent='—';
  document.getElementById('sPersistedWR').textContent='—'; document.getElementById('sPersistedWR').className='v';
  document.getElementById('sThreshold').textContent='—';
  document.getElementById('sSkippedCount').textContent='—';
  document.getElementById('sSkippedAvgR').textContent='—'; document.getElementById('sSkippedAvgR').className='v';
  document.getElementById('logBody').innerHTML='';
  document.getElementById('logCount').textContent='0 sinyal';
  document.getElementById('logEmpty').style.display='block';
  document.getElementById('aiConfidence').textContent='—';
  document.getElementById('aiConfidenceFill').style.width='0%';
  document.getElementById('aiInsightHeadline').textContent='Menunggu Analisis AI…';
  document.getElementById('aiInsightText').textContent='';
  document.getElementById('aiBias').textContent='—';
  document.getElementById('aiRisk').textContent='—';
  document.getElementById('aiRegime').textContent='—';
  document.getElementById('aiBiasCaptionText').textContent='—';
  document.getElementById('aiRiskCaptionText').textContent='—';
  document.getElementById('aiRegimeCaptionText').textContent='—';
  document.getElementById('aiSummaryText').textContent='Menunggu cukup data untuk menghasilkan ringkasan insight.';
  const canvas = document.getElementById('chartCanvas');
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0,0,canvas.width,canvas.height);
  setConn('', 'Offline');
  updateProfilePanel(null);
}

function resetApp(){
  stopLoop();
  state.candles = [];
  state.csvMode = false;
  prevSignalCount = 0;
  setLastResult(null);
  resetUI();
  toast('Data & chart direset. Riwayat sinyal tersimpan tetap ada.');
}

document.getElementById('downloadHistoryBtn').onclick = downloadHistoryCsv;
document.getElementById('resetBtn').onclick = ()=>{
  // Reset ini hanya menghentikan live update & membersihkan tampilan chart/data candle
  // sesi saat ini. Riwayat sinyal (Riwayat Sinyal + statistik self-learning) TIDAK ikut
  // terhapus di sini — itu tersimpan permanen dan hanya hilang lewat tombol "Reset
  // Riwayat" khusus di tab Self-Learning, sesuai desain: data tidak boleh hilang cuma
  // karena data terbaru di-update / live di-restart.
  const ok = window.confirm('Reset akan menghentikan live update dan menghapus chart & data candle saat ini. Riwayat sinyal tersimpan serta pengaturan & API key tetap tersimpan. Lanjutkan?');
  if(ok) resetApp();
};

/* ═══════════════════════════════════════════════════════════
   iOS SAFARI: unlock AudioContext on first user gesture
   (autoplay/audio policies block sound until a tap happens)
   ═══════════════════════════════════════════════════════════ */
let audioUnlocked = false;
function unlockAudioOnce(){
  if(audioUnlocked) return;
  audioUnlocked = true;
  try{
    const ctxA = new (window.AudioContext||window.webkitAudioContext)();
    if(ctxA.state === 'suspended') ctxA.resume();
    ctxA.close();
  }catch(e){}
  window.removeEventListener('touchend', unlockAudioOnce);
  window.removeEventListener('click', unlockAudioOnce);
}
window.addEventListener('touchend', unlockAudioOnce, {once:true});
window.addEventListener('click', unlockAudioOnce, {once:true});

// init
drawGauge(null);
restoreApiKey();
loadPersistedHistory();
loadPersistedSkipped();
updatePriceCardTitle();

document.getElementById('resetHistoryBtn').onclick = ()=>{
  if(!confirm(`Hapus semua riwayat tersimpan (${persistedHistory.length} trade, + ${persistedSkipped.length} sinyal terlewat)? Ini akan mengembalikan ambang skor adaptif & bobot confluence ke baseline.`)) return;
  resetPersistedHistory();
  resetPersistedSkipped(); // ikut direset — keduanya sama-sama memori self-learning
  toast('Riwayat tersimpan dihapus.');
  // Ini SATU-SATUNYA aksi yang boleh menghapus Riwayat Sinyal (sesuai desain: riwayat
  // tidak boleh hilang karena data terbaru di-update, hanya lewat tombol reset ini).
  if(getLastResult()) renderAll(getLastResult(), state.candles);
  else { document.getElementById('logBody').innerHTML=''; document.getElementById('logCount').textContent='0 sinyal'; document.getElementById('logEmpty').style.display='block'; }
};

// Profil: tombol shortcut (memakai ulang fungsi & alur konfirmasi yang sama seperti di
// tab Riwayat/Alert, supaya tidak ada dua sumber kebenaran untuk aksi yang sama)
document.getElementById('profOpenSettingsBtn').onclick = ()=> overlay.classList.add('open');
document.getElementById('profExportBtn').onclick = downloadHistoryCsv;
document.getElementById('profResetHistoryBtn').onclick = ()=> document.getElementById('resetHistoryBtn').click();
document.getElementById('profExportExcelBtn').onclick = async ()=>{
  const btn = document.getElementById('profExportExcelBtn');
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Menyiapkan file…';
  try{
    const res = await exportFullHistoryExcel();
    if(!res.ok){
      toast(res.reason==='empty'
        ? 'Belum ada riwayat sinyal tersimpan untuk diunduh.'
        : 'Gagal memuat modul Excel — cek koneksi internet lalu coba lagi.');
    }else{
      toast('Excel diunduh ('+res.total+' sinyal tersimpan, semua pair & timeframe).');
    }
  }finally{
    btn.disabled = false;
    btn.textContent = original;
  }
};
updateProfilePanel(null);
/* ═══════════════════════════════════════════════════════════
   BOTTOM NAV
   ═══════════════════════════════════════════════════════════ */
(function initBottomNav(){
  function setView(view){
    document.querySelectorAll('.app-main > section[data-view]').forEach(sec=>{
      sec.classList.toggle('view-active', sec.dataset.view === view);
    });
    // Canvases (chart/gauge) can't size themselves correctly while their tab is
    // display:none, so force a full re-render right after the switch — this keeps
    // every tab in sync with the latest engine data instead of showing a stale/blank canvas.
    if(getLastResult() && state.candles.length){
      requestAnimationFrame(()=> renderAll(getLastResult(), state.candles));
    }
  }

  document.querySelectorAll('.nav-item').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const key = btn.dataset.nav;

      document.querySelectorAll('.nav-item').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      setView(key);
      window.scrollTo({top:0, behavior:'smooth'});
    });
  });

  setView('dashboard');
})();


