import { clamp, mapClamp } from './utils.js';
import { state } from './state.js';
// NOTE: circular import dengan history-store.js — lihat catatan di history-store.js.
import { persistedHistory, getPersistedStats, getSkippedStats } from './history-store.js';

/* ═══════════════════════════════════════════════════════════
   BOBOT CONFLUENCE YANG DIPELAJARI
   ─────────────────────────────────────────────────────────
   Efektivitas tiap confluence diukur dari riwayat tersimpan: dibandingkan
   avg-R trade yang confluence-nya "hadir/searah" vs yang "tidak" — kalau
   bedanya positif & sampelnya cukup (≥10 di kedua sisi), bobotnya dinaikkan
   (maks 1.5×); kalau bedanya negatif/tidak signifikan, bobotnya diturunkan
   (min 0.5×) supaya tidak terus mendominasi skor padahal terbukti tidak
   informatif untuk pair+timeframe ini. Di bawah 10 sampel per sisi, bobot
   tetap netral (1.0×, identik perilaku lama). */
export function weightForConfluence(rel, flagFn){
  const withFlag=[], withoutFlag=[];
  rel.forEach(h=>{
    const f = flagFn(h);
    if(f===true) withFlag.push(h);
    else if(f===false) withoutFlag.push(h);
    // f===null -> confluence tidak tersedia untuk trade ini, dikecualikan dari perbandingan
  });
  const MIN_N = 10;
  if(withFlag.length<MIN_N || withoutFlag.length<MIN_N){
    return { weight:1, sample:withFlag.length, learned:false };
  }
  const avgWith = withFlag.reduce((a,h)=>a+h.realizedR,0)/withFlag.length;
  const avgWithout = withoutFlag.reduce((a,h)=>a+h.realizedR,0)/withoutFlag.length;
  const lift = avgWith-avgWithout;
  const weight = clamp(1+lift*0.8, 0.5, 1.5);
  return { weight, sample:withFlag.length, avgWith, avgWithout, learned:true };
}
/* Versi kontinu dari weightForConfluence — dipakai untuk faktor yang nilainya berupa
   MAGNITUDE 0..1 (bukan flag hadir/tidak-hadir), seperti Efficiency Ratio & Volatilitas
   dari Trend Quality Index. Sampel dibagi jadi separuh-atas/separuh-bawah berdasarkan
   median nilai faktor tsb, lalu avg-R kedua kelompok dibandingkan dengan cara yang sama
   persis seperti weightForConfluence (lift, clamp 0.5×–1.5×, perlu ≥10 sampel per sisi). */
export function weightForMagnitude(rel, valueFn){
  const pts = rel.map(h=>({v:valueFn(h), r:h.realizedR})).filter(p=>p.v!=null && p.r!=null);
  const MIN_N = 10;
  if(pts.length < MIN_N*2) return { weight:1, sample:pts.length, learned:false };
  const sorted = [...pts].sort((a,b)=>a.v-b.v);
  const mid = Math.floor(sorted.length/2);
  const lower = sorted.slice(0,mid), upper = sorted.slice(mid);
  if(lower.length<MIN_N || upper.length<MIN_N) return { weight:1, sample:pts.length, learned:false };
  const avgWith = upper.reduce((a,p)=>a+p.r,0)/upper.length; // avg-R saat nilai faktor TINGGI
  const avgWithout = lower.reduce((a,p)=>a+p.r,0)/lower.length; // avg-R saat nilai faktor RENDAH
  const lift = avgWith-avgWithout;
  const weight = clamp(1+lift*0.8, 0.5, 1.5);
  return { weight, sample:pts.length, avgWith, avgWithout, learned:true };
}

/* ═══════════════════════════════════════════════════════════
   BOBOT MODEL STATUS TREND (self-learning, sumber data: riwayat trade tersimpan
   + faktor Trend Quality Index pada tiap entry)
   ─────────────────────────────────────────────────────────
   Menggantikan logic Status Trend yang lama (arah cuma ikut flip SuperTrend, tag
   confirmation cuma pass/fail berdasarkan rule tetap). Di sini SETIAP faktor —
   Struktur harga, Momentum, Pola Chart, plus 2 faktor TQI (Efficiency Ratio &
   Volatilitas) — diberi bobot yang dipelajari
   dari seberapa besar faktor itu terbukti berkorelasi dengan hasil (realized-R) trade
   tersimpan untuk pair+timeframe yang sedang aktif. Faktor yang terbukti prediktif
   dinaikkan bobotnya (maks 1.5×), yang terbukti tidak informatif diturunkan (min 0.5×).
   Di bawah 10 sampel per sisi, bobot tetap netral (1.0×) — lihat weightForConfluence /
   weightForMagnitude. */
export function computeTrendWeights(){
  const rel = persistedHistory.filter(h=>h.symbol===state.symbol && h.interval===state.interval);
  const struct_ = weightForConfluence(rel, h=>h.structAligned);
  const mom = weightForConfluence(rel, h=>h.momAligned);
  const pattern = weightForConfluence(rel, h=>h.pattern ? true : (h.pattern===null ? false : null));
  const tqiEff = weightForMagnitude(rel, h=>h.tqiErAtEntry);
  const tqiVolatility = weightForMagnitude(rel, h=>h.tqiVolAtEntry);
  return {
    structWeight:struct_.weight, momWeight:mom.weight, patternWeight:pattern.weight,
    struct:struct_, mom, pattern,
    tqiEffWeight:tqiEff.weight, tqiVolWeight:tqiVolatility.weight, tqiEff, tqiVol:tqiVolatility,
  };
}
// Nama lama dipertahankan sebagai alias supaya tidak ada pemanggil lain yang patah.
export const computeConfluenceWeights = computeTrendWeights;

/* Rata-rata & win-rate dengan peluruhan waktu (recency weighting) — trade yang
   lebih baru diberi bobot lebih besar daripada trade lama, supaya statistik
   tidak "diseret" oleh performa lama begitu rezim pasar sudah berubah (mis.
   dari trending ke choppy). Bobot meluruh separuh tiap `halfLife` trade ke
   belakang (default 15 trade) — trade paling baru (index terakhir) bobotnya 1. */
export function weightedTradeStats(list, halfLife){
  const hl = halfLife || 15;
  const decay = Math.pow(0.5, 1/hl);
  let wSum=0, wWinSum=0, wRSum=0;
  for(let k=0;k<list.length;k++){
    const distFromEnd = list.length-1-k;
    const w = Math.pow(decay, distFromEnd);
    wSum += w;
    if(list[k].realizedR>0) wWinSum += w;
    wRSum += w*list[k].realizedR;
  }
  return {
    winRate: wSum ? wWinSum/wSum*100 : null,
    avgR: wSum ? wRSum/wSum : null,
  };
}

/* ═══════════════════════════════════════════════════════════
   AMBANG SKOR ADAPTIF (self-learning feedback loop)
   ─────────────────────────────────────────────────────────
   Baseline netral: 45% dari skor maksimum. Begitu ada cukup sampel (≥15 trade
   tersimpan untuk pair+timeframe ini, guna hindari overfit ke sampel kecil),
   ambang disesuaikan mengikuti 3 hal, bukan cuma win rate mentah seperti versi
   sebelumnya:
   1) EXPECTANCY (avg-R, sudah recency-weighted), bukan win rate — supaya
      strategi trend-following WR-rendah/avg-R-tinggi yang sebenarnya sehat
      tidak keliru dianggap "buruk" dan malah diperketat.
   2) Dipetakan KONTINU (linear) dari expectancy ke persentase ambang, bukan
      tangga diskrit 40/50/58% yang menyebabkan lompatan ambang tiba-tiba
      padahal performanya nyaris sama di kedua sisi batas.
   3) CONFIDENCE bertahap dari 15→50 trade tersimpan (blend baseline→hasil
      hitung), bukan on/off keras di sampel ke-15 yang rawan overfit ke sampel
      kecil.
   Ditambah umpan balik dari sinyal yang TERLEWAT (skipped, lihat blok di atas):
   kalau sinyal yang ditolak dulu ternyata rata-rata profitable secara
   hipotetis, ambang dilonggarkan sedikit (maks ±3 poin persentase). */
export function computeAdaptiveThreshold(maxScoreRef){
  const BASE_PCT = 0.45;
  if(!state.useAdaptiveThreshold){
    return { pct:BASE_PCT, score:BASE_PCT*maxScoreRef, reason:'Ambang adaptif nonaktif (baseline tetap)' };
  }
  const stats = getPersistedStats(30);
  if(stats.windowCount < 15){
    return { pct:BASE_PCT, score:BASE_PCT*maxScoreRef, reason:`Baseline — sampel tersimpan baru ${stats.windowCount}/15 trade` };
  }
  const expectancy = stats.avgR; // avg-R yang sudah recency-weighted = expectancy per-trade dalam satuan R
  const rawPct = mapClamp(expectancy, -0.2, 0.5, 0.62, 0.32);

  const confidence = mapClamp(stats.windowCount, 15, 50, 0.25, 1.0);
  let pct = BASE_PCT*(1-confidence) + rawPct*confidence;

  const skipped = getSkippedStats(50);
  let skipNote = '';
  if(skipped.windowCount>=10 && skipped.avgR!=null){
    const skipNudge = clamp(mapClamp(skipped.avgR, -0.3,0.3, 0.03,-0.03), -0.03, 0.03);
    pct += skipNudge;
    skipNote = ` · sinyal terlewat (${skipped.windowCount}): ${skipped.avgR>=0?'+':''}${skipped.avgR.toFixed(2)}R`;
  }
  pct = clamp(pct, 0.25, 0.70);

  const reason = `Expectancy ${stats.windowCount} trade terakhir: ${expectancy>=0?'+':''}${expectancy.toFixed(2)}R (WR ${stats.winRate.toFixed(0)}%) · confidence ${(confidence*100).toFixed(0)}%${skipNote}`;
  return { pct, score:pct*maxScoreRef, reason };
}
