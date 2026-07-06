import { describe, it, expect, beforeEach } from 'vitest';
import { state } from '../js/state.js';
import { resetPersistedHistory, syncPersistedHistory, resetPersistedSkipped, syncPersistedSkipped } from '../js/history-store.js';
import {
  weightForConfluence, weightForMagnitude, computeTrendWeights,
  weightedTradeStats, computeAdaptiveThreshold,
} from '../js/self-learning.js';

function trade(overrides){
  return { realizedR: 0, structAligned:null, momAligned:null, pattern:null, tqiErAtEntry:null, tqiVolAtEntry:null, ...overrides };
}

describe('weightForConfluence', () => {
  it('sampel < 10 di salah satu sisi -> netral (weight=1, learned=false)', () => {
    const rel = [trade({structAligned:true, realizedR:1})]; // cuma 1 sampel
    const r = weightForConfluence(rel, h=>h.structAligned);
    expect(r.weight).toBe(1);
    expect(r.learned).toBe(false);
  });
  it('confluence yang jelas menguntungkan (avgR jauh lebih tinggi saat hadir) -> weight > 1', () => {
    const withFlag = Array.from({length:15}, ()=> trade({structAligned:true, realizedR:2}));
    const withoutFlag = Array.from({length:15}, ()=> trade({structAligned:false, realizedR:-1}));
    const r = weightForConfluence([...withFlag, ...withoutFlag], h=>h.structAligned);
    expect(r.learned).toBe(true);
    expect(r.weight).toBeGreaterThan(1);
    expect(r.weight).toBeLessThanOrEqual(1.5); // clamp atas
  });
  it('confluence yang terbukti merugikan -> weight < 1 (diturunkan, bukan dihapus)', () => {
    const withFlag = Array.from({length:15}, ()=> trade({structAligned:true, realizedR:-2}));
    const withoutFlag = Array.from({length:15}, ()=> trade({structAligned:false, realizedR:2}));
    const r = weightForConfluence([...withFlag, ...withoutFlag], h=>h.structAligned);
    expect(r.weight).toBeLessThan(1);
    expect(r.weight).toBeGreaterThanOrEqual(0.5); // clamp bawah
  });
  it('nilai null (confluence tidak tersedia) dikecualikan, bukan dihitung sebagai "tidak hadir"', () => {
    const rel = [
      ...Array.from({length:15}, ()=> trade({structAligned:true, realizedR:1})),
      ...Array.from({length:15}, ()=> trade({structAligned:false, realizedR:-1})),
      ...Array.from({length:50}, ()=> trade({structAligned:null, realizedR:99})), // harus diabaikan total
    ];
    const r = weightForConfluence(rel, h=>h.structAligned);
    expect(r.sample).toBe(15); // bukan 65 — trade null tidak ikut dihitung di kedua sisi
  });
});

describe('weightForMagnitude', () => {
  it('kurang dari 20 sampel total -> netral', () => {
    const rel = Array.from({length:10}, (_,i)=> trade({tqiErAtEntry:i/10, realizedR:i}));
    const r = weightForMagnitude(rel, h=>h.tqiErAtEntry);
    expect(r.weight).toBe(1);
    expect(r.learned).toBe(false);
  });
  it('nilai tinggi jelas berkorelasi realizedR tinggi -> weight > 1', () => {
    const rel = [
      ...Array.from({length:15}, ()=> trade({tqiErAtEntry:0.1, realizedR:-1})), // faktor rendah -> hasil buruk
      ...Array.from({length:15}, ()=> trade({tqiErAtEntry:0.9, realizedR:2})),  // faktor tinggi -> hasil bagus
    ];
    const r = weightForMagnitude(rel, h=>h.tqiErAtEntry);
    expect(r.learned).toBe(true);
    expect(r.weight).toBeGreaterThan(1);
  });
});

describe('weightedTradeStats (recency-weighted)', () => {
  it('daftar kosong -> winRate/avgR null (bukan 0 — beda makna "belum ada data" vs "performa nol")', () => {
    const r = weightedTradeStats([], 15);
    expect(r.winRate).toBeNull();
    expect(r.avgR).toBeNull();
  });
  it('semua bobot sama kalau halfLife sangat besar -> mendekati rata-rata biasa', () => {
    const list = [trade({realizedR:1}), trade({realizedR:-1}), trade({realizedR:2})];
    const r = weightedTradeStats(list, 1e9); // halfLife raksasa -> decay~1 -> bobot hampir seragam
    expect(r.avgR).toBeCloseTo((1-1+2)/3, 3);
  });
  it('trade TERBARU (index terakhir) lebih berpengaruh daripada trade lama', () => {
    // trade lama semua rugi besar, trade TERBARU untung besar -> avgR harus condong positif
    // kalau recency weighting bekerja (bukan simple average yang akan sekitar 0)
    const list = [
      ...Array.from({length:20}, ()=> trade({realizedR:-5})),
      trade({realizedR:5}), // trade paling baru
    ];
    const r = weightedTradeStats(list, 5); // halfLife pendek -> trade lama cepat "dilupakan"
    const simpleAvg = (20*-5 + 5)/21;
    expect(r.avgR).toBeGreaterThan(simpleAvg); // harus lebih tinggi dari rata-rata polos
  });
  it('winRate dihitung dari proporsi bobot trade realizedR>0', () => {
    const list = [trade({realizedR:1}), trade({realizedR:-1})];
    const r = weightedTradeStats(list, 15);
    expect(r.winRate).toBeGreaterThan(0);
    expect(r.winRate).toBeLessThan(100);
  });
});

describe('computeTrendWeights (integrasi dengan history-store, circular import)', () => {
  beforeEach(() => {
    resetPersistedHistory();
    state.symbol = 'XAU/USD'; state.interval = '15min';
  });
  it('tanpa riwayat sama sekali -> semua bobot netral (1.0)', () => {
    const w = computeTrendWeights();
    expect(w.structWeight).toBe(1);
    expect(w.momWeight).toBe(1);
    expect(w.patternWeight).toBe(1);
    expect(w.tqiEffWeight).toBe(1);
    expect(w.tqiVolWeight).toBe(1);
  });
  it('hanya menghitung riwayat pair+timeframe yang aktif (tidak campur pair lain)', () => {
    const closedSignals = Array.from({length:15}, (_,i)=>({
      time:`t${i}`, side:'LONG', status:'TP1', realizedR:2, score:60, tqi:0.4,
      price:2000, sl:1990, tp1:2010, tp2:2020, tp3:2030, hit:[true,false,false],
      pattern:null, patternScore:0, structAligned:true, momAligned:true,
      tqiErAtEntry:0.5, tqiVolAtEntry:0.5,
    }));
    const closedSignalsNoStruct = closedSignals.map((s,i)=>({...s, time:`u${i}`, structAligned:false, realizedR:-2}));
    syncPersistedHistory([...closedSignals, ...closedSignalsNoStruct]);
    const w = computeTrendWeights();
    expect(w.struct.learned).toBe(true);
    expect(w.structWeight).toBeGreaterThan(1); // structAligned=true jelas lebih untung di data ini
  });
});

describe('computeAdaptiveThreshold', () => {
  beforeEach(() => {
    resetPersistedHistory();
    resetPersistedSkipped();
    state.symbol = 'XAU/USD'; state.interval = '15min';
    state.useAdaptiveThreshold = true;
  });

  it('nonaktif -> selalu baseline 45%, terlepas dari riwayat', () => {
    state.useAdaptiveThreshold = false;
    const r = computeAdaptiveThreshold(100);
    expect(r.pct).toBeCloseTo(0.45, 10);
    expect(r.score).toBeCloseTo(45, 10);
  });

  it('sampel < 15 trade -> baseline 45% (menghindari overfit ke sampel kecil)', () => {
    const few = Array.from({length:5}, (_,i)=>({
      time:`t${i}`, side:'LONG', status:'TP1', realizedR:2, score:60, tqi:0.4,
      price:2000, sl:1990, tp1:2010, tp2:2020, tp3:2030, hit:[true,false,false],
      pattern:null, patternScore:0, structAligned:null, momAligned:null,
      tqiErAtEntry:null, tqiVolAtEntry:null,
    }));
    syncPersistedHistory(few);
    const r = computeAdaptiveThreshold(100);
    expect(r.pct).toBeCloseTo(0.45, 10);
    expect(r.reason).toMatch(/5\/15/);
  });

  it('expectancy positif tinggi & sampel cukup -> ambang TURUN dari baseline (lebih longgar)', () => {
    const good = Array.from({length:30}, (_,i)=>({
      time:`t${i}`, side:'LONG', status:'TP1', realizedR:0.5, score:60, tqi:0.4,
      price:2000, sl:1990, tp1:2010, tp2:2020, tp3:2030, hit:[true,false,false],
      pattern:null, patternScore:0, structAligned:null, momAligned:null,
      tqiErAtEntry:null, tqiVolAtEntry:null,
    }));
    syncPersistedHistory(good);
    const r = computeAdaptiveThreshold(100);
    expect(r.pct).toBeLessThan(0.45);
  });

  it('expectancy negatif & sampel cukup -> ambang NAIK dari baseline (lebih ketat)', () => {
    const bad = Array.from({length:30}, (_,i)=>({
      time:`t${i}`, side:'LONG', status:'SL', realizedR:-0.3, score:60, tqi:0.4,
      price:2000, sl:1990, tp1:2010, tp2:2020, tp3:2030, hit:[false,false,false],
      pattern:null, patternScore:0, structAligned:null, momAligned:null,
      tqiErAtEntry:null, tqiVolAtEntry:null,
    }));
    syncPersistedHistory(bad);
    const r = computeAdaptiveThreshold(100);
    expect(r.pct).toBeGreaterThan(0.45);
  });

  it('hasil pct selalu di dalam clamp [0.25, 0.70]', () => {
    // expectancy ekstrem positif -> harusnya di-clamp, tidak meledak ke bawah 0.25
    const extreme = Array.from({length:30}, (_,i)=>({
      time:`t${i}`, side:'LONG', status:'TP3', realizedR:10, score:60, tqi:0.4,
      price:2000, sl:1990, tp1:2010, tp2:2020, tp3:2030, hit:[true,true,true],
      pattern:null, patternScore:0, structAligned:null, momAligned:null,
      tqiErAtEntry:null, tqiVolAtEntry:null,
    }));
    syncPersistedHistory(extreme);
    const r = computeAdaptiveThreshold(100);
    expect(r.pct).toBeGreaterThanOrEqual(0.25);
    expect(r.pct).toBeLessThanOrEqual(0.70);
  });

  it('sinyal terlewat yang hipotetis profitable -> memberi nudge melonggarkan ambang (maks ±3 poin persen)', () => {
    // Base case: 30 trade netral (expectancy pas di tengah -0.2..0.5, biar pctBefore stabil)
    const neutral = Array.from({length:30}, (_,i)=>({
      time:`t${i}`, side:'LONG', status:'TP1', realizedR:0.1, score:60, tqi:0.4,
      price:2000, sl:1990, tp1:2010, tp2:2020, tp3:2030, hit:[true,false,false],
      pattern:null, patternScore:0, structAligned:null, momAligned:null,
      tqiErAtEntry:null, tqiVolAtEntry:null,
    }));
    syncPersistedHistory(neutral);
    const before = computeAdaptiveThreshold(100);

    const skippedProfitable = Array.from({length:15}, (_,i)=>({
      time:`s${i}`, side:'LONG', score:40, hypotheticalR:0.3,
    }));
    syncPersistedSkipped(skippedProfitable);
    const after = computeAdaptiveThreshold(100);

    expect(after.pct).toBeLessThan(before.pct); // dilonggarkan
    expect(before.pct - after.pct).toBeLessThanOrEqual(0.03 + 1e-9); // nudge maksimum ±3 poin
  });
});
