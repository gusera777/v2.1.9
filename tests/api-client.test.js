import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { state } from '../js/state.js';
import { isValidCandleRow, parseCsv, fetchCandles } from '../js/api-client.js';

describe('isValidCandleRow', () => {
  const good = { time:'t', open:10, high:12, low:9, close:11, volume:5 };
  it('candle valid diterima', () => expect(isValidCandleRow(good)).toBe(true));
  it('menolak kalau time kosong', () => expect(isValidCandleRow({...good, time:undefined})).toBe(false));
  it('menolak OHLC non-angka/NaN/Infinity', () => {
    expect(isValidCandleRow({...good, open:NaN})).toBe(false);
    expect(isValidCandleRow({...good, close:Infinity})).toBe(false);
    expect(isValidCandleRow({...good, high:'12'})).toBe(false); // string, bukan number
  });
  it('menolak OHLC <= 0', () => expect(isValidCandleRow({...good, low:0})).toBe(false));
  it('menolak volume negatif', () => expect(isValidCandleRow({...good, volume:-1})).toBe(false));
  it('menerima volume 0 (pair tanpa data volume)', () => expect(isValidCandleRow({...good, volume:0})).toBe(true));
  it('menolak kalau high < low', () => expect(isValidCandleRow({...good, high:5, low:9})).toBe(false));
  it('menolak kalau high tidak meng-cover open/close', () => expect(isValidCandleRow({...good, high:10.5})).toBe(false));
  it('menolak kalau low tidak meng-cover open/close', () => expect(isValidCandleRow({...good, low:10.5})).toBe(false));
});

describe('parseCsv', () => {
  it('parse baris valid dengan benar (time,open,high,low,close,volume)', () => {
    const csv = '2026-01-01,10,12,9,11,100\n2026-01-02,11,13,10,12,120';
    const { candles, skipped } = parseCsv(csv);
    expect(candles.length).toBe(2);
    expect(skipped).toBe(0);
    expect(candles[0]).toMatchObject({ time:'2026-01-01', open:10, high:12, low:9, close:11, volume:100 });
  });
  it('baris tanpa volume -> default 0, tetap valid', () => {
    const csv = '2026-01-01,10,12,9,11';
    const { candles } = parseCsv(csv);
    expect(candles[0].volume).toBe(0);
  });
  it('baris rusak (kolom kurang / OHLC tidak valid) dilewati, bukan bikin seluruh parse gagal', () => {
    const csv = [
      '2026-01-01,10,12,9,11,100',   // valid
      '2026-01-02,bad,data',          // kolom kurang
      '2026-01-03,10,5,9,11,100',     // high < open (tidak valid)
      '2026-01-04,11,13,10,12,120',  // valid
    ].join('\n');
    const { candles, skipped, skippedLines } = parseCsv(csv);
    expect(candles.length).toBe(2);
    expect(skipped).toBe(2);
    expect(skippedLines).toEqual([2,3]);
  });
  it('semua baris rusak -> throw error yang jelas', () => {
    expect(() => parseCsv('bukan,csv,valid')).toThrow(/Tidak ada baris valid/);
  });
  it('baris kosong/whitespace diabaikan tanpa dianggap rusak', () => {
    const csv = '2026-01-01,10,12,9,11,100\n\n   \n2026-01-02,11,13,10,12,120';
    const { candles, skipped } = parseCsv(csv);
    expect(candles.length).toBe(2);
    expect(skipped).toBe(0);
  });
});

describe('fetchCandles (dengan fetch di-mock)', () => {
  const origFetch = global.fetch;
  afterEach(() => { global.fetch = origFetch; });
  beforeEach(() => { state.apiKey = ''; state.symbol='XAU/USD'; state.interval='15min'; state.outputSize=300; });

  it('memanggil PROXY_BASE_URL, tidak pernah api.twelvedata.com langsung, tidak mengirim apikey kalau kosong', async () => {
    let calledUrl = null;
    global.fetch = async (url) => {
      calledUrl = url;
      return { status:200, json: async () => ({ values: [
        { datetime:'2026-01-01 00:00:00', open:'1', high:'2', low:'0.5', close:'1.5', volume:'10' },
      ]}) };
    };
    const candles = await fetchCandles();
    expect(candles.length).toBe(1);
    expect(calledUrl.includes('twelvedata.com')).toBe(false);
    expect(calledUrl.includes('apikey=')).toBe(false);
  });

  it('key pribadi (state.apiKey) dikirim sebagai query param ke proxy', async () => {
    let calledUrl = null;
    state.apiKey = 'my-personal-key';
    global.fetch = async (url) => { calledUrl = url; return { status:200, json: async () => ({ values: [
      { datetime:'2026-01-01 00:00:00', open:'1', high:'2', low:'0.5', close:'1.5', volume:'10' },
    ] }) }; };
    await fetchCandles();
    expect(calledUrl.includes('apikey=my-personal-key')).toBe(true);
  });

  it('proxy mengembalikan {error:...} -> throw dengan pesan tsb (bukan retry, bukan rotasi)', async () => {
    let calls = 0;
    global.fetch = async () => { calls++; return { status:429, json: async () => ({ error:'Semua key server kena limit' }) }; };
    await expect(fetchCandles()).rejects.toThrow('Semua key server kena limit');
    expect(calls).toBe(1); // error dari proxy bukan transient -> tidak diretry
  });

  it('network gagal beberapa kali lalu sukses -> withRetry menyelamatkan (transient)', async () => {
    let calls = 0;
    global.fetch = async () => {
      calls++;
      if(calls<3) throw new TypeError('fetch failed');
      return { status:200, json: async () => ({ values: [
        { datetime:'2026-01-01 00:00:00', open:'1', high:'2', low:'0.5', close:'1.5', volume:'10' },
      ]}) };
    };
    const candles = await fetchCandles();
    expect(candles.length).toBe(1);
    expect(calls).toBe(3);
  });
});
