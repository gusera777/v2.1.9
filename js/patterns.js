/* ═══════════════════════════════════════════════════════════
   PATTERN DETECTORS — candlestick reversal (2-bar) & chart structure
   ─────────────────────────────────────────────────────────
   Dipisah dari engine.js sebagai fungsi MURNI (tidak bergantung closure
   state computeEngine) supaya logic-nya bisa diuji langsung lewat unit
   test (lihat tests/patterns.test.js), bukan cuma "ketebak benar" lewat
   test end-to-end computeEngine yang jauh lebih sulit membangun fixture-nya
   secara presisi.
   ═══════════════════════════════════════════════════════════ */

/* ── candlestick reversal patterns (2-bar) ──
   isBuy=true  → cari pola bullish reversal (Bullish Engulfing, Hammer)
   isBuy=false → cari pola bearish reversal (Bearish Engulfing, Shooting Star) */
export function detectCandlePattern(candles, i, isBuy){
  if(i<1 || i>=candles.length) return null;
  const o=candles[i].open, c=candles[i].close, h=candles[i].high, l=candles[i].low;
  const po=candles[i-1].open, pc=candles[i-1].close;
  const body=Math.abs(c-o), range=Math.max(h-l,1e-9);
  const upperWick=h-Math.max(o,c), lowerWick=Math.min(o,c)-l;
  if(isBuy){
    if(pc<po && c>o && o<=pc && c>=po) return 'Bullish Engulfing';
    if(lowerWick>=body*2 && upperWick<=body*0.5 && body/range<0.4) return 'Hammer';
  } else {
    if(pc>po && c<o && o>=pc && c<=po) return 'Bearish Engulfing';
    if(upperWick>=body*2 && lowerWick<=body*0.5 && body/range<0.4) return 'Shooting Star';
  }
  return null;
}

/* ── chart-structure patterns dari riwayat pivot: double top/bottom (dua pivot
   berdekatan harganya, dipisah >=5 bar) atau higher-low/lower-high (konfirmasi
   kelanjutan trend).
   BUG FIX: sebelumnya Higher Low/Lower High (dan sebenarnya juga Double Top/Bottom)
   tidak punya batas KEBARUAN sama sekali terhadap bar sekarang (i) — selama dua
   pivot TERAKHIR yang pernah tercatat menunjukkan arah naik/turun, pola ini
   dilaporkan valid walau pivot p2 itu terbentuk puluhan bar yang lalu (mis. harga
   sudah lama trending searah tanpa pullback baru) dan sudah tidak relevan lagi
   sebagai confluence untuk sinyal SAAT INI. Sekarang p2 wajib berada dalam jendela
   `structLen` bar dari bar sekarang — kalau lebih basi dari itu, pola dianggap
   tidak ada (null), bukan diam-diam dipakai sebagai bukti kuat yang sudah kadaluarsa. */
export function detectStructurePattern({ pivHighHist, pivLowHist, effAtrAtI, i, isBuy, structLen }){
  if(isBuy){
    if(pivLowHist.length>=2){
      const p1=pivLowHist[pivLowHist.length-2], p2=pivLowHist[pivLowHist.length-1];
      if((i-p2.idx) > structLen) return null;
      const tol = effAtrAtI*0.3;
      if(Math.abs(p1.val-p2.val)<=tol && (p2.idx-p1.idx)>=5) return 'Double Bottom';
      if(p2.val>p1.val) return 'Higher Low';
    }
  } else {
    if(pivHighHist.length>=2){
      const p1=pivHighHist[pivHighHist.length-2], p2=pivHighHist[pivHighHist.length-1];
      if((i-p2.idx) > structLen) return null;
      const tol = effAtrAtI*0.3;
      if(Math.abs(p1.val-p2.val)<=tol && (p2.idx-p1.idx)>=5) return 'Double Top';
      if(p2.val<p1.val) return 'Lower High';
    }
  }
  return null;
}
