import { state } from './state.js';
import { CONST } from './constants.js';
// NOTE: circular import dengan self-learning.js — history-store butuh weightedTradeStats,
// self-learning butuh persistedHistory. Ini aman di ES modules selama binding yang
// diimpor hanya dipakai DI DALAM BODY fungsi (bukan saat modul dievaluasi), yang memang
// berlaku untuk semua pemakaian di bawah.
import { weightedTradeStats } from './self-learning.js';

/* ═══════════════════════════════════════════════════════════
   RIWAYAT TERSIMPAN (persisted trade history, localStorage)
   ─────────────────────────────────────────────────────────
   computeEngine() melakukan backtest ulang tiap cycle dari jendela candle
   yang sedang di-fetch (default 300 candle) — statistik "all-time" di sana
   sebenarnya terikat pada jendela itu dan otomatis hilang begitu candle lama
   ter-geser keluar. Untuk feedback loop (ambang skor adaptif) yang berguna,
   kita butuh riwayat yang benar-benar bertahan lintas sesi/reload dan lintas
   pergeseran jendela candle — makanya trade yang closed disalin ke sini. */
const LS_HISTORY_KEY = 'gusera_sats_history_v1';
const MAX_PERSISTED = 1000; // cap penyimpanan agar localStorage tidak membengkak
export let persistedHistory = [];

/* Migrasi lembut untuk baris riwayat dari versi lama (sebelum field tampilan lengkap
   ditambahkan) — field yang belum ada diisi default aman, supaya tabel Riwayat Sinyal
   & unduhan CSV tidak error/kosong pada baris lama yang sudah tersimpan di localStorage
   pengguna. */
export function normalizePersistedItem(h){
  return {
    key:h.key, symbol:h.symbol, interval:h.interval, time:h.time, side:h.side,
    score: h.score!=null ? h.score : 0, tqi: h.tqi!=null ? h.tqi : 0,
    realizedR: h.realizedR!=null ? h.realizedR : null, status: h.status || '—',
    price: h.price!=null ? h.price : NaN, sl: h.sl!=null ? h.sl : NaN,
    tp1: h.tp1!=null ? h.tp1 : NaN, tp2: h.tp2!=null ? h.tp2 : NaN, tp3: h.tp3!=null ? h.tp3 : NaN,
    hit: Array.isArray(h.hit) ? h.hit : [false,false,false],
    pattern: h.pattern || null, patternScore: h.patternScore!=null ? h.patternScore : 0,
    // Baris lama (sebelum field ini ada) otomatis jadi null — dikecualikan dari
    // pembelajaran bobot sampai ada trade baru yang membawa field ini (lihat
    // weightForConfluence: f===null dikecualikan, bukan dihitung sebagai "tidak searah").
    structAligned: h.structAligned!=null ? h.structAligned : null,
    momAligned: h.momAligned!=null ? h.momAligned : null,
    tqiErAtEntry: h.tqiErAtEntry!=null ? h.tqiErAtEntry : null,
    tqiVolAtEntry: h.tqiVolAtEntry!=null ? h.tqiVolAtEntry : null,
    valid: h.valid!=null ? h.valid : true,
  };
}

export function loadPersistedHistory(){
  try{
    const raw = localStorage.getItem(LS_HISTORY_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    persistedHistory = Array.isArray(parsed) ? parsed.map(normalizePersistedItem) : [];
  }catch(e){ persistedHistory = []; }
}

export function savePersistedHistory(){
  try{
    if(persistedHistory.length>MAX_PERSISTED) persistedHistory = persistedHistory.slice(-MAX_PERSISTED);
    localStorage.setItem(LS_HISTORY_KEY, JSON.stringify(persistedHistory));
  }catch(e){ /* Safari private mode / storage penuh — abaikan, aplikasi tetap jalan */ }
}

export function resetPersistedHistory(){
  persistedHistory = [];
  try{ localStorage.removeItem(LS_HISTORY_KEY); }catch(e){}
}

/* Salin sinyal yang sudah closed (SL/TP3/TIMEOUT/BE) dari hasil computeEngine ke
   penyimpanan permanen, dedupe berdasarkan symbol+interval+waktu+sisi supaya cycle
   berikutnya (yang meng-backtest ulang jendela candle yang sama) tidak menduplikasi. */
export function syncPersistedHistory(signals){
  const closed = signals.filter(s=>s.status!=='OPEN' && s.realizedR!=null);
  if(!closed.length) return;
  const existingKeys = new Set(persistedHistory.map(h=>h.key));
  let added = false;
  closed.forEach(s=>{
    const key = `${state.symbol}|${state.interval}|${s.time}|${s.side}`;
    if(existingKeys.has(key)) return;
    existingKeys.add(key);
    persistedHistory.push({
      key, symbol:state.symbol, interval:state.interval, time:s.time, side:s.side,
      score:s.score, tqi:s.tqi, realizedR:s.realizedR, status:s.status,
      // Field tampilan lengkap (harga/SL/TP/pola/dll) ikut disimpan permanen supaya
      // tabel Riwayat Sinyal & unduhan CSV bisa 100% bersumber dari sini — tidak lagi
      // dari hasil backtest jendela candle yang sedang aktif (yang otomatis menyusut
      // begitu candle lama ter-geser keluar tiap kali data terbaru di-fetch).
      price:s.price, sl:s.sl, tp1:s.tp1, tp2:s.tp2, tp3:s.tp3, hit:[...s.hit],
      pattern:s.pattern, patternScore:s.patternScore, valid: s.valid!==false,
      structAligned: s.structAligned!=null ? s.structAligned : null,
      momAligned: s.momAligned!=null ? s.momAligned : null,
      tqiErAtEntry: s.tqiErAtEntry!=null ? s.tqiErAtEntry : null,
      tqiVolAtEntry: s.tqiVolAtEntry!=null ? s.tqiVolAtEntry : null,
    });
    added = true;
  });
  if(added) savePersistedHistory();
}

/* Statistik dari riwayat tersimpan, dibatasi ke pair+timeframe yang sedang aktif
   (win rate XAU/USD M15 tidak relevan dicampur dengan EUR/USD H1). winRate/avgR
   di sini memakai recency weighting (lihat weightedTradeStats) — trade terbaru
   lebih berpengaruh daripada trade lama, supaya statistik & ambang adaptif lebih
   cepat menyesuaikan begitu rezim pasar berubah. */
export function getPersistedStats(windowN){
  const N = windowN || CONST.MAX_HISTORY_SIGS;
  const rel = persistedHistory.filter(h=>h.symbol===state.symbol && h.interval===state.interval);
  const windowed = rel.slice(-N);
  const w = weightedTradeStats(windowed, 15);
  return {
    total: rel.length,
    windowCount: windowed.length,
    winRate: w.winRate,
    avgR: w.avgR,
  };
}

/* ═══════════════════════════════════════════════════════════
   RIWAYAT SINYAL TERLEWAT (skipped signals, localStorage)
   ─────────────────────────────────────────────────────────
   Sinyal yang trend-flip-nya valid & lolos filter EMA, tapi skornya di bawah
   ambang self-learning, dulunya langsung dibuang tanpa pernah dicek "seandainya
   tetap dieksekusi, hasilnya menang atau kalah?". Sekarang tiap sinyal yang
   terlewat disimulasikan secara sederhana (satu target: SL vs TP1 saja, bukan
   3-leg penuh seperti trade sungguhan — lihat simulateHypotheticalOutcome() di
   computeEngine) dan hasilnya (hypotheticalR) disimpan permanen di sini kalau
   sudah resolve dalam jendela candle yang sama. Data ini dipakai sebagai umpan
   balik: kalau sinyal yang ditolak ternyata rata-rata profitable, berarti
   ambang kelewat ketat (lihat computeAdaptiveThreshold). */
const LS_SKIPPED_KEY = 'gusera_sats_skipped_v1';
const MAX_PERSISTED_SKIPPED = 500;
export let persistedSkipped = [];

export function normalizeSkippedItem(h){
  return {
    key:h.key, symbol:h.symbol, interval:h.interval, time:h.time, side:h.side,
    score: h.score!=null ? h.score : 0,
    hypotheticalR: h.hypotheticalR!=null ? h.hypotheticalR : null,
  };
}
export function loadPersistedSkipped(){
  try{
    const raw = localStorage.getItem(LS_SKIPPED_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    persistedSkipped = Array.isArray(parsed) ? parsed.map(normalizeSkippedItem) : [];
  }catch(e){ persistedSkipped = []; }
}
export function savePersistedSkipped(){
  try{
    if(persistedSkipped.length>MAX_PERSISTED_SKIPPED) persistedSkipped = persistedSkipped.slice(-MAX_PERSISTED_SKIPPED);
    localStorage.setItem(LS_SKIPPED_KEY, JSON.stringify(persistedSkipped));
  }catch(e){ /* Safari private mode / storage penuh — abaikan */ }
}
export function resetPersistedSkipped(){
  persistedSkipped = [];
  try{ localStorage.removeItem(LS_SKIPPED_KEY); }catch(e){}
}
/* Hanya simpan yang sudah RESOLVE (hypotheticalR!=null) — sinyal terlewat yang
   masih "berjalan" (belum sempat kena SL/TP1 di sisa candle jendela saat ini)
   tidak disimpan dulu, supaya tidak dihitung sebagai 0/netral yang keliru. */
export function syncPersistedSkipped(skippedSignals){
  const resolved = skippedSignals.filter(s=>s.hypotheticalR!=null);
  if(!resolved.length) return;
  const existingKeys = new Set(persistedSkipped.map(h=>h.key));
  let added = false;
  resolved.forEach(s=>{
    const key = `${state.symbol}|${state.interval}|${s.time}|${s.side}`;
    if(existingKeys.has(key)) return;
    existingKeys.add(key);
    persistedSkipped.push({ key, symbol:state.symbol, interval:state.interval, time:s.time, side:s.side,
      score:s.score, hypotheticalR:s.hypotheticalR });
    added = true;
  });
  if(added) savePersistedSkipped();
}
export function getSkippedStats(windowN){
  const N = windowN || 50;
  const rel = persistedSkipped.filter(h=>h.symbol===state.symbol && h.interval===state.interval);
  const windowed = rel.slice(-N);
  const wins = windowed.filter(h=>h.hypotheticalR>0).length;
  return {
    total: rel.length,
    windowCount: windowed.length,
    winRate: windowed.length ? wins/windowed.length*100 : null,
    avgR: windowed.length ? windowed.reduce((a,h)=>a+h.hypotheticalR,0)/windowed.length : null,
  };
}
