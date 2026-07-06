import { describe, it, expect } from 'vitest';
import { clamp, safeDiv, mapClamp, presetParams, tfToMinutes } from '../js/utils.js';

describe('clamp', () => {
  it('nilai di dalam rentang dikembalikan apa adanya', () => expect(clamp(5,0,10)).toBe(5));
  it('nilai di bawah lo dipotong ke lo', () => expect(clamp(-5,0,10)).toBe(0));
  it('nilai di atas hi dipotong ke hi', () => expect(clamp(50,0,10)).toBe(10));
});

describe('safeDiv', () => {
  it('pembagian normal', () => expect(safeDiv(10,2,999)).toBe(5));
  it('pembagi 0 -> fallback', () => expect(safeDiv(10,0,999)).toBe(999));
  it('pembagi Infinity/NaN -> fallback', () => {
    expect(safeDiv(10,Infinity,999)).toBe(999);
    expect(safeDiv(10,NaN,999)).toBe(999);
  });
});

describe('mapClamp', () => {
  it('interpolasi linear di tengah range', () => expect(mapClamp(5,0,10,0,100)).toBeCloseTo(50,10));
  it('di luar range input di-clamp ke ujung output', () => {
    expect(mapClamp(-5,0,10,0,100)).toBeCloseTo(0,10);
    expect(mapClamp(50,0,10,0,100)).toBeCloseTo(100,10);
  });
  it('inHi===inLo -> tidak divide-by-zero, kembalikan outLo', () => {
    expect(mapClamp(5,3,3,10,20)).toBe(10);
  });
  it('mendukung output terbalik (outLo > outHi) untuk inverse mapping', () => {
    expect(mapClamp(0,0,10,100,0)).toBeCloseTo(100,10);
    expect(mapClamp(10,0,10,100,0)).toBeCloseTo(0,10);
  });
});

describe('presetParams', () => {
  it('preset tetap (Scalping/Default/Swing/Custom) mengembalikan parameter tabelnya', () => {
    expect(presetParams('Swing', 15)).toMatchObject({ resolved:'Swing', atrLen:21, baseMult:2.5, erLen:30, rsiLen:21, slMult:2.0 });
  });
  it('Auto dengan timeframe pendek (<=5 menit) -> resolve ke Scalping', () => {
    expect(presetParams('Auto', 5).resolved).toBe('Scalping');
    expect(presetParams('Auto', 1).resolved).toBe('Scalping');
  });
  it('Auto dengan timeframe menengah (<=240 menit) -> resolve ke Default', () => {
    expect(presetParams('Auto', 15).resolved).toBe('Default');
    expect(presetParams('Auto', 240).resolved).toBe('Default');
  });
  it('Auto dengan timeframe panjang (>240 menit) -> resolve ke Swing', () => {
    expect(presetParams('Auto', 1440).resolved).toBe('Swing');
  });
});

describe('tfToMinutes', () => {
  it('memetakan semua interval yang dikenal dengan benar', () => {
    expect(tfToMinutes('1min')).toBe(1);
    expect(tfToMinutes('5min')).toBe(5);
    expect(tfToMinutes('15min')).toBe(15);
    expect(tfToMinutes('30min')).toBe(30);
    expect(tfToMinutes('1h')).toBe(60);
    expect(tfToMinutes('4h')).toBe(240);
    expect(tfToMinutes('1day')).toBe(1440);
  });
  it('interval tak dikenal -> fallback 15', () => {
    expect(tfToMinutes('bukan-interval-valid')).toBe(15);
  });
});
