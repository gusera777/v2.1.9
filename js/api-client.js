import { state } from './state.js';
import { withRetry } from './retry.js';
import { PROXY_BASE_URL } from './proxy-config.js';

/* ═══════════════════════════════════════════════════════════
   DATA FETCH — lewat proxy Worker (lihat worker/index.js)
   ─────────────────────────────────────────────────────────
   API key TIDAK PERNAH ada di bundle client lagi. Rotasi antar-key sekarang
   ditangani server-side oleh Worker (lihat komentar di sana) — client cukup
   memanggil satu endpoint dan tidak perlu tahu apa-apa soal pool key.
   Kalau user mengisi API key PRIBADI di ⚙ Pengaturan, dikirim sebagai query
   param `apikey` ke Worker milik sendiri (bukan ke Twelve Data langsung) —
   Worker yang akan memakainya menggantikan pool server untuk request itu.
   ═══════════════════════════════════════════════════════════ */

/* A candle row is only usable if OHLC are finite numbers, all positive,
   and high/low actually bound open & close. Volume is optional (defaults
   to 0 for pairs with no volume data) but must be a finite, non-negative
   number when present. Bad rows are dropped rather than silently turned
   into NaN, which would otherwise poison every downstream indicator
   (EMA/ATR/RSI/etc. all propagate NaN forward once it appears). */
export function isValidCandleRow(c){
  if(!c || !c.time) return false;
  const ohlc = [c.open, c.high, c.low, c.close];
  if(ohlc.some(v => typeof v!=='number' || !isFinite(v) || v<=0)) return false;
  if(!isFinite(c.volume) || c.volume<0) return false; // already normalized to 0 by caller when unparsable
  if(c.high < c.low) return false;
  if(c.high < c.open || c.high < c.close) return false;
  if(c.low > c.open || c.low > c.close) return false;
  return true;
}

const FETCH_TIMEOUT_MS = 15000;

export async function fetchCandlesRaw(symbol, interval, outputSize, customApiKey){
  const params = new URLSearchParams({ symbol, interval, outputsize: String(outputSize) });
  if(customApiKey) params.set('apikey', customApiKey); // opsional, lihat komentar di atas
  const url = `${PROXY_BASE_URL}/api/candles?${params.toString()}`;

  // Timeout eksplisit — sama seperti sebelumnya, cuma sekarang untuk koneksi ke
  // Worker milik sendiri, bukan langsung ke Twelve Data.
  const controller = new AbortController();
  const timeoutId = setTimeout(()=> controller.abort(), FETCH_TIMEOUT_MS);
  let res;
  try{
    res = await fetch(url, { signal: controller.signal });
  }catch(networkErr){
    clearTimeout(timeoutId);
    const timedOut = networkErr.name==='AbortError';
    const err = new Error(timedOut
      ? `Request ke proxy timeout setelah ${FETCH_TIMEOUT_MS/1000} detik.`
      : `Gagal terhubung ke proxy server (${networkErr.message}). Cek PROXY_BASE_URL di js/proxy-config.js sudah benar & Worker sudah di-deploy.`);
    err.isTransient = true;
    throw err;
  }
  clearTimeout(timeoutId);

  if(res.status>=500){
    // 502/504 dari Worker berarti Twelve Data sendiri yang bermasalah (lihat
    // worker/index.js) — transient, layak di-retry oleh withRetry.
    const err = new Error(`Proxy/Twelve Data bermasalah (HTTP ${res.status}).`);
    err.isTransient = true;
    throw err;
  }

  const json = await res.json();
  if(json.error){
    // 429 dari Worker berarti SEMUA key server sudah kena limit — bukan sesuatu
    // yang bisa diperbaiki dengan retry di sisi client, jadi tidak ditandai
    // transient (rotasi key sekarang murni urusan server, lihat worker/index.js).
    throw new Error(json.error);
  }
  if(!json.values) throw new Error('Format data tidak dikenal dari proxy.');
  const rawCount = json.values.length;
  const candles = json.values.map(v=>{
    const vol = parseFloat(v.volume||0);
    return { time: v.datetime, open:parseFloat(v.open), high:parseFloat(v.high), low:parseFloat(v.low),
      close:parseFloat(v.close), volume: isFinite(vol) ? vol : 0 };
  }).filter(isValidCandleRow).reverse();
  const dropped = rawCount - candles.length;
  if(dropped>0) console.warn(`fetchCandlesRaw(${symbol} ${interval}): ${dropped} baris tidak valid dari API dilewati (dari ${rawCount} total).`);
  if(candles.length===0) throw new Error('Semua data dari API tidak valid (OHLC kosong/rusak).');
  return candles;
}

export async function fetchCandles(){
  // withRetry menangani gangguan TRANSIENT (network ke Worker/timeout/5xx) dengan
  // backoff — terpisah dari urusan rate-limit/rotasi key yang kini sepenuhnya
  // ditangani server-side dalam satu panggilan Worker (lihat worker/index.js).
  return withRetry(
    () => fetchCandlesRaw(state.symbol, state.interval, state.outputSize, state.apiKey),
    { retries: 3, baseDelayMs: 500 }
  );
}

export function parseCsv(text){
  const lines = text.trim().split('\n').map(l=>l.trim()).filter(Boolean);
  const candles = [];
  const badLines = [];
  lines.forEach((line, idx)=>{
    const parts = line.split(',').map(s=>s.trim());
    if(parts.length<5){ badLines.push(idx+1); return; }
    const [time,open,high,low,close,volume] = parts;
    const volParsed = parseFloat(volume||0);
    const c = {time, open:parseFloat(open), high:parseFloat(high), low:parseFloat(low), close:parseFloat(close), volume: isFinite(volParsed) ? volParsed : 0};
    if(isValidCandleRow(c)) candles.push(c); else badLines.push(idx+1);
  });
  if(candles.length===0){
    throw new Error('Tidak ada baris valid. Cek format: time,open,high,low,close,volume — dan pastikan OHLC berupa angka positif dengan high ≥ open/close ≥ low.');
  }
  if(badLines.length>0){
    const shown = badLines.slice(0,10).join(', ') + (badLines.length>10 ? `, +${badLines.length-10} lagi` : '');
    console.warn(`parseCsv: ${badLines.length} baris dilewati (baris ke-${shown}).`);
  }
  return { candles, skipped: badLines.length, skippedLines: badLines };
}
