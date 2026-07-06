import { CONST } from '../constants.js';
import { state } from '../state.js';
import { clamp } from '../utils.js';
import { rma, trueRangeArr } from '../indicators.js';
import { persistedHistory, getPersistedStats, getSkippedStats } from '../history-store.js';
import { fmtPrice } from './dom-helpers.js';
import { drawGauge, drawSparkline, drawChart } from './charts.js';
import { calculateAIInsight, updateAIUI } from './ai-insight.js';
import { updateProfilePanel } from './profile.js';

export function renderAll(res, candles){
  const last = res.last;
  const lastClose = res.closes[last];
  const prevClose = res.closes[last-1] ?? lastClose;
  const priceEl = document.getElementById('priceNow');
  priceEl.textContent = fmtPrice(lastClose);
  const priceUp = lastClose>=prevClose;
  priceEl.className = 'priceNow '+(priceUp?'up':'down');
  const delta = lastClose-prevClose;
  const deltaPct = prevClose ? (delta/prevClose*100) : 0;
  const changeEl = document.getElementById('priceChange');
  if(changeEl){
    changeEl.textContent = `${delta>=0?'+':''}${delta.toFixed(2)} (${delta>=0?'+':''}${deltaPct.toFixed(2)}%)`;
    changeEl.className = 'price-change '+(priceUp?'':'down');
  }
  document.getElementById('priceSub').textContent = `${state.symbol} · ${state.interval} · update ${new Date().toLocaleTimeString('id-ID')}`;
  drawSparkline(candles);

  const trendTag = document.getElementById('trendTag');
  // Arah Status Trend sekarang berasal dari model self-learning (res.trendStatus),
  // bukan langsung dari flip SuperTrend — lihat composeTrendStatus() di computeEngine.
  // SuperTrend (res.stTrend) tetap dipakai apa adanya oleh engine entry/SL/TP di kartu
  // Posisi Terbuka; kedua hal ini sengaja dipisah, jadi sesekali arahnya bisa berbeda
  // kalau self-learning menilai konfirmasi lain (struktur/momentum) lebih kuat.
  const bull = res.trendStatus ? res.trendStatus.bullDir===1 : res.stTrend[last]===1;
  trendTag.textContent = bull ? '▲ BULLISH' : '▼ BEARISH';
  trendTag.className = 'trendTag '+(bull?'bull':'bear');

  // ── Confidence Self-Learning (visible di kartu, bukan cuma tooltip) ──
  const slConfTag = document.getElementById('slConfTag');
  const slConfFill = document.getElementById('slConfFill');
  const slVotesMsg = document.getElementById('slVotesMsg');
  if(res.trendStatus){
    const ts = res.trendStatus;
    const pct = Math.round(clamp(ts.confidence,0,1)*100);
    if(slConfTag){
      slConfTag.textContent = pct+'%';
      slConfTag.className = 'trendTag '+(bull?'bull':'bear');
    }
    if(slConfFill){
      slConfFill.style.width = pct+'%';
      slConfFill.className = 'factor-fill '+(pct>=60?'fill-green':pct>=35?'fill-yellow':'fill-orange');
    }
    const nameMap = {struct:'Struktur Harga', mom:'Momentum', pattern:'Pola Chart/Candlestick'};
    const voteParts = ts.votes.map(v=>`${nameMap[v.name]||v.name} ${v.dir>0?'bullish':'bearish'} (${v.weight.toFixed(2)}×)`);
    const tqiPct = Math.round(clamp(ts.tqiQuality,0,1)*100);
    if(slVotesMsg){
      let msg = voteParts.length ? `Voting self-learning: ${voteParts.join(', ')}.` : 'Belum cukup faktor untuk voting arah pada bar ini.';
      msg += ` Dikonfirmasi oleh Trend Quality Index self-learning (${tqiPct}%).`;
      slVotesMsg.textContent = msg;
      slVotesMsg.className = 'statusMsg show';
    }
    const voteTxt = ts.votes.map(v=>`${v.name}:${v.dir>0?'+':''}${(v.dir*v.weight).toFixed(2)}`).join(' · ');
    trendTag.title = `Self-learning confidence ${pct}% (skor arah ${ts.score.toFixed(2)}/${ts.maxScore.toFixed(2)})${voteTxt?' — '+voteTxt:''}`;
  } else {
    if(slConfTag){ slConfTag.textContent='—'; slConfTag.className='trendTag'; }
    if(slConfFill){ slConfFill.style.width='0%'; slConfFill.className='factor-fill fill-green'; }
    if(slVotesMsg){ slVotesMsg.textContent=''; slVotesMsg.className='statusMsg'; }
  }

  // ── Trend Quality Index (Self-Learning) ──
  // Nilainya (trendStatus.tqiQuality) adalah Trend Quality Index yang
  // sudah dievaluasi/dipelajari self-learning — komponen Efficiency Ratio & Volatilitas
  // dibobot pakai tqiEffWeight/tqiVolWeight hasil belajar dari realized-R histori trade
  // tersimpan (lihat computeTrendWeights/weightForMagnitude), jadi angkanya sudah
  // dioptimalkan untuk pair+timeframe yang sedang aktif, bukan angka rule tetap.
  const tqiSlTag = document.getElementById('tqiSlTag');
  const tqiSlFill = document.getElementById('tqiSlFill');
  const tqiSlMsg = document.getElementById('tqiSlMsg');
  if(res.trendStatus){
    const ts = res.trendStatus;
    const q = Math.round(clamp(ts.tqiQuality,0,1)*100);
    const qualityLabel = q>=60 ? 'Trend Kuat' : q>=35 ? 'Netral' : 'Kurang Jelas';
    if(tqiSlTag){
      tqiSlTag.textContent = q+'% · '+qualityLabel;
      tqiSlTag.className = 'trendTag '+(bull?'bull':'bear');
    }
    if(tqiSlFill){
      tqiSlFill.style.width = q+'%';
      tqiSlFill.className = 'factor-fill '+(q>=60?'fill-green':q>=35?'fill-yellow':'fill-orange');
    }
    const cwTqi = res.confluenceWeights;
    const effLabel = cwTqi && cwTqi.tqiEff && cwTqi.tqiEff.learned
      ? `Efisiensi Trend ${ts.effW.toFixed(2)}× (dipelajari dari ${cwTqi.tqiEff.sample} trade)`
      : 'Efisiensi Trend 1.00× (default, belum cukup sampel)';
    const volLabel = cwTqi && cwTqi.tqiVol && cwTqi.tqiVol.learned
      ? `Volatilitas ${ts.volW.toFixed(2)}× (dipelajari dari ${cwTqi.tqiVol.sample} trade)`
      : 'Volatilitas 1.00× (default, belum cukup sampel)';
    if(tqiSlMsg){
      tqiSlMsg.textContent = `Trend Quality Index tervalidasi self-learning: ${effLabel}, ${volLabel}.`;
      tqiSlMsg.className = 'statusMsg show';
    }
    tqiSlTag.title = `tqiQuality ${q}% — dari Efficiency Ratio, Volatilitas, Struktur & Momentum TQI (bobot ER/Vol dipelajari dari histori trade)`;
  } else {
    if(tqiSlTag){ tqiSlTag.textContent='—'; tqiSlTag.className='trendTag'; }
    if(tqiSlFill){ tqiSlFill.style.width='0%'; tqiSlFill.className='factor-fill fill-green'; }
    if(tqiSlMsg){ tqiSlMsg.textContent=''; tqiSlMsg.className='statusMsg'; }
  }

  // ── Konfirmasi Candlestick sebelum entry ──
  const confirmTag = document.getElementById('confirmTag');
  if(confirmTag){
    if(!state.useCandleConfirm){
      confirmTag.textContent = 'Nonaktif'; confirmTag.className = 'trendTag';
      confirmTag.style.background = '#1c2027'; confirmTag.style.color = 'var(--text-dim)'; confirmTag.style.border = '1px solid var(--border)';
    } else if(res.pendingConfirmation){
      const dirTxt = res.pendingConfirmation.dir===1 ? 'BUY' : 'SELL';
      const needTxt = res.pendingConfirmation.dir===1 ? 'candle bullish' : 'candle bearish';
      confirmTag.textContent = `Menunggu ${needTxt} untuk ${dirTxt}`;
      confirmTag.className = 'trendTag';
      confirmTag.style.background = ''; confirmTag.style.color = '#C89B3C'; confirmTag.style.border = '1px solid #C89B3C';
    } else {
      confirmTag.textContent = 'Tidak Ada Sinyal Menunggu';
      confirmTag.className = 'trendTag';
      confirmTag.style.background = '#1c2027'; confirmTag.style.color = 'var(--text-dim)'; confirmTag.style.border = '1px solid var(--border)';
    }
  }

  // gauge
  const tqiNow = res.tqi[last];
  document.getElementById('tqiVal').textContent = Math.round(clamp(tqiNow,0,1)*100);
  const tqiRegimeText = tqiNow>0.6?'Trend Kuat':tqiNow>0.35?'Netral':'Kurang Jelas';
  document.getElementById('tqiRegime').textContent = tqiRegimeText;
  drawGauge(tqiNow);
  const factors = [['fEr','fErV',res.tqiEr[last]],['fVol','fVolV',res.tqiVol[last]],['fStruct','fStructV',res.tqiStruct[last]],['fMom','fMomV',res.tqiMom[last]]];
  factors.forEach(([barId,valId,v])=>{
    document.getElementById(barId).style.width = (clamp(v,0,1)*100).toFixed(0)+'%';
    document.getElementById(valId).textContent = Math.round(clamp(v,0,1)*100)+'/100';
  });
  const tqiDescEl = document.getElementById('tqiDesc');
  if(tqiDescEl){
    if(tqiRegimeText==='Trend Kuat'){
      tqiDescEl.textContent = `Trend kuat dengan struktur harga yang solid dan momentum yang jelas.`;
    } else if(tqiRegimeText==='Netral'){
      tqiDescEl.textContent = `Trend cukup kuat dengan konfirmasi dari struktur harga dan momentum.`;
    } else {
      tqiDescEl.textContent = `Kondisi pasar konsolidasi; momentum dan struktur belum cukup jelas untuk entry.`;
    }
  }

  // trade card
  const ot = res.openTrade;
  const posStatus = document.getElementById('posStatus');
  if(ot){
    posStatus.textContent = ot.dir===1?'BUY':'SELL';
    posStatus.className = 'statusPill '+(ot.dir===1?'buy':'sell');
    document.getElementById('tEntry').textContent = fmtPrice(ot.entry);
    document.getElementById('tSl').textContent = fmtPrice(ot.sl);
    document.getElementById('tTp1').textContent = fmtPrice(ot.tp[0]);
    document.getElementById('tTp2').textContent = fmtPrice(ot.tp[1]);
    document.getElementById('tTp3').textContent = fmtPrice(ot.tp[2]);
    document.getElementById('tTp1').className = 'v'+(ot.hit[0]?' hit':'');
    document.getElementById('tTp2').className = 'v'+(ot.hit[1]?' hit':'');
    document.getElementById('tTp3').className = 'v'+(ot.hit[2]?' hit':'');
    document.getElementById('tMode').textContent = ot.mode;
    const scoreVal = ot.sig ? ot.sig.score : null;
    document.getElementById('tScore').textContent = scoreVal!=null ? scoreVal.toFixed(1) : '—';
    document.getElementById('tScoreMax').textContent = scoreVal!=null ? '/'+res.maxScoreRef : '';
    document.getElementById('tScoreFill').style.width = scoreVal!=null ? (clamp(scoreVal/res.maxScoreRef,0,1)*100).toFixed(0)+'%' : '0%';
  } else {
    posStatus.textContent='FLAT'; posStatus.className='statusPill flat';
    ['tEntry','tSl','tTp1','tTp2','tTp3','tMode'].forEach(id=>{ document.getElementById(id).textContent='—'; });
    ['tTp1','tTp2','tTp3'].forEach(id=>{ document.getElementById(id).className='v'; });
    document.getElementById('tScore').textContent='—';
    document.getElementById('tScoreMax').textContent='';
    document.getElementById('tScoreFill').style.width='0%';
  }

  // stats
  const st = res.stats;
  // Win rate & Avg R both use the same windowed sample (last MAX_HISTORY_SIGS trades) as
  // the Riwayat Sinyal table/CSV, so the numerator/denominator always agree.
  document.getElementById('sWinRate').textContent = st.winRate!=null ? st.winRate.toFixed(0)+'%' : '—';
  document.getElementById('sWinRate').className = 'v '+(st.winRate>50?'pos':st.winRate!=null&&st.winRate<=50?'neg':'');
  document.getElementById('sWinRate').title = `Berdasarkan ${st.count} trade terakhir (maks ${CONST.MAX_HISTORY_SIGS}). All-time: ${st.allTimeCount} trade.`;
  document.getElementById('sAvgR').textContent = st.avgR!=null ? st.avgR.toFixed(2)+'R' : '—';
  document.getElementById('sAvgR').className = 'v '+(st.avgR>0?'pos':st.avgR!=null&&st.avgR<=0?'neg':'');
  document.getElementById('sAvgR').title = st.allTimeAvgR!=null ? `All-time avg R (${st.allTimeCount} trade): ${st.allTimeAvgR.toFixed(2)}R` : '';
  document.getElementById('sCount').textContent = st.count;
  document.getElementById('sCount').title = `Jendela statistik: ${st.count} trade terakhir · All-time: ${st.allTimeCount} trade`;
  document.getElementById('sStreak').textContent = st.curWinStreak>0 ? st.curWinStreak+'W' : (st.curLossStreak>0? st.curLossStreak+'L':'—');
  document.getElementById('sStreak').title = `Rekor: ${st.maxWinStreak}W beruntun / ${st.maxLossStreak}L beruntun`;

  // persisted win rate — cross-session, khusus pair+timeframe aktif (bukan jendela candle sekarang)
  // winRate/avgR sudah recency-weighted (trade terbaru lebih berpengaruh — lihat weightedTradeStats)
  const pStats = getPersistedStats(30);
  document.getElementById('sPersistedWR').textContent = pStats.winRate!=null ? pStats.winRate.toFixed(0)+'%' : '—';
  document.getElementById('sPersistedWR').className = 'v '+(pStats.winRate>50?'pos':pStats.winRate!=null&&pStats.winRate<=50?'neg':'');
  document.getElementById('sPersistedWR').title = `${pStats.windowCount} trade tersimpan terakhir (dari total ${pStats.total} tersimpan) untuk ${state.symbol} ${state.interval}, dibobot recency (trade terbaru lebih berpengaruh).`;

  // ambang skor adaptif yang sedang aktif cycle ini
  const th = state.currentThreshold;
  if(th){
    document.getElementById('sThreshold').textContent = th.score.toFixed(0)+'/'+res.maxScoreRef;
    document.getElementById('sThreshold').title = th.reason;
  }

  // sinyal terlewat (skipped) — hasil simulasi hipotetis satu-target (SL vs TP1), dipakai
  // sebagai umpan balik ke ambang adaptif di atas (lihat computeAdaptiveThreshold). Kalau
  // Avg-R Terlewat positif & jumlahnya cukup, artinya ambang sempat kelewat ketat.
  const skStats = getSkippedStats(50);
  document.getElementById('sSkippedCount').textContent = skStats.windowCount || '—';
  document.getElementById('sSkippedCount').title = `${skStats.total} sinyal terlewat tersimpan (semua sudah resolve) untuk ${state.symbol} ${state.interval}.`;
  document.getElementById('sSkippedAvgR').textContent = skStats.avgR!=null ? (skStats.avgR>=0?'+':'')+skStats.avgR.toFixed(2)+'R' : '—';
  document.getElementById('sSkippedAvgR').className = 'v '+(skStats.avgR>0?'pos':skStats.avgR!=null&&skStats.avgR<=0?'neg':'');
  document.getElementById('sSkippedAvgR').title = 'Simulasi sederhana satu-target (SL vs TP1) seandainya sinyal yang ditolak ambang tetap dieksekusi — bukan simulasi 3-leg penuh seperti trade sungguhan.';

  // log
  renderLog(res);
  drawChart(res, candles);

  // AI insight card (lightweight heuristic read of trend/momentum/volatility)
  updateAIInsightCard(res, candles);

  // Profil: ringkasan performa & preferensi aktif
  updateProfilePanel(res);
}

export function updateAIInsightCard(res, candles){
  const last = res.last;
  const atrArr = rma(trueRangeArr(candles), 14);
  const atrOk = isFinite(atrArr[last]) && candles.length>1;
  if(!atrOk){
    document.getElementById('aiConfidence').textContent = '—';
    document.getElementById('aiConfidenceFill').style.width = '0%';
    document.getElementById('aiInsightHeadline').textContent = 'Menunggu Data yang Cukup…';
    document.getElementById('aiInsightText').textContent = 'Butuh lebih banyak bar candle sebelum AI dapat menganalisis.';
    document.getElementById('aiBias').textContent = '—';
    document.getElementById('aiRisk').textContent = '—';
    document.getElementById('aiRegime').textContent = '—';
    document.getElementById('aiBiasCaptionText').textContent = '—';
    document.getElementById('aiRiskCaptionText').textContent = '—';
    document.getElementById('aiRegimeCaptionText').textContent = '—';
    document.getElementById('aiSummaryText').textContent = 'Menunggu cukup data untuk menghasilkan ringkasan insight.';
    return;
  }
  const data = [
    { close: res.closes[last-1] ?? res.closes[last], trendUp: res.stTrend[last-1]===1, atr: atrArr[last-1] ?? atrArr[last] },
    { close: res.closes[last], trendUp: res.stTrend[last]===1, atr: atrArr[last] },
  ];
  const ai = calculateAIInsight(data);
  updateAIUI(ai);
}

/* Baris "OPEN" (posisi masih berjalan) selalu live dari cycle sekarang; baris yang
   sudah closed diambil dari riwayat TERSIMPAN PERMANEN (persistedHistory), bukan dari
   hasil backtest jendela candle yang sedang di-fetch (res.signals) — jendela itu otomatis
   menyusut/bergeser tiap kali data terbaru masuk, jadi kalau tabel sumbernya dari situ,
   baris lama akan "hilang" walau tradenya belum di-reset. Dengan sumber dari
   persistedHistory, riwayat hanya hilang lewat tombol "Reset Riwayat" (self-learning). */
export function historyRows(res){
  const open = res.signals.filter(s=>s.status==='OPEN');
  const closedAll = persistedHistory.filter(h=>h.symbol===state.symbol && h.interval===state.interval);
  const closed = closedAll.slice(-CONST.MAX_HISTORY_SIGS).slice().reverse();
  return { rows: [...open.slice().reverse(), ...closed], openCount: open.length, closedAllCount: closedAll.length };
}

// SECURITY FIX: s.time (and, defensively, s.side/s.pattern/s.status) can ultimately trace back
// to user-pasted CSV text in Mode CSV (the `time` column is stored verbatim from the pasted
// text with no sanitization). renderLog() interpolates these fields directly into innerHTML,
// so a pasted CSV row like `<img src=x onerror=alert(1)>,...` would execute as HTML/script —
// and since closed signals are persisted to localStorage and re-rendered on every future load,
// the injection would survive across sessions. Escape every field before interpolation.
export function escapeHtml(v){
  return String(v).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}

export function renderLog(res){
  const body = document.getElementById('logBody');
  const { rows, openCount, closedAllCount } = historyRows(res);
  document.getElementById('logCount').textContent = rows.length+' / '+(openCount+closedAllCount)+' sinyal';
  document.getElementById('logEmpty').style.display = rows.length? 'none':'block';
  body.innerHTML = rows.map(s=>{
    const rTxt = s.realizedR!=null ? (s.realizedR>=0?'+':'')+s.realizedR.toFixed(2)+'R' : '—';
    const rCls = s.realizedR!=null ? (s.realizedR>=0?'pos':'neg') : '';
    const validTxt = s.valid===false ? 'Lemah' : 'Valid';
    const validCls = s.valid===false ? 'neg' : 'pos';
    const timeSafe = escapeHtml(s.time);
    const sideSafe = escapeHtml(s.side);
    const patternSafe = s.pattern ? escapeHtml(s.pattern) : '—';
    const statusSafe = escapeHtml(s.status);
    return `
<tr>

    <td data-label="Waktu">
        ${timeSafe}
    </td>

    <td data-label="Sisi">
        <span class="sideBadge ${s.side === 'BUY' ? 'buy' : 'sell'}">
            ${sideSafe}
        </span>
    </td>

    <td data-label="Kualitas" class="${validCls}">
        ${validTxt}
    </td>

    <td data-label="Harga">
        ${fmtPrice(s.price)}
    </td>

    <td data-label="Skor">
        ${s.score.toFixed(1)}
    </td>

    <td data-label="Purity">
        ${s.tqi.toFixed(2)}
    </td>

    <td data-label="Pola">
        ${patternSafe}
    </td>

    <td data-label="SL">
        ${fmtPrice(s.sl)}
    </td>

    <td data-label="TP1">
        ${fmtPrice(s.tp1)}
        ${s.hit[0] ? ' ✓' : ''}
    </td>

    <td data-label="TP2">
        ${fmtPrice(s.tp2)}
        ${s.hit[1] ? ' ✓' : ''}
    </td>

    <td data-label="TP3">
        ${fmtPrice(s.tp3)}
        ${s.hit[2] ? ' ✓' : ''}
    </td>

    <td data-label="Status">
        ${statusSafe}
    </td>

    <td
        data-label="R:R"
        class="rval ${rCls}">

        ${rTxt}

    </td>

</tr>
`;
  }).join('');
}
