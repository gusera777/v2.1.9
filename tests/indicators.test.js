import { describe, it, expect } from 'vitest';
import {
  trueRangeArr, rma, smaArr, efficiencyRatioArr, rsiArr,
  rollingHighest, rollingLowest, pivotHighArr, pivotLowArr,
} from '../js/indicators.js';

function randArr(n, seedFn){
  // PRNG sederhana berbasis seed supaya test reproducible (bukan Math.random,
  // supaya kalau ada test gagal bisa direproduksi persis, bukan flaky).
  let s = seedFn ?? 42;
  const rnd = () => { s = (s*1103515245+12345) & 0x7fffffff; return s/0x7fffffff; };
  return Array.from({length:n}, () => rnd()*100);
}
function candlesFromCloses(closes){
  // Bikin candle sintetis dari deret close saja (high/low sedikit di luar
  // open/close, supaya trueRangeArr/pivot punya sesuatu yang masuk akal untuk diuji).
  return closes.map((c,i) => {
    const o = i===0 ? c : closes[i-1];
    return { open:o, close:c, high:Math.max(o,c)+0.5, low:Math.min(o,c)-0.5 };
  });
}

describe('trueRangeArr', () => {
  it('bar pertama = high-low (tidak ada previous close)', () => {
    const c = [{high:10, low:8, close:9}];
    expect(trueRangeArr(c)).toEqual([2]);
  });
  it('bar berikutnya = max(high-low, |high-prevClose|, |low-prevClose|)', () => {
    const c = [
      {high:10, low:8, close:9},
      {high:12, low:9.5, close:11}, // |high-prevClose|=3 > high-low=2.5 > |low-prevClose|=0.5
    ];
    const tr = trueRangeArr(c);
    expect(tr[0]).toBe(2);
    expect(tr[1]).toBe(3); // 3 adalah yang terbesar dari ketiganya
  });
  it('array kosong -> array kosong', () => {
    expect(trueRangeArr([])).toEqual([]);
  });
});

describe('rma (Wilder smoothing)', () => {
  it('bar ke-(len-1) (index len-1) = SMA dari len bar pertama', () => {
    const arr = [1,2,3,4,5,6,7,8];
    const len = 4;
    const out = rma(arr, len);
    const expectedSeed = (1+2+3+4)/4;
    expect(out[3]).toBeCloseTo(expectedSeed, 10);
  });
  it('warm-up bar (sebelum index len-1) = running average sejauh ini (bukan NaN/flat)', () => {
    const arr = [10,20,30,40,50];
    const out = rma(arr, 4);
    expect(out[0]).toBeCloseTo(10, 10);       // rata2 dari [10]
    expect(out[1]).toBeCloseTo(15, 10);       // rata2 dari [10,20]
    expect(out[2]).toBeCloseTo(20, 10);       // rata2 dari [10,20,30]
  });
  it('setelah warm-up mengikuti rumus Wilder: out[i] = (out[i-1]*(len-1)+arr[i])/len', () => {
    const arr = [1,2,3,4,5,6,7,8];
    const len = 4;
    const out = rma(arr, len);
    for(let i=len; i<arr.length; i++){
      const expected = (out[i-1]*(len-1) + arr[i]) / len;
      expect(out[i]).toBeCloseTo(expected, 10);
    }
  });
  it('array kosong -> array kosong', () => {
    expect(rma([], 5)).toEqual([]);
  });
});

describe('smaArr', () => {
  it('cocok dengan rata-rata sederhana manual untuk window penuh', () => {
    const arr = [2,4,6,8,10];
    const out = smaArr(arr, 3);
    expect(out[2]).toBeCloseTo((2+4+6)/3, 10);
    expect(out[3]).toBeCloseTo((4+6+8)/3, 10);
    expect(out[4]).toBeCloseTo((6+8+10)/3, 10);
  });
  it('sebelum window penuh = rata-rata parsial dari data yang ada', () => {
    const arr = [2,4,6,8];
    const out = smaArr(arr, 3);
    expect(out[0]).toBeCloseTo(2, 10);
    expect(out[1]).toBeCloseTo((2+4)/2, 10);
  });
});

describe('efficiencyRatioArr', () => {
  it('trend murni monoton naik -> ER mendekati 1 (semua pergerakan searah)', () => {
    const closes = Array.from({length:40}, (_,i)=>100+i); // naik 1 per bar, tanpa noise
    const out = efficiencyRatioArr(closes, 20);
    expect(out[39]).toBeCloseTo(1, 6);
  });
  it('osilasi naik-turun berulang -> ER mendekati 0 (banyak pergerakan saling menghapus)', () => {
    const closes = Array.from({length:40}, (_,i)=> 100 + (i%2===0?1:-1));
    const out = efficiencyRatioArr(closes, 20);
    expect(out[39]).toBeLessThan(0.15);
  });
  it('hasil selalu dalam rentang [0,1]', () => {
    const closes = randArr(60, 7);
    const out = efficiencyRatioArr(closes, 14);
    out.forEach(v => { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); });
  });
});

describe('rsiArr', () => {
  // Referensi independen (Wilder RSI standar) — ditulis ulang dari nol, BUKAN
  // menyalin logika rsiArr, supaya jadi differential test yang berarti (dua
  // implementasi independen dari rumus yang sama harus setuju).
  function referenceRsi(closes, len){
    const out = new Array(closes.length).fill(50);
    let avgGain=0, avgLoss=0;
    for(let i=1;i<closes.length;i++){
      const diff = closes[i]-closes[i-1];
      const gain = diff>0?diff:0, loss = diff<0?-diff:0;
      if(i<=len){
        avgGain += gain/len; avgLoss += loss/len;
        if(i===len){
          const rs = avgLoss===0 ? Infinity : avgGain/avgLoss;
          out[i] = avgLoss===0 ? 100 : 100-100/(1+rs);
        }
      } else {
        avgGain = (avgGain*(len-1)+gain)/len;
        avgLoss = (avgLoss*(len-1)+loss)/len;
        const rs = avgLoss===0 ? Infinity : avgGain/avgLoss;
        out[i] = avgLoss===0 ? 100 : 100-100/(1+rs);
      }
    }
    return out;
  }
  it('cocok dengan implementasi referensi independen di berbagai seed & panjang', () => {
    for(const seed of [1,2,3,4,5]){
      for(const len of [7,14,21]){
        const closes = randArr(80, seed);
        const a = rsiArr(closes, len);
        const b = referenceRsi(closes, len);
        for(let i=0;i<closes.length;i++) expect(a[i]).toBeCloseTo(b[i], 8);
      }
    }
  });
  it('hasil selalu dalam rentang [0,100]', () => {
    const closes = randArr(100, 11);
    const out = rsiArr(closes, 14);
    out.forEach(v => { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(100); });
  });
  it('naik terus tanpa henti -> RSI mendekati 100 (tidak pernah ada loss)', () => {
    const closes = Array.from({length:30}, (_,i)=>100+i);
    const out = rsiArr(closes, 14);
    expect(out[29]).toBeCloseTo(100, 6);
  });
});

describe('rollingHighest / rollingLowest', () => {
  function naiveHighest(arr,len){ return arr.map((_,i)=>{ const s=Math.max(0,i-len+1); return Math.max(...arr.slice(s,i+1)); }); }
  function naiveLowest(arr,len){ return arr.map((_,i)=>{ const s=Math.max(0,i-len+1); return Math.min(...arr.slice(s,i+1)); }); }

  it('cocok persis dengan implementasi naive brute-force di berbagai ukuran & window', () => {
    const sizes = [0,1,2,10,50,300];
    const lens = [1,2,3,5,14,21,50];
    for(const n of sizes){
      for(const len of lens){
        const arr = randArr(n, n*31+len);
        expect(rollingHighest(arr,len)).toEqual(naiveHighest(arr,len));
        expect(rollingLowest(arr,len)).toEqual(naiveLowest(arr,len));
      }
    }
  });
  it('edge case: semua nilai sama (tie) -> highest === lowest', () => {
    const ties = new Array(20).fill(7);
    expect(rollingHighest(ties,5)).toEqual(rollingLowest(ties,5));
  });
  it('array kosong -> array kosong', () => {
    expect(rollingHighest([],5)).toEqual([]);
    expect(rollingLowest([],5)).toEqual([]);
  });
});

describe('pivotHighArr / pivotLowArr', () => {
  it('mendeteksi puncak lokal yang jelas (lebih tinggi dari lp bar di kedua sisi)', () => {
    // index 5 (nilai 100) adalah puncak lokal jelas dengan lp=2
    const highs = [1,2,3,4,5,100,5,4,3,2,1];
    const out = pivotHighArr(highs, 2);
    expect(out[5]).toBe(100);
    expect(out[4]).toBeNull();
    expect(out[6]).toBeNull();
  });
  it('mendeteksi lembah lokal yang jelas', () => {
    const lows = [10,9,8,7,6,-50,6,7,8,9,10];
    const out = pivotLowArr(lows, 2);
    expect(out[5]).toBe(-50);
  });
  it('tidak menandai apa pun kalau ada nilai sama/lebih tinggi di window (bukan pivot murni)', () => {
    const highs = [1,2,5,5,2,1]; // dua nilai kembar di puncak -> bukan pivot tunggal
    const out = pivotHighArr(highs, 1);
    expect(out[2]).toBeNull();
    expect(out[3]).toBeNull();
  });
  it('lp bar di kedua ujung array tidak pernah dievaluasi (tetap null)', () => {
    const highs = [100,1,2,3,1,100];
    const out = pivotHighArr(highs, 2);
    expect(out[0]).toBeNull();
    expect(out[highs.length-1]).toBeNull();
  });
});
