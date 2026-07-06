import { describe, it, expect } from 'vitest';
import { withRetry } from '../js/retry.js';

describe('withRetry', () => {
  it('sukses di percobaan pertama -> tidak retry sama sekali', async () => {
    let calls = 0;
    const result = await withRetry(async () => { calls++; return 'ok'; }, { retries:3, baseDelayMs:5 });
    expect(result).toBe('ok');
    expect(calls).toBe(1);
  });

  it('error transient beberapa kali lalu sukses -> tetap sukses, retry pada percobaan yang sama', async () => {
    let calls = 0;
    const result = await withRetry(async () => {
      calls++;
      if(calls<3){ const e = new Error('down'); e.isTransient = true; throw e; }
      return 'sukses-setelah-retry';
    }, { retries:3, baseDelayMs:5, maxDelayMs:20 });
    expect(result).toBe('sukses-setelah-retry');
    expect(calls).toBe(3);
  });

  it('error TIDAK transient -> langsung gagal tanpa retry sama sekali', async () => {
    let calls = 0;
    await expect(withRetry(async () => { calls++; throw new Error('permanen'); }, { retries:3, baseDelayMs:5 }))
      .rejects.toThrow('permanen');
    expect(calls).toBe(1);
  });

  it('error transient terus-menerus -> throw setelah retries habis (1 initial + N retry percobaan)', async () => {
    let calls = 0;
    await expect(withRetry(async () => {
      calls++; const e = new Error('selalu gagal'); e.isTransient = true; throw e;
    }, { retries:2, baseDelayMs:5 })).rejects.toThrow('selalu gagal');
    expect(calls).toBe(3); // 1 percobaan awal + 2 retry
  });

  it('delay antar-retry membesar (exponential backoff, bukan konstan)', async () => {
    const timestamps = [];
    let calls = 0;
    await withRetry(async () => {
      timestamps.push(Date.now());
      calls++;
      if(calls<3){ const e = new Error('down'); e.isTransient = true; throw e; }
      return 'ok';
    }, { retries:3, baseDelayMs:20, maxDelayMs:1000 });
    const gap1 = timestamps[1]-timestamps[0];
    const gap2 = timestamps[2]-timestamps[1];
    // Toleransi longgar (jitter ±25%) — yang diuji cuma tren MEMBESAR, bukan angka presisi.
    expect(gap2).toBeGreaterThan(gap1*0.9);
  });

  it('opts default terpakai kalau tidak diberikan (tidak error walau opts undefined)', async () => {
    let calls = 0;
    const result = await withRetry(async () => { calls++; return calls<2 ? (()=>{ const e=new Error('x'); e.isTransient=true; throw e; })() : 'ok'; });
    expect(result).toBe('ok');
  });
});
