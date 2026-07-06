/* ═══════════════════════════════════════════════════════════
   EKSPOR EXCEL: Riwayat Sinyal Full & Statistik Performa
   ─────────────────────────────────────────────────────────
   Berbeda dari downloadHistoryCsv() di main.js (yang bersumber dari
   historyRows(getLastResult()) — terbatas pada jendela candle yang sedang
   di-fetch, hanya pair+timeframe aktif, dan butuh sesi berjalan) — ekspor ini
   membaca LANGSUNG dari persistedHistory/persistedSkipped (history-store.js),
   yaitu penyimpanan permanen di localStorage yang mencakup SEMUA pair &
   timeframe sepanjang waktu, dan TIDAK PERNAH ikut ter-reset oleh tombol
   "Mulai" ataupun "Reset" (chart/candle) — satu-satunya cara menghapusnya
   adalah tombol "Hapus Riwayat Tersimpan" yang eksplisit.

   File .xlsx dibangun di browser (client-side) memakai SheetJS, dimuat lewat
   dynamic import dari CDN hanya saat tombol diklik (tidak membebani load awal
   aplikasi untuk pengguna yang tidak pernah memakai fitur ini).
   ═══════════════════════════════════════════════════════════ */
import { persistedHistory, persistedSkipped } from './history-store.js';
import { weightedTradeStats } from './self-learning.js';

const SHEETJS_CDN = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/xlsx.mjs';
let _xlsxModPromise = null;
function loadXlsx(){
  if(!_xlsxModPromise) _xlsxModPromise = import(/* webpackIgnore: true */ SHEETJS_CDN);
  return _xlsxModPromise;
}

function n2(v){ return (v!=null && !Number.isNaN(v)) ? Number(v.toFixed(2)) : ''; }

/* Sheet 1: seluruh riwayat sinyal tersimpan (semua pair & timeframe, urut
   kronologis lama→baru), field lengkap — sumber sama dengan yang dipakai
   tabel Riwayat Sinyal & self-learning, jadi angkanya selalu konsisten. */
function buildHistorySheetData(){
  const header = ['Waktu','Simbol','Timeframe','Sisi','Kualitas','Harga','Skor','TQI',
    'Pola','PatternScore','SL','TP1','TP1_Hit','TP2','TP2_Hit','TP3','TP3_Hit','Status','RealizedR'];
  const rows = persistedHistory.map(s=>[
    s.time, s.symbol, s.interval, s.side, s.valid===false?'Lemah':'Valid',
    n2(s.price), n2(s.score), n2(s.tqi), s.pattern||'', n2(s.patternScore),
    n2(s.sl), n2(s.tp1), s.hit[0]?'YES':'NO', n2(s.tp2), s.hit[1]?'YES':'NO',
    n2(s.tp3), s.hit[2]?'YES':'NO', s.status, s.realizedR!=null?n2(s.realizedR):'',
  ]);
  return [header, ...rows];
}

/* Sheet 2: statistik performa, dirangkum per pair+timeframe (supaya XAU/USD M15
   tidak tercampur dengan EUR/USD H1) plus satu baris "SEMUA PAIR/TF" untuk
   gambaran total. WinRate/AvgR memakai fungsi recency-weighted yang sama
   dengan yang dipakai tampilan Profil, agar tidak ada dua sumber kebenaran. */
function buildStatsSheetData(){
  const groups = new Map();
  persistedHistory.forEach(h=>{
    const k = h.symbol+'|'+h.interval;
    if(!groups.has(k)) groups.set(k, []);
    groups.get(k).push(h);
  });
  const header = ['Simbol','Timeframe','Total Trade','Win Rate % (weighted)','Avg R (weighted)',
    'Rekor Menang Beruntun','Rekor Kalah Beruntun'];
  const rows = [];
  groups.forEach((list, key)=>{
    const [symbol, interval] = key.split('|');
    const w = weightedTradeStats(list, 15);
    let curWin=0, curLoss=0, maxWin=0, maxLoss=0;
    list.forEach(h=>{
      if(h.realizedR>0){ curWin++; curLoss=0; }
      else if(h.realizedR<0){ curLoss++; curWin=0; }
      else { curWin=0; curLoss=0; }
      if(curWin>maxWin) maxWin=curWin;
      if(curLoss>maxLoss) maxLoss=curLoss;
    });
    rows.push([symbol, interval, list.length, w.winRate!=null?n2(w.winRate):'', w.avgR!=null?n2(w.avgR):'', maxWin, maxLoss]);
  });
  rows.sort((a,b)=> (a[0]+a[1]).localeCompare(b[0]+b[1]));
  const overall = weightedTradeStats(persistedHistory, 15);
  rows.push(['SEMUA PAIR','SEMUA TIMEFRAME', persistedHistory.length,
    overall.winRate!=null?n2(overall.winRate):'', overall.avgR!=null?n2(overall.avgR):'', '', '']);
  return [header, ...rows];
}

/* Sheet 3: sinyal terlewat (skipped) — umpan balik ambang adaptif, ikut
   diekspor supaya laporan performa lengkap termasuk sinyal yang tidak
   dieksekusi. */
function buildSkippedSheetData(){
  const header = ['Waktu','Simbol','Timeframe','Sisi','Skor','HypotheticalR'];
  const rows = persistedSkipped.map(s=>[
    s.time, s.symbol, s.interval, s.side, n2(s.score), s.hypotheticalR!=null?n2(s.hypotheticalR):'',
  ]);
  return [header, ...rows];
}

/* Return value: { ok:true, total } | { ok:false, reason:'empty'|'load-failed' } */
export async function exportFullHistoryExcel(){
  if(!persistedHistory.length && !persistedSkipped.length){
    return { ok:false, reason:'empty' };
  }
  let XLSX;
  try{
    XLSX = await loadXlsx();
  }catch(e){
    return { ok:false, reason:'load-failed' };
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(buildHistorySheetData()), 'Riwayat Sinyal Full');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(buildStatsSheetData()), 'Statistik Performa');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(buildSkippedSheetData()), 'Sinyal Terlewat');

  const stamp = new Date().toISOString().slice(0,19).replace(/[:T]/g,'-');
  XLSX.writeFile(wb, `gusera-sats-riwayat-full-statistik_${stamp}.xlsx`);
  return { ok:true, total: persistedHistory.length };
}
