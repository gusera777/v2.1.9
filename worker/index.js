/* ═══════════════════════════════════════════════════════════
   GUSERA SATS — Proxy Twelve Data (Cloudflare Worker)
   ─────────────────────────────────────────────────────────
   Menyembunyikan API key dari client sepenuhnya: app.js TIDAK PERNAH
   menyentuh key asli lagi, hanya memanggil endpoint Worker ini.
   Key disimpan sebagai secret (env var terenkripsi), bukan di source code.

   Endpoint: GET /api/candles?symbol=XAU/USD&interval=15min&outputsize=300
   Opsional: &apikey=... (kalau user mengisi key PRIBADI di ⚙ Pengaturan —
   dalam hal ini Worker melewati pool bawaan dan langsung pakai key itu).

   Setup:
     wrangler secret put TWELVEDATA_API_KEYS
     (isi: key1,key2,key3,key4,key5 — dipisah koma, tanpa spasi)
   Lihat README-worker.md untuk panduan deploy lengkap.
   ═══════════════════════════════════════════════════════════ */

const FETCH_TIMEOUT_MS = 15000;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders(env) });
    }

    if (url.pathname !== '/api/candles') {
      return jsonResponse({ error: 'Not found. Endpoint: /api/candles' }, 404, env);
    }
    if (request.method !== 'GET') {
      return jsonResponse({ error: 'Method not allowed, pakai GET.' }, 405, env);
    }

    const symbol = url.searchParams.get('symbol');
    const interval = url.searchParams.get('interval');
    const outputsize = url.searchParams.get('outputsize') || '300';
    const customKey = (url.searchParams.get('apikey') || '').trim();

    if (!symbol || !interval) {
      return jsonResponse({ error: 'Parameter symbol dan interval wajib diisi.' }, 400, env);
    }

    // Kalau user mengisi key pribadi, pool-nya cuma berisi key itu (tidak pakai
    // key server sama sekali untuk request ini). Kalau tidak, pakai pool server.
    const pool = customKey ? [customKey] : getServerKeyPool(env);
    if (pool.length === 0) {
      return jsonResponse({
        error: 'Server belum dikonfigurasi: env TWELVEDATA_API_KEYS kosong. Jalankan `wrangler secret put TWELVEDATA_API_KEYS` dulu, atau isi API key pribadi di aplikasi.'
      }, 500, env);
    }

    // Rotasi dimulai dari index terakhir yang terbukti jalan (disimpan di KV kalau
    // binding KEY_INDEX_KV ada). KV bersifat opsional — tanpa KV, Worker tetap
    // berfungsi penuh, cuma selalu mulai dari key #0 tiap request (key yang kena
    // limit tetap otomatis dilewati DALAM request yang sama, cuma tidak "diingat"
    // lintas request tanpa KV).
    let startIdx = 0;
    if (!customKey && env.KEY_INDEX_KV) {
      startIdx = await getStoredIndex(env, pool.length);
    }

    let lastErrMsg = null;
    for (let attempt = 0; attempt < pool.length; attempt++) {
      const idx = (startIdx + attempt) % pool.length;
      const result = await fetchTwelveData(symbol, interval, outputsize, pool[idx]);

      if (result.ok) {
        if (!customKey && env.KEY_INDEX_KV && idx !== startIdx) {
          ctx.waitUntil(setStoredIndex(env, idx));
        }
        return jsonResponse(result.data, 200, env, { 'X-Key-Index': String(idx), 'X-Key-Pool-Size': String(pool.length) });
      }

      lastErrMsg = result.error;
      if (!result.isRateLimit) {
        // Error permanen (symbol salah, format tak dikenal, dll) — key lain juga
        // pasti gagal dengan cara yang sama, jadi langsung dikembalikan ke client
        // tanpa membuang percobaan mencoba key lainnya.
        return jsonResponse({ error: result.error }, result.status || 502, env);
      }
      // isRateLimit -> lanjut coba key berikutnya di pool
    }

    return jsonResponse({
      error: `Semua ${pool.length} API key di server kena limit/quota. Coba lagi nanti. (Pesan terakhir: ${lastErrMsg || '-'})`
    }, 429, env);
  }
};

function getServerKeyPool(env) {
  return (env.TWELVEDATA_API_KEYS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

async function fetchTwelveData(symbol, interval, outputsize, apikey) {
  const upstreamUrl = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&outputsize=${encodeURIComponent(outputsize)}&apikey=${encodeURIComponent(apikey)}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(upstreamUrl, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (res.status >= 500) {
      return { ok: false, error: `Server Twelve Data bermasalah (HTTP ${res.status}).`, status: 502, isRateLimit: false };
    }
    const data = await res.json();
    if (data.status === 'error' || data.code) {
      const msg = data.message || 'API error dari Twelve Data.';
      const isRateLimit = res.status === 429 || data.code === 429 || /credit|limit|too many request/i.test(msg);
      return { ok: false, error: msg, status: isRateLimit ? 429 : (res.status || 400), isRateLimit };
    }
    return { ok: true, data };
  } catch (networkErr) {
    clearTimeout(timeoutId);
    const timedOut = networkErr.name === 'AbortError';
    return {
      ok: false,
      error: timedOut ? `Timeout menghubungi Twelve Data setelah ${FETCH_TIMEOUT_MS/1000}s.` : `Worker gagal terhubung ke Twelve Data (${networkErr.message}).`,
      status: 504,
      isRateLimit: false,
    };
  }
}

async function getStoredIndex(env, poolLen) {
  try {
    const v = await env.KEY_INDEX_KV.get('idx');
    const n = parseInt(v, 10);
    return (Number.isFinite(n) && n >= 0) ? (n % poolLen) : 0;
  } catch (e) { return 0; }
}
async function setStoredIndex(env, idx) {
  try { await env.KEY_INDEX_KV.put('idx', String(idx)); } catch (e) { /* KV opsional, abaikan kalau gagal */ }
}

function corsHeaders(env) {
  return {
    // Default "*" karena data yang dikembalikan (harga OHLC) bukan data sensitif
    // per-user — cukup aman dibuka untuk origin manapun. Kalau mau dibatasi hanya
    // ke domain GitHub Pages Anda, set env var ALLOWED_ORIGIN (lihat wrangler.toml).
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

function jsonResponse(obj, status, env, extraHeaders) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(env), ...(extraHeaders||{}) },
  });
}
