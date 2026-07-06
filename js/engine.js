import { CONST } from './constants.js';
import { clamp, safeDiv, mapClamp, mapClampInv } from './utils.js';
import { trueRangeArr, rma, smaArr, efficiencyRatioArr, rsiArr, rollingHighest, rollingLowest, pivotHighArr, pivotLowArr } from './indicators.js';
import { computeAdaptiveThreshold } from './self-learning.js';
import { detectCandlePattern, detectStructurePattern } from './patterns.js';

/* ── full engine: recompute everything from candle history ─── */
export function computeEngine(candles, cfg){
  const n = candles.length;
  const closes = candles.map(c=>c.close), highs=candles.map(c=>c.high), lows=candles.map(c=>c.low);
  const hasVolume = candles.some(c=>c.volume>0);
  const momLen=10, structLen=20; // shared lookback lengths, used consistently below

  // ── ambang skor self-learning (dihitung SEBELUM loop bar) ──────────────────
  // maxScoreRef hanya bergantung pada hasVolume (sudah diketahui di titik ini),
  // sehingga entryThreshold bisa dihitung di awal dan dipakai untuk MENGGERBANG
  // entry di loop bar bawah — bukan cuma label "Valid/Lemah" kosmetik setelah
  // trade sudah dibuka seperti sebelumnya. Ini yang membuat entry benar-benar
  // "mengikuti perintah" self-learning.
  const maxScoreRef = hasVolume ? CONST.MAX_SCORE_WITH_VOLUME : CONST.MAX_SCORE_NO_VOLUME;
  const entryThreshold = computeAdaptiveThreshold(maxScoreRef);

  const tr = trueRangeArr(candles);
  const rawAtr = rma(tr, cfg.atrLen);
  const atrBaseline = smaArr(rawAtr, 100);
  const volRatio = rawAtr.map((v,i)=> safeDiv(v, atrBaseline[i]||v, 1));
  const er = efficiencyRatioArr(closes, cfg.erLen);
  const effAtr = rawAtr.map((v,i)=> cfg.useEffAtr ? v*(0.5+0.5*er[i]) : v);

  const structHi = rollingHighest(highs, structLen), structLo = rollingLowest(lows, structLen);
  const rsiVals = rsiArr(closes, cfg.rsiLen);

  // volume z (fallback to volRatio proxy when no real volume)
  const volZ = new Array(n).fill(0);
  if(hasVolume){
    const vols = candles.map(c=>c.volume);
    for(let i=0;i<n;i++){
      const s=Math.max(0,i-structLen+1); const w=vols.slice(s,i+1);
      const mean=w.reduce((a,b)=>a+b,0)/w.length;
      const sd=Math.sqrt(w.reduce((a,b)=>a+(b-mean)*(b-mean),0)/w.length)||1;
      volZ[i]=(vols[i]-mean)/sd;
    }
  }

  const tqi=new Array(n), tqiEr=new Array(n), tqiVol=new Array(n), tqiStruct=new Array(n), tqiMom=new Array(n);
  // ── Arah (bukan cuma magnitude) dari tiap faktor TQI — dipakai sebagai "vote" arah
  // oleh model Status Trend self-learning di bawah (lihat computeTrendWeights &
  // renderAll). tqiStruct/tqiMom sendiri cuma menyimpan MAGNITUDE (0..1, seberapa
  // kuat), jadi arahnya (bullish/bearish) perlu disimpan terpisah di sini.
  const structDirArr=new Array(n), momDirArr=new Array(n);
  for(let i=0;i<n;i++){
    tqiEr[i]=clamp(er[i],0,1);
    tqiVol[i]= hasVolume ? mapClamp(volZ[i],-1,2,0,1) : mapClamp(volRatio[i],0.6,1.8,0,1);
    const range = structHi[i]-structLo[i];
    const pos = safeDiv(closes[i]-structLo[i], range, 0.5);
    tqiStruct[i]=clamp(Math.abs(pos-0.5)*2,0,1);
    structDirArr[i] = range>0 ? (pos>0.5 ? 1 : (pos<0.5 ? -1 : 0)) : null;
    if(i<momLen){ tqiMom[i]=0.5; momDirArr[i]=null; }
    else{
      const windowChange = closes[i]-closes[i-momLen];
      let aligned=0;
      for(let k=0;k<momLen;k++){
        const barChange = closes[i-k]-closes[i-k-1];
        if((windowChange>0&&barChange>0)||(windowChange<0&&barChange<0)) aligned++;
      }
      tqiMom[i]=aligned/momLen;
      momDirArr[i] = windowChange>0 ? 1 : (windowChange<0 ? -1 : 0);
    }
    const wSum = 0.35+0.20+0.25+0.20;
    tqi[i]=clamp((tqiEr[i]*0.35+tqiVol[i]*0.20+tqiStruct[i]*0.25+tqiMom[i]*0.20)/wSum,0,1);
  }

  // adaptive multipliers
  const activeMultSm=new Array(n), passiveMultSm=new Array(n);
  const baseMult=cfg.baseMult, adaptStrength=0.5, qualityStrength=cfg.qualityStrength, qualityCurve=1.5, asymStrength=0.5;
  for(let i=0;i<n;i++){
    const legacyAdaptFactor = 1 + adaptStrength*(0.5-er[i]);
    const qualityDeviation = Math.pow(1-tqi[i], qualityCurve);
    const tqiMult = 1-qualityStrength + qualityStrength*(0.6+0.8*qualityDeviation);
    const symMult = baseMult*legacyAdaptFactor*tqiMult;
    let activeRaw=symMult, passiveRaw=symMult;
    if(cfg.useAsym){
      activeRaw = symMult*(1-asymStrength*tqi[i]*0.3);
      passiveRaw = symMult*(1+asymStrength*tqi[i]*0.4);
    }
    activeMultSm[i] = i===0 ? activeRaw : activeMultSm[i-1]*(1-CONST.MULT_SMOOTH_ALPHA)+activeRaw*CONST.MULT_SMOOTH_ALPHA;
    passiveMultSm[i] = i===0 ? passiveRaw : passiveMultSm[i-1]*(1-CONST.MULT_SMOOTH_ALPHA)+passiveRaw*CONST.MULT_SMOOTH_ALPHA;
  }

  // adaptive supertrend
  const lowerBand=new Array(n), upperBand=new Array(n), stTrend=new Array(n), stLine=new Array(n);
  let trendStartBar=0;
  for(let i=0;i<n;i++){
    const prevTrend = i===0 ? 1 : stTrend[i-1];
    const lowerMult = prevTrend===1?activeMultSm[i]:passiveMultSm[i];
    const upperMult = prevTrend===1?passiveMultSm[i]:activeMultSm[i];
    const lowerRaw = closes[i]-lowerMult*effAtr[i];
    const upperRaw = closes[i]+upperMult*effAtr[i];
    lowerBand[i] = i===0 ? lowerRaw : (closes[i-1]>lowerBand[i-1] ? Math.max(lowerRaw,lowerBand[i-1]) : lowerRaw);
    upperBand[i] = i===0 ? upperRaw : (closes[i-1]<upperBand[i-1] ? Math.min(upperRaw,upperBand[i-1]) : upperRaw);

    const priceFlipUp = i>0 && prevTrend===-1 && closes[i]>upperBand[i-1];
    const priceFlipDown = i>0 && prevTrend===1 && closes[i]<lowerBand[i-1];
    const trendAge = i-trendStartBar;
    const prevTqi = i===0?0.5:tqi[i-1];
    // Character-flip: trend-quality collapse (prevTqi high -> tqi low) after the trend has
    // matured (trendAge>=5). In the original Pine script this was additionally gated by
    // close</>source, which is always false when source==close (as it is in this port) —
    // that made the toggle a no-op. Here we implement the intended behaviour directly:
    // a genuine quality-collapse reverses the trend even before price breaks the ST band.
    const charFlipCond = cfg.useCharFlip && prevTqi>0.55 && tqi[i]<0.25 && trendAge>=5;
    const charFlipDown = charFlipCond && prevTrend===1;
    const charFlipUp = charFlipCond && prevTrend===-1;
    const finalUp = priceFlipUp||charFlipUp, finalDown = priceFlipDown||charFlipDown;
    stTrend[i] = i===0 ? 1 : (finalUp?1:(finalDown?-1:prevTrend));
    if(i>0 && stTrend[i]!==prevTrend) trendStartBar=i;
    stLine[i] = stTrend[i]===1?lowerBand[i]:upperBand[i];
  }

  // dynamic TP scale + score breakdown + trades
  // Risk:Reward diset fixed 1:2 — ketiga leg TP1/TP2/TP3 menyasar level R yang sama persis
  // (2R) sehingga rasio risk:reward keseluruhan trade tetap 1:2, bukan skala bertingkat 1R/2R/3R.
  const fixedTp=[2.0,2.0,2.0];
  const pivHigh = pivotHighArr(highs,3), pivLow = pivotLowArr(lows,3);
  let lastPivH=null, lastPivL=null;
  const pivHighHist=[], pivLowHist=[]; // {idx,val} — riwayat beberapa pivot terakhir, dipakai untuk pola double top/bottom & HL/LH

  function scoreBreakdown(i,isBuy){
    const dirMove = isBuy ? closes[i-3]-closes[i] : closes[i]-closes[i-3];
    const momScore = mapClamp(safeDiv(dirMove,effAtr[i],0), 0.3,2.0, 0,17);
    const erScore = mapClamp(er[i],0.15,0.7,0,17);
    const vScore = hasVolume ? mapClamp(volZ[i],0,3,0,17) : CONST.BYPASS_SCORE;
    const lb = Math.max(0,i-structLen+1);
    const rsiWindow = rsiVals.slice(lb,i+1);
    const rsiDepth = isBuy ? Math.max(0, 30-Math.min(...rsiWindow)) : Math.max(0, Math.max(...rsiWindow)-70);
    const rsiScore = mapClamp(rsiDepth,0,15,0,17);
    // BUG FIX: when no pivot has been found yet (very first bars of a fetch window, before the
    // pivot lookback/lookforward has had a chance to confirm one), pivDist used to default to 0
    // ("distance to nearest pivot is zero"), which mapClampInv then read as the BEST possible
    // structure score (16/16) — i.e. missing data was silently treated as the strongest possible
    // evidence instead of "unknown". Now those bars fall back to a neutral mid-range score.
    const havePivot = (isBuy && lastPivL!=null) || (!isBuy && lastPivH!=null);
    const pivDist = isBuy && lastPivL!=null ? Math.abs(closes[i]-lastPivL) : (!isBuy && lastPivH!=null ? Math.abs(lastPivH-closes[i]) : null);
    const structScore = havePivot ? mapClampInv(safeDiv(pivDist,effAtr[i],0),0,1.5,16,6) : 11; // neutral (~mid of 6-16 range)
    const breakDepth = isBuy ? Math.max(0, upperBand[i-1]-closes[i-1]) : Math.max(0, closes[i-1]-lowerBand[i-1]);
    const breakScore = mapClamp(safeDiv(breakDepth,effAtr[i],0),0,1.0,0,16);
    // Chart pattern confluence: candle pattern di bar sinyal (atau 1 bar sebelumnya, untuk
    // menangkap reversal candle yang mendahului flip) + pola struktur dari riwayat pivot.
    // Ini menambah bukti independen di luar indikator numerik (ER/RSI/momentum) di atas,
    // sehingga sinyal yang punya pola pendukung mendapat skor lebih tinggi/lebih akurat.
    const patternNames = [];
    const candlePat = detectCandlePattern(candles,i,isBuy) || detectCandlePattern(candles,i-1,isBuy);
    const structPat = detectStructurePattern({ pivHighHist, pivLowHist, effAtrAtI: effAtr[i], i, isBuy, structLen });
    if(candlePat) patternNames.push(candlePat);
    if(structPat) patternNames.push(structPat);
    const patternScore = clamp(patternNames.reduce((sum,name)=> sum+(CONST.PATTERN_WEIGHTS[name]||0), 0), 0, CONST.MAX_PATTERN_SCORE);

    return {momScore,erScore,vScore,rsiScore,structScore,breakScore,patternScore,patternNames,
      total: momScore+erScore+vScore+rsiScore+structScore+breakScore+patternScore};
  }

  /* Simulasi SEDERHANA satu-target (SL vs TP1 saja, bukan 3-leg penuh seperti trade
     sungguhan) untuk sinyal yang TIDAK dieksekusi karena gagal lolos ambang — dipakai
     murni sebagai umpan balik ke self-learning (lihat computeAdaptiveThreshold &
     syncPersistedSkipped): kalau sinyal yang ditolak ternyata rata-rata profitable,
     berarti ambang kelewat ketat. Mengembalikan +1/-1 kalau resolve di dalam jendela
     candle yang sedang di-fetch, atau null kalau belum resolve (belum kena salah satu
     dalam sisa data yang ada) — hasil null TIDAK disimpan permanen (lihat syncPersistedSkipped). */
  function simulateHypotheticalOutcome(i, isBuy, sl, tp1){
    for(let k=i+1;k<n;k++){
      if(isBuy){
        if(lows[k]<=sl) return -1;
        if(highs[k]>=tp1) return 1;
      } else {
        if(highs[k]>=sl) return -1;
        if(lows[k]<=tp1) return 1;
      }
    }
    return null;
  }

  const signals=[];
  // Sinyal yang trend-flip-nya valid & lolos filter EMA, TAPI skornya di bawah
  // entryThreshold self-learning — dicatat terpisah murni untuk transparansi
  // ("terdeteksi tapi tidak dieksekusi"), tidak ikut siklus hidup trade (SL/TP/
  // realizedR) dan tidak memengaruhi statistik win-rate / riwayat tersimpan.
  // hypotheticalR (simulasi sederhana, lihat simulateHypotheticalOutcome) DIPAKAI
  // sebagai umpan balik ke ambang adaptif lewat persistedSkipped — lihat processAndRender.
  const skippedSignals=[];
  let tradeDir=0, tradeEntry=NaN, tradeSl=NaN, tradeTp=[NaN,NaN,NaN], tradeTpR=[NaN,NaN,NaN], hit=[false,false,false], entryBar=0, entryIdx=null;
  const rBuffer=[];
  // ── Validasi konfirmasi candlestick sebelum entry ───────────────────────
  // Syarat: begitu Trend Quality Index (flip trend + skor lolos ambang) memberi sinyal,
  // entry TIDAK langsung dieksekusi di bar sinyal itu sendiri. Engine menunggu SATU bar
  // berikutnya: kalau bar itu ditutup sebagai candle bullish (close>open) untuk sinyal BUY,
  // atau candle bearish (close<open) untuk sinyal SELL, barulah posisi dibuka (di harga close
  // bar konfirmasi tsb). Kalau bar berikutnya tidak sesuai arah (bearish/doji untuk BUY,
  // bullish/doji untuk SELL), sinyal itu dianggap tidak valid dan tidak diambil sama sekali.
  let pendingSignal = null; // {dir:1|-1, flipIdx, sb, tSl}
  function isBullishCandle(i){ return candles[i].close > candles[i].open; }
  function isBearishCandle(i){ return candles[i].close < candles[i].open; }
  let curWinStreak=0, curLossStreak=0, maxWinStreak=0, maxLossStreak=0, allCount=0, allSumR=0;

  for(let i=0;i<n;i++){
    if(pivHigh[i]!=null){ lastPivH=pivHigh[i]; pivHighHist.push({idx:i,val:pivHigh[i]}); }
    if(pivLow[i]!=null){ lastPivL=pivLow[i]; pivLowHist.push({idx:i,val:pivLow[i]}); }

    const flipUp = i>0 && stTrend[i]===1 && stTrend[i-1]===-1;
    const flipDown = i>0 && stTrend[i]===-1 && stTrend[i-1]===1;

    // dynamic TP scale
    let dynScale=1;
    if(cfg.tpMode==='Dynamic'){
      const scaleFromTqi = mapClamp(tqi[i],0,1,0.5,2.0);
      const scaleFromVol = mapClamp(volRatio[i],0.5,1.8,0.5,2.0);
      dynScale = clamp(0.6*scaleFromTqi+0.4*scaleFromVol, 0.5, 2.0);
    }
    const floor1=0.5;
    const floor2 = floor1*(fixedTp[1]/Math.max(fixedTp[0],0.01));
    const floor3 = floor1*(fixedTp[2]/Math.max(fixedTp[0],0.01));
    let eff = fixedTp.map((r,idx)=> cfg.tpMode==='Dynamic' ? clamp(r*dynScale, [floor1,floor2,floor3][idx], 8.0) : r);
    const sorted = [...eff].sort((a,b)=>a-b);
    const liveTpR = sorted;

    // Menutup trade yang sedang OPEN dan mencatat realized-R-nya. Dipakai baik oleh
    // deteksi SL/TP/timeout normal (di bawah) MAUPUN saat trend flip memaksa reversal —
    // sebelum perbaikan ini, flip hanya menimpa tradeDir/entryIdx ke trade baru tanpa
    // pernah menutup sinyal lama, sehingga sinyal lama itu nyangkut selamanya di status
    // 'OPEN' walau harga sudah lama menembus SL/TP-nya. Itulah sebabnya riwayat sinyal
    // sebelumnya (hampir) selalu tampil OPEN dan tidak pernah closing.
    function closeCurrentTrade(exitIdx, statusLabel){
      const sig = signals[entryIdx];
      const useBe = cfg.useBreakeven && hit[0];
      const beExit = statusLabel==='SL' && useBe;
      const missedLegValue = beExit ? 0 : -1;
      let legs=[hit[0]?tradeTpR[0]:missedLegValue, hit[1]?tradeTpR[1]:missedLegValue, hit[2]?tradeTpR[2]:missedLegValue];
      if(statusLabel==='TIMEOUT' || statusLabel==='FLIP'){
        // Belum kena SL/TP3 penuh — pakai R belum-terealisasi di harga saat ini untuk leg yang belum hit.
        const unreal = tradeDir===1 ? (closes[exitIdx]-tradeEntry)/(tradeEntry-tradeSl) : (tradeEntry-closes[exitIdx])/(tradeSl-tradeEntry);
        legs = legs.map((v,idx)=> hit[idx] ? v : clamp(unreal,-1,tradeTpR[2]));
      }
      const realizedR = clamp(legs.reduce((a,b)=>a+b,0)/3, -1, tradeTpR[2]);
      sig.realizedR = realizedR;
      sig.status = beExit ? 'BE' : statusLabel;
      rBuffer.push(realizedR);
      if(rBuffer.length>CONST.MAX_HISTORY_SIGS) rBuffer.shift();
      allCount++; allSumR+=realizedR; // all-time totals, kept separate from the 100-trade window
      if(realizedR>0){ curWinStreak++; curLossStreak=0; maxWinStreak=Math.max(maxWinStreak,curWinStreak); }
      else { curLossStreak++; curWinStreak=0; maxLossStreak=Math.max(maxLossStreak,curLossStreak); }
      tradeDir=0; entryIdx=null;
    }

    // Membuka posisi baru. entryIdxBar = bar tempat entry benar-benar dieksekusi (harga
    // closes[entryIdxBar] dipakai sebagai harga entry — kalau konfirmasi candle aktif, ini
    // adalah bar KONFIRMASI, satu bar setelah bar flip sinyal sigBar). SL yang dipakai tetap
    // SL yang dihitung dari struktur pivot/ATR pada bar sinyal asal (tSl), supaya level stop
    // tidak "mengikuti" pergerakan harga selama menunggu konfirmasi.
    function openTrade(dir, entryIdxBar, sb, tSl, sigBar){
      const entryPrice = closes[entryIdxBar];
      const risk = dir===1 ? entryPrice-tSl : tSl-entryPrice;
      tradeDir=dir; tradeEntry=entryPrice; tradeSl=tSl;
      tradeTp = dir===1
        ? [entryPrice+risk*liveTpR[0], entryPrice+risk*liveTpR[1], entryPrice+risk*liveTpR[2]]
        : [entryPrice-risk*liveTpR[0], entryPrice-risk*liveTpR[1], entryPrice-risk*liveTpR[2]];
      tradeTpR=[...liveTpR]; hit=[false,false,false]; entryBar=entryIdxBar; entryIdx=signals.length;
      signals.push({i:entryIdxBar, time:candles[entryIdxBar].time, side:dir===1?'BUY':'SELL', price:entryPrice, score:sb.total, tqi:tqi[sigBar],
        sl:tSl, tp1:tradeTp[0], tp2:tradeTp[1], tp3:tradeTp[2], tpR:[...tradeTpR], mode:cfg.tpMode,
        pattern: sb.patternNames.join(' + ') || null, patternScore: sb.patternScore,
        // ── Faktor tambahan untuk model Status Trend self-learning (lihat computeTrendWeights
        // & renderAll): true/false kalau faktornya searah/berlawanan dengan sisi trade ini,
        // null kalau faktornya tidak tersedia di bar ini.
        structAligned: structDirArr[sigBar]==null ? null : structDirArr[sigBar]===dir,
        momAligned: momDirArr[sigBar]==null ? null : momDirArr[sigBar]===dir,
        tqiErAtEntry: tqiEr[sigBar], tqiVolAtEntry: tqiVol[sigBar],
        status:'OPEN', hit:[false,false,false], realizedR:null, valid:true,
        confirmedAt: entryIdxBar!==sigBar ? candles[entryIdxBar].time : null});
    }

    // ── Resolusi sinyal yang masih menunggu konfirmasi candlestick dari bar sebelumnya ──
    // Syarat entry: sinyal BUY baru dieksekusi kalau bar TEPAT setelah bar sinyal ditutup
    // sebagai candle bullish (close>open); sinyal SELL baru dieksekusi kalau bar berikutnya
    // ditutup sebagai candle bearish (close<open). Kalau tidak sesuai (termasuk doji), sinyal
    // dibatalkan sepenuhnya — tidak menunggu bar-bar selanjutnya.
    if(pendingSignal && i===pendingSignal.flipIdx+1){
      const dir = pendingSignal.dir;
      const confirmed = dir===1 ? isBullishCandle(i) : isBearishCandle(i);
      const trendStillAligned = stTrend[i]===dir;
      // BUG FIX: the SL level (pendingSignal.tSl) is locked in at the FLIP bar, but the actual
      // entry price is the CONFIRMATION bar's close, one bar later. On a fast/gappy move during
      // that single bar, price can already be beyond the pre-computed SL by the time the
      // confirmation bar closes — e.g. a BUY confirmation bar closing below tSl. Previously this
      // was not checked, so openTrade() could receive a non-positive risk (entryPrice-tSl <= 0
      // for BUY, or tSl-entryPrice <= 0 for SELL), which inverts/degenerates TP1-3 (e.g. take-profit
      // levels landing below entry on a BUY) and silently poisons the trade log & self-learning
      // stats. Treat this exactly like a failed confirmation: skip the trade instead of opening
      // a structurally broken one.
      const confirmEntryPrice = closes[i];
      const riskOk = dir===1 ? (confirmEntryPrice - pendingSignal.tSl) > 0 : (pendingSignal.tSl - confirmEntryPrice) > 0;
      if(confirmed && trendStillAligned && riskOk && (dir===1 ? tradeDir<=0 : tradeDir>=0)){
        openTrade(dir, i, pendingSignal.sb, pendingSignal.tSl, pendingSignal.flipIdx);
      } else {
        skippedSignals.push({i:pendingSignal.flipIdx, time:candles[pendingSignal.flipIdx].time, side:dir===1?'BUY':'SELL',
          price:closes[pendingSignal.flipIdx], score:pendingSignal.sb.total, tqi:tqi[pendingSignal.flipIdx],
          pattern: pendingSignal.sb.patternNames.join(' + ') || null, status:'SKIPPED', valid:false,
          hypotheticalR:null, reason: (confirmed && trendStillAligned && !riskOk) ? 'INVALID_RISK' : 'NO_CONFIRMATION'});
      }
      pendingSignal = null;
    }

    if(i>=3 && flipUp && tradeDir<=0){
      // Trend baru saja flip naik. Kalau masih ada posisi SELL terbuka dari trend
      // sebelumnya, tutup dulu sebagai reversal-exit — ini terjadi TERLEPAS dari
      // apakah entry BUY baru lolos ambang self-learning atau tidak.
      if(tradeDir!==0 && i>entryBar) closeCurrentTrade(i, 'FLIP');
      // Trend sudah berbalik naik lagi sebelum sinyal SELL sebelumnya sempat terkonfirmasi
      // candle-nya sendiri — sinyal SELL lama itu otomatis batal (sudah tidak relevan).
      if(pendingSignal && pendingSignal.dir===-1) pendingSignal=null;
      {
        const sb = scoreBreakdown(i,true);
        // SL dihitung terlepas dari lolos-tidaknya ambang, supaya sinyal yang ditolak pun
        // bisa disimulasikan hipotetis (lihat cabang else) dengan SL yang sama persis
        // seandainya dieksekusi — bukan angka yang direka ulang secara terpisah.
        const slBase = lastPivL!=null ? lastPivL : lows[i];
        const rawSl = slBase - cfg.slMult*effAtr[i];
        const minSl = closes[i]-cfg.slMult*effAtr[i];
        const tSl = Math.min(rawSl,minSl);
        const risk = closes[i]-tSl;
        // BUG FIX: sebelumnya patternScore cuma menambah beberapa poin ke total (maks
        // MAX_PATTERN_SCORE dari maxScoreRef ~105-110) tanpa pernah jadi SYARAT — sinyal
        // yang tidak punya Bullish Engulfing/Hammer/Higher Low/dsb sama sekali tetap bisa
        // lolos ambang murni dari momentum/ER/RSI/struktur numerik saja, sehingga label
        // pola yang tampil di kartu sinyal (kalau ada) sebenarnya kosmetik — bukan hal yang
        // benar-benar menentukan validitas entry. cfg.requirePatternConfluence (toggle UI
        // "Wajib Pola Chart/Candlestick Pendukung") sekarang menggerbang entry: kalau aktif,
        // entry HANYA dieksekusi jika minimal satu pola (candle ATAU struktur) terdeteksi.
        const passPattern = !cfg.requirePatternConfluence || sb.patternNames.length>0;
        if(sb.total >= entryThreshold.score && passPattern){
          if(cfg.useCandleConfirm){
            // Jangan entry sekarang — tunggu candle berikutnya tutup bullish sebagai konfirmasi.
            pendingSignal = {dir:1, flipIdx:i, sb, tSl};
          } else {
            openTrade(1, i, sb, tSl, i);
          }
        } else {
          const hypoTp1 = closes[i]+risk*liveTpR[0];
          const hypotheticalR = simulateHypotheticalOutcome(i,true,tSl,hypoTp1);
          skippedSignals.push({i, time:candles[i].time, side:'BUY', price:closes[i], score:sb.total, tqi:tqi[i],
            pattern: sb.patternNames.join(' + ') || null, status:'SKIPPED', valid:false, hypotheticalR,
            reason: sb.total<entryThreshold.score ? 'BELOW_THRESHOLD' : 'NO_PATTERN_CONFLUENCE'});
        }
      }
    } else if(i>=3 && flipDown && tradeDir>=0){
      // Trend baru saja flip turun. Kalau masih ada posisi BUY terbuka dari trend
      // sebelumnya, tutup dulu sebagai reversal-exit — ini terjadi TERLEPAS dari
      // apakah entry SELL baru lolos ambang self-learning atau tidak.
      if(tradeDir!==0 && i>entryBar) closeCurrentTrade(i, 'FLIP');
      if(pendingSignal && pendingSignal.dir===1) pendingSignal=null;
      {
        const sb = scoreBreakdown(i,false);
        const slBase = lastPivH!=null ? lastPivH : highs[i];
        const rawSl = slBase + cfg.slMult*effAtr[i];
        const minSl = closes[i]+cfg.slMult*effAtr[i];
        const tSl = Math.max(rawSl,minSl);
        const risk = tSl-closes[i];
        const passPattern = !cfg.requirePatternConfluence || sb.patternNames.length>0;
        if(sb.total >= entryThreshold.score && passPattern){
          if(cfg.useCandleConfirm){
            // Jangan entry sekarang — tunggu candle berikutnya tutup bearish sebagai konfirmasi.
            pendingSignal = {dir:-1, flipIdx:i, sb, tSl};
          } else {
            openTrade(-1, i, sb, tSl, i);
          }
        } else {
          const hypoTp1 = closes[i]-risk*liveTpR[0];
          const hypotheticalR = simulateHypotheticalOutcome(i,false,tSl,hypoTp1);
          skippedSignals.push({i, time:candles[i].time, side:'SELL', price:closes[i], score:sb.total, tqi:tqi[i],
            pattern: sb.patternNames.join(' + ') || null, status:'SKIPPED', valid:false, hypotheticalR,
            reason: sb.total<entryThreshold.score ? 'BELOW_THRESHOLD' : 'NO_PATTERN_CONFLUENCE'});
        }
      }
    }

    // hit detection for the currently open trade
    if(tradeDir!==0 && i>entryBar){
      const sig = signals[entryIdx];
      const tp1r = tradeDir===1?highs[i]>=tradeTp[0]:lows[i]<=tradeTp[0];
      const tp2r = tradeDir===1?highs[i]>=tradeTp[1]:lows[i]<=tradeTp[1];
      const tp3r = tradeDir===1?highs[i]>=tradeTp[2]:lows[i]<=tradeTp[2];
      // Optional breakeven-stop: once TP1 has been hit, move the stop for the remaining
      // position to entry (0R) instead of leaving it at the original stop. Without this,
      // realized-R for a TP1-then-reversal trade always books the full -1R on the untouched
      // legs, which is more pessimistic than how most traders actually manage the position.
      const useBe = cfg.useBreakeven && hit[0];
      const effectiveSl = useBe ? tradeEntry : tradeSl;
      const slHit = tradeDir===1?lows[i]<=effectiveSl:highs[i]>=effectiveSl;
      const age = i-entryBar, timeoutHit = age>=100;
      if(tp1r && !hit[0]){ hit[0]=true; sig.hit[0]=true; }
      if(tp2r && !hit[1]){ hit[1]=true; sig.hit[1]=true; }
      if(tp3r && !hit[2]){ hit[2]=true; sig.hit[2]=true; }
      if(tp3r || slHit || timeoutHit){
        closeCurrentTrade(i, slHit ? 'SL' : (tp3r ? 'TP3' : 'TIMEOUT'));
      }
    }
  }

  const last = n-1;
  // (maxScoreRef & entryThreshold sudah dihitung di awal fungsi, sebelum loop bar,
  // supaya bisa dipakai menggerbang entry — lihat komentar di dekat deklarasinya.)
  // Pola chart/candlestick untuk bar terakhir, searah trend saat ini — ditampilkan live di
  // kartu Status Trend sebagai confluence tambahan, terlepas dari apakah bar ini memicu
  // sinyal entry baru atau tidak (mis. trend sudah berjalan tapi baru saja muncul pola
  // pendukung seperti higher-low, yang memperkuat keyakinan pada trend yang sedang aktif).
  /* ═══════════════════════════════════════════════════════════
     STATUS TREND — MODEL SELF-LEARNING (menggantikan logic lama yang cuma
     mengikuti arah flip SuperTrend)
     ─────────────────────────────────────────────────────────
     Arah BULLISH/BEARISH kartu "Status Trend" sekarang TIDAK lagi diambil
     langsung dari stTrend (itu tetap dipakai terpisah oleh engine entry/SL/TP,
     tidak diubah — lihat komentar di computeEngine). Sebagai gantinya, arah
     dihitung dari GABUNGAN 2 faktor yang bias-arahnya berdiri sendiri (posisi
     struktur harga dlm range & momentum jendela terkini), masing-masing dikali
     BOBOT yang dipelajari dari histori trade tersimpan (lihat computeTrendWeights
     — structWeight/momWeight, berasal dari data Trend Quality Index & realized-R).
     Begitu arah kandidat ini didapat, dipakai sebagai bias untuk mengevaluasi
     confluence Pola Chart/Candlestick — persis seperti sebelumnya, cuma biasnya
     sekarang ikut model self-learning, bukan ikut stTrend. */
  function trendVotes(i){
    const votes = [];
    if(structDirArr[i]) votes.push({ name:'struct', dir: structDirArr[i], weight: cfg.structWeight||1 });
    if(momDirArr[i]) votes.push({ name:'mom', dir: momDirArr[i], weight: cfg.momWeight||1 });
    // BUG FIX: cfg.patternWeight was computed every cycle by computeTrendWeights() (learned
    // from realized-R of past trades with/without a supporting chart/candlestick pattern) but
    // was never actually consulted anywhere in the engine — the Status Trend voting model only
    // ever looked at struct/momentum, so the "learned" pattern weight was dead code. Here we
    // detect a directional candlestick/structure pattern on the current bar (bull vs bear,
    // reusing the same detector functions the entry-scoring path already uses) and, if the
    // evidence points cleanly to one side (not both/conflicting), add it as a third vote using
    // the learned weight — same pattern as struct/mom above.
    const bullPat = detectCandlePattern(candles,i,true) || detectCandlePattern(candles,i-1,true)
      || detectStructurePattern({ pivHighHist, pivLowHist, effAtrAtI: effAtr[i], i, isBuy:true, structLen });
    const bearPat = detectCandlePattern(candles,i,false) || detectCandlePattern(candles,i-1,false)
      || detectStructurePattern({ pivHighHist, pivLowHist, effAtrAtI: effAtr[i], i, isBuy:false, structLen });
    if(bullPat && !bearPat) votes.push({ name:'pattern', dir:1, weight: cfg.patternWeight||1 });
    else if(bearPat && !bullPat) votes.push({ name:'pattern', dir:-1, weight: cfg.patternWeight||1 });
    return votes;
  }
  function composeTrendStatus(i, fallbackDir){
    const votes = trendVotes(i);
    const score = votes.reduce((s,v)=>s+v.dir*v.weight,0);
    const maxScore = votes.reduce((s,v)=>s+v.weight,0);
    const bullDir = votes.length ? (score>=0 ? 1 : -1) : fallbackDir;
    // Confidence 0..1: proporsi bobot maksimum yang benar-benar mendukung arah yang
    // terpilih (voteConfidence), digabung dengan Trend Quality Index yang SUDAH
    // dievaluasi/dipelajari self-learning (tqiQuality).
    // tqiQuality menggabungkan 2 komponen TQI yang bobotnya dipelajari dari histori
    // trade tersimpan (tqiEffWeight utk Efficiency Ratio, tqiVolWeight utk Volatilitas —
    // lihat computeTrendWeights/weightForMagnitude), plus komponen struktur & momentum
    // TQI dengan bobot netral karena arahnya sudah diwakili votes di atas.
    const effW = cfg.tqiEffWeight||1, volW = cfg.tqiVolWeight||1;
    const tqiWSum = effW+volW+2;
    const tqiQuality = clamp((tqiEr[i]*effW + tqiVol[i]*volW + tqiStruct[i] + tqiMom[i]) / tqiWSum, 0, 1);
    const voteConfidence = maxScore>0 ? clamp(Math.abs(score)/maxScore,0,1) : 0.5;
    const confidence = clamp(0.6*voteConfidence + 0.4*tqiQuality, 0, 1);
    return { bullDir, votes, score, maxScore, tqiQuality, effW, volW, confidence };
  }
  const trendStatus = last>=0 ? composeTrendStatus(last, stTrend[last]) : null;
  const lastIsBuy = trendStatus ? trendStatus.bullDir===1 : (last>=0 && stTrend[last]===1);
  return {
    n, closes, highs, lows, hasVolume, maxScoreRef,
    tqi, tqiEr, tqiVol, tqiStruct, tqiMom, er, volRatio, rsiVals, structDirArr, momDirArr,
    stTrend, stLine, lowerBand, upperBand,
    trendStatus, // model self-learning lengkap (arah, votes, tqiQuality, confidence) — lihat renderAll()
    signals, skippedSignals, entryThreshold,
    openTrade: tradeDir!==0 ? {dir:tradeDir, entry:tradeEntry, sl:tradeSl, tp:tradeTp, tpR:tradeTpR, hit, mode:cfg.tpMode, sig:signals[entryIdx]} : null,
    // Sinyal yang trend-flip & skornya sudah valid di bar terakhir, tapi masih menunggu
    // bar berikutnya (yang belum terbentuk) untuk konfirmasi candlestick — dipakai kartu
    // Status Trend untuk menampilkan "Menunggu Konfirmasi" alih-alih diam-diam tidak ada apa-apa.
    pendingConfirmation: (pendingSignal && pendingSignal.flipIdx===n-1) ? {dir:pendingSignal.dir} : null,
    stats:{
      // windowed (last MAX_HISTORY_SIGS trades) — matches what's shown in Riwayat Sinyal / CSV
      count: rBuffer.length,
      sumR: rBuffer.reduce((a,b)=>a+b,0),
      winRate: rBuffer.length? rBuffer.filter(r=>r>0).length/rBuffer.length*100 : null,
      avgR: rBuffer.length? rBuffer.reduce((a,b)=>a+b,0)/rBuffer.length : null,
      // all-time (unbounded) — kept separately, not mixed into the windowed metrics above
      allTimeCount: allCount, allTimeSumR: allSumR,
      allTimeAvgR: allCount? allSumR/allCount : null,
      curWinStreak, curLossStreak, maxWinStreak, maxLossStreak},
    last,
  };
}
