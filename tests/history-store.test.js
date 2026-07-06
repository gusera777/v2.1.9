import { describe, it, expect, beforeEach } from 'vitest';
import { state } from '../js/state.js';
import {
  loadPersistedHistory, savePersistedHistory, resetPersistedHistory, syncPersistedHistory,
  getPersistedStats, normalizePersistedItem, persistedHistory,
  loadPersistedSkipped, resetPersistedSkipped, syncPersistedSkipped, getSkippedStats,
} from '../js/history-store.js';

function makeClosedSignal(overrides){
  return {
    time: '2026-01-01T00:00:00Z', side:'LONG', status:'TP1', realizedR:1.5,
    score:60, tqi:0.4, price:2000, sl:1990, tp1:2010, tp2:2020, tp3:2030,
    hit:[true,false,false], pattern:null, patternScore:0,
    structAligned:true, momAligned:true, tqiErAtEntry:0.5, tqiVolAtEntry:0.5,
    ...overrides,
  };
}

describe('history-store: persisted trade history', () => {
  beforeEach(() => {
    resetPersistedHistory();
    state.symbol = 'XAU/USD';
    state.interval = '15min';
  });

  it('mulai kosong sebelum ada apa pun disimpan', () => {
    expect(persistedHistory).toEqual([]);
  });

  it('syncPersistedHistory hanya menyimpan sinyal yang sudah closed (bukan OPEN)', () => {
    const signals = [
      makeClosedSignal({ time:'t1', status:'OPEN', realizedR:null }),
      makeClosedSignal({ time:'t2', status:'TP1', realizedR:1.5 }),
    ];
    syncPersistedHistory(signals);
    expect(persistedHistory.length).toBe(1);
    expect(persistedHistory[0].time).toBe('t2');
  });

  it('dedupe: sinyal dengan key yang sama (symbol|interval|time|side) tidak digandakan', () => {
    const s = makeClosedSignal({ time:'t1' });
    syncPersistedHistory([s]);
    syncPersistedHistory([s]); // sama persis, cycle "berikutnya" mem-backtest ulang window yang sama
    expect(persistedHistory.length).toBe(1);
  });

  it('persist lintas reload lewat localStorage (save -> reset in-memory -> load)', () => {
    syncPersistedHistory([makeClosedSignal({ time:'t1' })]);
    expect(persistedHistory.length).toBe(1);
    persistedHistory.length = 0; // simulasi reload: state in-memory hilang (TANPA localStorage.clear())
    expect(persistedHistory.length).toBe(0);
    loadPersistedHistory();
    expect(persistedHistory.length).toBe(1);
    expect(persistedHistory[0].time).toBe('t1');
  });

  it('normalizePersistedItem mengisi default aman untuk field yang belum ada (migrasi data lama)', () => {
    const old = { key:'k', symbol:'XAU/USD', interval:'15min', time:'t1', side:'LONG' };
    const n = normalizePersistedItem(old);
    expect(n.score).toBe(0);
    expect(n.realizedR).toBeNull();
    expect(n.hit).toEqual([false,false,false]);
    expect(n.structAligned).toBeNull(); // bukan false — dikecualikan dari learning, bukan dihitung "tidak searah"
  });

  it('getPersistedStats hanya menghitung pair+timeframe yang sedang aktif', () => {
    syncPersistedHistory([makeClosedSignal({ time:'t1', realizedR:2 })]);
    state.symbol = 'EUR/USD'; // pair lain
    syncPersistedHistory([makeClosedSignal({ time:'t2', realizedR:-5 })]);
    state.symbol = 'XAU/USD'; // kembali ke pair semula
    const stats = getPersistedStats(30);
    expect(stats.windowCount).toBe(1); // cuma trade XAU/USD yang dihitung, bukan EUR/USD yang -5R
    expect(stats.avgR).toBeCloseTo(2, 10);
  });

  it('cap MAX_PERSISTED: tidak membengkak tanpa batas', () => {
    const many = Array.from({length:1200}, (_,i)=> makeClosedSignal({ time:`t${i}`, side: i%2?'LONG':'SHORT' }));
    syncPersistedHistory(many);
    expect(persistedHistory.length).toBeLessThanOrEqual(1000);
  });
});

describe('history-store: skipped signals (hypothetical outcomes)', () => {
  beforeEach(() => {
    resetPersistedSkipped();
    state.symbol = 'XAU/USD';
    state.interval = '15min';
  });

  it('hanya menyimpan yang sudah resolve (hypotheticalR != null)', () => {
    const signals = [
      { time:'t1', side:'LONG', score:40, hypotheticalR:null },
      { time:'t2', side:'LONG', score:42, hypotheticalR:0.8 },
    ];
    syncPersistedSkipped(signals);
    const stats = getSkippedStats(50);
    expect(stats.windowCount).toBe(1);
  });

  it('getSkippedStats menghitung winRate & avgR dengan benar', () => {
    syncPersistedSkipped([
      { time:'t1', side:'LONG', score:40, hypotheticalR:1 },
      { time:'t2', side:'LONG', score:40, hypotheticalR:-1 },
      { time:'t3', side:'LONG', score:40, hypotheticalR:1 },
    ]);
    const stats = getSkippedStats(50);
    expect(stats.windowCount).toBe(3);
    expect(stats.winRate).toBeCloseTo(200/3, 5); // 2 dari 3 profit
    expect(stats.avgR).toBeCloseTo(1/3, 10);
  });
});
