import { clamp, safeDiv } from './utils.js';

/* ── indicator series builders ──────────────────────────────── */
export function trueRangeArr(c){
  const tr=[];
  for(let i=0;i<c.length;i++){
    if(i===0){ tr.push(c[i].high-c[i].low); continue; }
    tr.push(Math.max(c[i].high-c[i].low, Math.abs(c[i].high-c[i-1].close), Math.abs(c[i].low-c[i-1].close)));
  }
  return tr;
}
export function rma(arr, len){ // Wilder smoothing
  const out=new Array(arr.length).fill(NaN);
  let sum=0;
  for(let i=0;i<arr.length;i++){
    if(i<len){
      sum+=arr[i];
      // BUG FIX: bars before the first full `len`-sized window used to be flat-filled with
      // arr[0] repeated (out[i] = out[i-1], seeded from arr[0]) instead of reflecting the data
      // seen so far. For ATR specifically this meant the warm-up bars (indices 0..len-2) all
      // reported the FIRST bar's true range, often far from representative — understating or
      // overstating volatility for whichever historical bars happened to land in that window
      // on a given fetch, which feeds directly into band width, SL distance, and entry scoring.
      // Using the running average of data seen so far (a partial SMA) is a much closer estimate
      // of the eventual seed value than an arbitrary single-sample flat line, while still
      // avoiding NaN propagation downstream.
      out[i] = i===len-1 ? sum/len : sum/(i+1);
    }
    else{ out[i] = (out[i-1]*(len-1) + arr[i]) / len; }
  }
  return out;
}
export function smaArr(arr, len){
  const out = new Array(arr.length).fill(NaN);
  let sum=0;
  for(let i=0;i<arr.length;i++){
    sum += arr[i];
    if(i>=len) sum -= arr[i-len];
    out[i] = i>=len-1 ? sum/len : arr.slice(0,i+1).reduce((a,b)=>a+b,0)/(i+1);
  }
  return out;
}
export function efficiencyRatioArr(closes, len){
  const out = new Array(closes.length).fill(0.3);
  for(let i=0;i<closes.length;i++){
    if(i<len){ out[i]=0.3; continue; }
    const dir = Math.abs(closes[i]-closes[i-len]);
    let vol=0;
    for(let k=i-len+1;k<=i;k++) vol += Math.abs(closes[k]-closes[k-1]);
    out[i] = clamp(safeDiv(dir,vol,0.3),0,1);
  }
  return out;
}
export function rsiArr(closes, len){
  const out = new Array(closes.length).fill(50);
  let avgGain=0, avgLoss=0;
  for(let i=1;i<closes.length;i++){
    const diff = closes[i]-closes[i-1];
    const gain = Math.max(diff,0), loss = Math.max(-diff,0);
    if(i<=len){
      avgGain += gain/len; avgLoss += loss/len;
      out[i] = i===len ? computeRsi(avgGain,avgLoss) : 50;
    } else {
      avgGain = (avgGain*(len-1)+gain)/len;
      avgLoss = (avgLoss*(len-1)+loss)/len;
      out[i] = computeRsi(avgGain,avgLoss);
    }
  }
  function computeRsi(g,l){ if(l===0) return 100; const rs=g/l; return 100-100/(1+rs); }
  return out;
}
/* Sliding-window max/min lewat monotonic deque — O(n) total, dibanding versi lama
   yang O(n·len) karena Math.max(...arr.slice(...)) dihitung ulang dari nol untuk
   SETIAP elemen. Semantiknya identik dengan versi lama (window = [max(0,i-len+1), i],
   inklusif) — sudah diverifikasi lewat brute-force comparison, lihat riwayat
   percakapan. Deque menyimpan INDEX (bukan nilai), dijaga monoton menurun (untuk
   max) / menaik (untuk min) dari depan ke belakang, sehingga elemen terdepan
   selalu jadi jawaban untuk window saat ini. */
export function rollingHighest(arr, len){
  const out = new Array(arr.length);
  const deque = []; // index, arr[deque[...]] menurun dari depan ke belakang
  for(let i=0;i<arr.length;i++){
    while(deque.length && arr[deque[deque.length-1]] <= arr[i]) deque.pop();
    deque.push(i);
    if(deque[0] <= i-len) deque.shift();
    out[i] = arr[deque[0]];
  }
  return out;
}
export function rollingLowest(arr, len){
  const out = new Array(arr.length);
  const deque = []; // index, arr[deque[...]] menaik dari depan ke belakang
  for(let i=0;i<arr.length;i++){
    while(deque.length && arr[deque[deque.length-1]] >= arr[i]) deque.pop();
    deque.push(i);
    if(deque[0] <= i-len) deque.shift();
    out[i] = arr[deque[0]];
  }
  return out;
}

export function pivotHighArr(highs, lp){
  const out = new Array(highs.length).fill(null);
  for(let i=lp;i<highs.length-lp;i++){
    let isPivot=true, v=highs[i];
    for(let k=i-lp;k<=i+lp;k++){ if(k!==i && highs[k]>=v){ isPivot=false; break; } }
    if(isPivot) out[i]=v;
  }
  return out;
}
export function pivotLowArr(lows, lp){
  const out = new Array(lows.length).fill(null);
  for(let i=lp;i<lows.length-lp;i++){
    let isPivot=true, v=lows[i];
    for(let k=i-lp;k<=i+lp;k++){ if(k!==i && lows[k]<=v){ isPivot=false; break; } }
    if(isPivot) out[i]=v;
  }
  return out;
}
