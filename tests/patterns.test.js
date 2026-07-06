import { describe, it, expect } from 'vitest';
import { detectCandlePattern, detectStructurePattern } from '../js/patterns.js';

/* ═══════════════════════════════════════════════════════════
   detectCandlePattern
   ═══════════════════════════════════════════════════════════ */
describe('detectCandlePattern', () => {
  it('mendeteksi Bullish Engulfing: bearish kecil lalu bullish yang menelan penuh body-nya', () => {
    const candles = [
      { open:100, high:101, low:98, close:99 },   // i-1: bearish
      { open:98.5, high:102, low:98, close:101 }, // i: bullish, body [98.5,101] menelan [99,100]
    ];
    expect(detectCandlePattern(candles, 1, true)).toBe('Bullish Engulfing');
    // Arah salah (isBuy=false) tidak boleh ikut mendeteksi pola bullish sebagai bearish
    expect(detectCandlePattern(candles, 1, false)).not.toBe('Bullish Engulfing');
  });

  it('mendeteksi Bearish Engulfing: bullish kecil lalu bearish yang menelan penuh body-nya', () => {
    const candles = [
      { open:99, high:101, low:98, close:100 },   // i-1: bullish
      { open:100.5, high:101, low:97, close:98.5 }, // i: bearish, menelan body sebelumnya
    ];
    expect(detectCandlePattern(candles, 1, false)).toBe('Bearish Engulfing');
  });

  it('TIDAK mendeteksi engulfing kalau body candle sekarang tidak menelan penuh body sebelumnya', () => {
    const candles = [
      { open:100, high:101, low:98, close:99 },  // i-1: bearish, body [99,100]
      { open:99.5, high:101, low:99, close:100 }, // i: bullish tapi open (99.5) > close sebelumnya (99)
    ];
    expect(detectCandlePattern(candles, 1, true)).toBeNull();
  });

  it('mendeteksi Hammer: body kecil di ujung atas range, lower wick panjang, upper wick minim', () => {
    const candles = [
      { open:100, high:100.2, low:95, close:99.9 },
      { open:99.8, high:99.92, low:95, close:99.9 }, // body 0.1, lowerWick 4.8, upperWick 0.02
    ];
    expect(detectCandlePattern(candles, 1, true)).toBe('Hammer');
  });

  it('TIDAK mendeteksi Hammer kalau upper wick terlalu panjang relatif body (bukan pin bar bawah yang bersih)', () => {
    const candles = [
      { open:100, high:100.2, low:95, close:99.9 },
      { open:99.8, high:100.5, low:95, close:99.9 }, // upperWick 0.6 jauh lebih besar dari body*0.5=0.05
    ];
    expect(detectCandlePattern(candles, 1, true)).toBeNull();
  });

  it('mendeteksi Shooting Star: body kecil di ujung bawah range, upper wick panjang, lower wick minim', () => {
    const candles = [
      { open:100, high:101, low:99.9, close:100.1 },
      { open:100.1, high:105, low:100.08, close:100.15 },
    ];
    expect(detectCandlePattern(candles, 1, false)).toBe('Shooting Star');
  });

  it('mengembalikan null untuk i=0 (tidak ada bar sebelumnya) atau i di luar jangkauan', () => {
    const candles = [{ open:100, high:101, low:99, close:100.5 }];
    expect(detectCandlePattern(candles, 0, true)).toBeNull();
    expect(detectCandlePattern(candles, 5, true)).toBeNull();
  });

  it('candle netral/kecil di tengah range tidak dilabeli pola apapun', () => {
    const candles = [
      { open:100, high:101, low:99, close:100.3 },
      { open:100.3, high:100.6, low:100.0, close:100.4 },
    ];
    expect(detectCandlePattern(candles, 1, true)).toBeNull();
    expect(detectCandlePattern(candles, 1, false)).toBeNull();
  });
});

/* ═══════════════════════════════════════════════════════════
   detectStructurePattern
   ═══════════════════════════════════════════════════════════ */
describe('detectStructurePattern', () => {
  it('mendeteksi Higher Low ketika pivot low terakhir lebih tinggi dari pivot sebelumnya & masih baru', () => {
    const pivLowHist = [{ idx:0, val:100 }, { idx:10, val:101 }];
    const res = detectStructurePattern({ pivHighHist:[], pivLowHist, effAtrAtI:1, i:15, isBuy:true, structLen:20 });
    expect(res).toBe('Higher Low');
  });

  it('mendeteksi Lower High ketika pivot high terakhir lebih rendah dari pivot sebelumnya & masih baru', () => {
    const pivHighHist = [{ idx:0, val:110 }, { idx:10, val:108 }];
    const res = detectStructurePattern({ pivHighHist, pivLowHist:[], effAtrAtI:1, i:15, isBuy:false, structLen:20 });
    expect(res).toBe('Lower High');
  });

  it('mendeteksi Double Bottom ketika dua pivot low berdekatan nilainya & terpisah >=5 bar', () => {
    const pivLowHist = [{ idx:0, val:100 }, { idx:8, val:100.1 }];
    const res = detectStructurePattern({ pivHighHist:[], pivLowHist, effAtrAtI:1, i:10, isBuy:true, structLen:20 });
    expect(res).toBe('Double Bottom');
  });

  it('mendeteksi Double Top ketika dua pivot high berdekatan nilainya & terpisah >=5 bar', () => {
    const pivHighHist = [{ idx:0, val:110 }, { idx:8, val:109.9 }];
    const res = detectStructurePattern({ pivHighHist, pivLowHist:[], effAtrAtI:1, i:10, isBuy:false, structLen:20 });
    expect(res).toBe('Double Top');
  });

  // BUG FIX yang diuji di sini: sebelum perbaikan, tidak ada batas kebaruan sama sekali —
  // pivot yang sudah sangat lama (jauh melebihi structLen) tetap dilaporkan sebagai Higher
  // Low/Lower High yang valid. Sekarang harus null kalau pivot terakhir sudah basi.
  it('TIDAK melaporkan Higher Low kalau pivot low terakhir sudah lebih basi dari structLen', () => {
    const pivLowHist = [{ idx:0, val:100 }, { idx:5, val:101 }];
    const res = detectStructurePattern({ pivHighHist:[], pivLowHist, effAtrAtI:1, i:40, isBuy:true, structLen:20 });
    expect(res).toBeNull();
  });

  it('TIDAK melaporkan Lower High kalau pivot high terakhir sudah lebih basi dari structLen', () => {
    const pivHighHist = [{ idx:0, val:110 }, { idx:5, val:108 }];
    const res = detectStructurePattern({ pivHighHist, pivLowHist:[], effAtrAtI:1, i:40, isBuy:false, structLen:20 });
    expect(res).toBeNull();
  });

  it('TIDAK melaporkan Double Bottom kalau pivot low terakhir sudah basi walau nilainya berdekatan', () => {
    const pivLowHist = [{ idx:0, val:100 }, { idx:8, val:100.1 }];
    const res = detectStructurePattern({ pivHighHist:[], pivLowHist, effAtrAtI:1, i:35, isBuy:true, structLen:20 });
    expect(res).toBeNull();
  });

  it('mengembalikan null kalau riwayat pivot belum cukup (<2 pivot)', () => {
    expect(detectStructurePattern({ pivHighHist:[], pivLowHist:[{idx:0,val:100}], effAtrAtI:1, i:5, isBuy:true, structLen:20 })).toBeNull();
    expect(detectStructurePattern({ pivHighHist:[], pivLowHist:[], effAtrAtI:1, i:5, isBuy:true, structLen:20 })).toBeNull();
  });
});
