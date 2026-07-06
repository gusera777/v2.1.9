/* ═══════════════════════════════════════════════════════════
   RETRY DENGAN EXPONENTIAL BACKOFF
   ─────────────────────────────────────────────────────────
   Dipakai khusus untuk error TRANSIENT (network putus, timeout, HTTP 5xx) —
   BUKAN untuk rate-limit/quota (kini sepenuhnya ditangani server-side oleh
   proxy Worker, lihat worker/index.js) dan BUKAN untuk error permanen (symbol
   salah, format data tidak dikenal, dll — mengulang error semacam itu cuma
   buang waktu karena hasilnya pasti sama).

   Sebuah error dianggap transient HANYA kalau eksplisit ditandai
   `err.isTransient = true` oleh pemanggilnya (lihat fetchCandlesRaw) — retry
   generik ini tidak menebak-nebak dari isi pesan error, supaya tidak salah
   mengulang error yang sebenarnya permanen. */
export async function withRetry(fn, opts){
  const { retries = 3, baseDelayMs = 500, maxDelayMs = 8000 } = opts || {};
  let lastErr;
  for(let attempt = 0; attempt <= retries; attempt++){
    try{
      return await fn();
    }catch(err){
      lastErr = err;
      if(!err.isTransient || attempt === retries) throw err;
      // exponential backoff + jitter (±25%) supaya beberapa client tidak retry serentak
      const rawDelay = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt));
      const delay = rawDelay * (0.75 + Math.random() * 0.5);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw lastErr; // tidak akan tercapai (loop di atas selalu throw/return), dijaga untuk kejelasan
}
