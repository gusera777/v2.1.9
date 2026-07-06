# Struktur Modul — GUSERA SATS

`app.js` (2.292 baris, satu file) dipecah jadi 16 modul ES (`<script type="module">`,
tanpa bundler/build-step — jalan langsung di browser modern & tetap kompatibel
dengan hosting statis seperti GitHub Pages). **Tidak ada perubahan logika** kecuali
satu hal: `lastResult` (dulu variabel module-level yang di-reassign bebas) sekarang
diakses lewat `getLastResult()` / `setLastResult()` di `state.js`, karena binding
`let` yang di-export dari sebuah modul ES hanya boleh di-reassign oleh modul itu
sendiri.

## Peta modul

```
js/
├── constants.js       CONST (skor maksimum, bobot pattern)
├── api-key-pool.js    API_KEY_POOL bawaan, DEFAULT_API_KEY
├── state.js           state{} singleton (mutable) + getLastResult/setLastResult
├── utils.js           clamp, safeDiv, mapClamp, presetParams, tfToMinutes
├── indicators.js      rma, smaArr, rsiArr, efficiencyRatioArr, pivot/rolling — PURE, tidak
│                      bergantung apa pun selain utils.js
├── self-learning.js   computeAdaptiveThreshold, computeTrendWeights, weightedTradeStats
├── history-store.js   persistedHistory/persistedSkipped (localStorage) + stats
├── engine.js           computeEngine() — PURE (candles,cfg) -> hasil, tidak sentuh DOM
├── api-client.js       fetchCandles, fetchWithKeyRotation, parseCsv (Twelve Data + CSV)
├── alerts.js           beep(), notify()
├── ui/
│   ├── dom-helpers.js  setStatus, setModalStatus, setConn, fmtPrice
│   ├── charts.js       drawGauge, drawSparkline, drawChart (canvas)
│   ├── ai-insight.js   calculateAIInsight, updateAIUI
│   ├── profile.js      updateProfilePanel
│   └── render.js       renderAll, renderLog, historyRows, updateAIInsightCard
└── main.js             ENTRY POINT — runCycle/processAndRender (main loop),
                         semua wiring event listener tombol/tab/form, toast,
                         download CSV, reset, init awal. Di-load index.html via
                         <script type="module" src="js/main.js">.
```

## Kenapa batasnya di situ

- **`engine.js` dan `indicators.js` murni** (input → output, tanpa `state`/DOM) —
  ini yang membuatnya bisa di-unit-test langsung tanpa mocking browser sama sekali
  (lihat rencana poin 5 — unit test — berikutnya).
- **`history-store.js` ⇄ `self-learning.js` saling import (circular)**: yang satu
  butuh `weightedTradeStats`, yang satu lagi butuh `persistedHistory`/`getPersistedStats`.
  Ini AMAN di ES modules selama binding yang diimpor hanya dipakai di dalam *body*
  fungsi (bukan saat modul dievaluasi) — sudah begitu adanya di kode asli, sudah
  diverifikasi jalan (lihat bagian Verifikasi di bawah).
- **`main.js`** sengaja jadi satu-satunya tempat yang "kotor" (DOM wiring, event
  listener, `document.getElementById` di mana-mana) — supaya modul lain tetap bersih
  dan gampang ditest.

## Cara menjalankan secara lokal

Karena sekarang pakai ES modules (`import`/`export`), **tidak bisa dibuka langsung
dari `file://`** (browser modern memblokir `import` module dari filesystem karena
CORS). Jalankan lewat server statis lokal, contoh:

```bash
cd gusera-sats
python3 -m http.server 8000
# atau: npx serve .
```

lalu buka `http://localhost:8000`. Deploy ke GitHub Pages/Netlify/Vercel/Cloudflare
Pages tetap berfungsi normal tanpa perubahan apa pun (server HTTP asli tidak
kena masalah CORS `file://` ini).

## Verifikasi yang sudah dilakukan

1. `node --check` pada ke-16 file — semua valid secara sintaks.
2. Setiap modul (kecuali `main.js`, yang isinya wiring DOM dan memang hanya jalan
   di browser) berhasil di-`import()` di Node tanpa error resolusi — termasuk
   pasangan circular import di atas.
3. `computeEngine()` dijalankan end-to-end dengan 300 candle sintetis (random walk)
   lewat Node — tidak ada exception, dan hasilnya (TQI, sinyal, stats, threshold,
   trend status) terlihat masuk akal.
4. Diff line-by-line (multiset, mengabaikan urutan) antara `app.js` asli vs semua
   modul hasil pecahan — **nol baris logika yang hilang/berubah**, satu-satunya
   selisih adalah 10 baris `lastResult` yang direwrite jadi `getLastResult()`/
   `setLastResult()` (diinventarisir manual, bukan cuma dipercaya begitu saja) dan
   komentar dokumentasi baru.

## Update: Optimasi incremental — rolling window (poin 4, versi aman, sudah dikerjakan)

`js/indicators.js` — `rollingHighest`/`rollingLowest` diganti dari brute-force
`Math.max(...arr.slice(...))` per elemen (**O(n·len)**) jadi **sliding-window
monotonic deque (O(n) total)**. Ini fungsi yang paling jelas boros di
`computeEngine` — dipanggil setiap cycle refresh untuk cari support/resistance
window, padahal biasanya cuma 1 candle baru yang masuk.

Semantik output **identik 100%** dengan versi lama (window `[max(0,i-len+1), i]`
inklusif) — bukan sekadar diasumsikan, tapi diverifikasi brute-force terhadap
implementasi lama di 56 kombinasi ukuran-array × panjang-window, plus edge case
array kosong dan array isi sama semua (tie).

**Benchmark (Node, sebelum vs sesudah):**

| n (jumlah candle) | len (window) | Sebelum | Sesudah | Speedup |
|---|---|---|---|---|
| 300 | 50 | 12.2 ms /50x-run | 4.2 ms | 2.9× |
| 300 | 200 | 23.8 ms /50x-run | 0.2 ms | **113.6×** |
| 2000 | 200 | 180.2 ms /50x-run | 1.0 ms | **173.1×** |
| 5000 | 500 | 1241.6 ms /50x-run | 4.2 ms | **292.9×** |

Speedup membesar drastis seiring window makin lebar — persis sesuai prediksi
O(n·len) vs O(n). Untuk `outputSize` default 300 dengan window lookback khas
(struktur/pivot, biasanya puluhan-ratusan bar), ini bukan lagi pekerjaan yang
percuma diulang tiap cycle.

**Catatan soal cakupan:** ini BARU rolling window (bagian yang aman & murni
menang tanpa risiko akurasi). Caching penuh seluruh `computeEngine` antar-cycle
(supaya cuma bar baru yang dihitung, bukan seluruh array dari awal) BELUM
dikerjakan — itu perlu desain state machine terpisah karena self-learning
(`computeAdaptiveThreshold`) tidak murni fungsi dari candle terakhir saja,
sesuai catatan risiko di evaluasi awal.

Diregresi-test: `computeEngine()` end-to-end dengan 300 candle sintetis setelah
perubahan — hasil tetap masuk akal, tidak ada exception.


Sesuai rencana bertahap sebelumnya — modularisasi ini murni pemindahan kode, tanpa
mengubah perilaku. Poin 2 (proxy API key), poin 4 (incremental computation), dan
poin 5 (unit test framework) masih menunggu giliran.

## Update: Error handling & retry (poin 3, sudah dikerjakan)

`js/retry.js` (baru) — `withRetry(fn, {retries, baseDelayMs, maxDelayMs})`: generic
exponential-backoff+jitter, HANYA mengulang error yang eksplisit ditandai
`err.isTransient = true` (tidak menebak dari isi pesan error).

`js/api-client.js` — `fetchCandlesRaw`:
- Ditambah `AbortController` + timeout 15 detik (`FETCH_TIMEOUT_MS`) — sebelumnya
  fetch bisa menggantung tanpa batas.
- Network gagal / timeout / HTTP 5xx sekarang ditandai `isTransient=true`.
- Error rate-limit (429/quota) & error permanen (symbol salah, format tak dikenal)
  TIDAK ditandai transient — perilakunya persis seperti sebelumnya (rate-limit →
  rotasi key di `fetchWithKeyRotation`; error permanen → langsung gagal).

`js/api-client.js` — `fetchWithKeyRotation`: setiap percobaan per-key sekarang
dibungkus `withRetry` (3x percobaan, backoff mulai 500ms) — retry transient terjadi
DI KEY YANG SAMA dulu sebelum keputusan rotasi/gagal yang sudah ada diambil.

`js/main.js` — `runCycle`: pesan error yang ditampilkan ke UI sekarang membedakan
transient (menyarankan cek koneksi, catatan "sudah dicoba ulang otomatis") vs
rate-limit vs error permanen.

**Sudah diverifikasi** (Node, lihat riwayat percakapan untuk skrip lengkapnya):
1. `withRetry` diuji 3 skenario: transient→sukses (retry jalan), non-transient
   (tidak diulang sama sekali), transient terus gagal (throw setelah retries habis).
2. `fetchWithKeyRotation` diuji dengan `fetch` yang di-mock: error transient tetap
   di key yang sama (tidak percuma rotasi), error rate-limit tetap rotasi ke key
   berikutnya seperti semula.


## Sisa dari evaluasi awal (belum dikerjakan)

- **Poin 4 — caching penuh `computeEngine` antar-cycle:** rolling window sudah
  O(n), tapi seluruh `computeEngine` masih dihitung ulang dari awal tiap cycle.
  Perlu desain state machine terpisah (lihat catatan risiko di atas).

## Update: API key dipindah ke proxy/backend (poin 2, sudah dikerjakan)

**Baru:** `worker/index.js` — Cloudflare Worker yang jadi satu-satunya pihak yang
tahu API key asli. Key disimpan sebagai *secret* terenkripsi
(`wrangler secret put TWELVEDATA_API_KEYS`), TIDAK PERNAH ada di source code
yang dikirim ke browser. Panduan deploy lengkap: `worker/README-worker.md`.

Rotasi antar-key (yang dulu di client, `fetchWithKeyRotation`) sekarang
sepenuhnya berjalan di server: Worker mencoba tiap key di pool secara
berurutan, cuma pindah key kalau memang rate-limit (429/quota) — persis
logika yang sama, cuma pindah tempat. Opsional: index key terakhir yang
terbukti jalan bisa disimpan lintas-request via Workers KV (lihat komentar di
`wrangler.toml`) — tanpa KV pun tetap 100% berfungsi.

**Client (`js/api-client.js`, ditulis ulang):** sekarang cuma memanggil
`{PROXY_BASE_URL}/api/candles?...` — tidak pernah menyentuh API key Twelve
Data lagi. `js/api-key-pool.js` (5 key bawaan) **dihapus sepenuhnya** dari
client. `state.apiKeyIndex`/`apiKeyPoolSize` juga dihapus (tidak relevan lagi
karena rotasi bukan urusan client). `state.apiKey` sekarang murni untuk fitur
opsional "key pribadi" — kalau diisi, dikirim ke Worker **milik sendiri**
sebagai query param, BUKAN ke Twelve Data langsung, dan Worker akan memakainya
menggantikan pool server untuk request itu.

**File baru:** `js/proxy-config.js` — satu baris `PROXY_BASE_URL` yang WAJIB
diisi user setelah deploy Worker-nya (lihat `worker/README-worker.md` langkah
5). Ini satu-satunya perubahan manual yang diperlukan di sisi client.

**UI (`js/main.js`):** status "Key N/M aktif" (yang menyiratkan index pool
client-side) diganti jadi status mode saja — "Pakai proxy server" atau "Pakai
key pribadi" — karena client memang tidak lagi tahu key mana yang dipakai di
server.

**Sudah diverifikasi** (Node, bukan cuma dibaca kodenya):
1. Worker diuji 7 skenario langsung lewat handler `fetch()`-nya (dengan
   `fetch` upstream di-mock): sukses langsung, rotasi otomatis saat 2 key
   pertama kena limit, semua key habis → 429 dengan pesan gabungan, error
   permanen → langsung gagal TANPA mencoba key lain, key pribadi melewati pool
   server, env kosong → pesan error jelas, CORS preflight.
2. Client (`fetchCandles`) diuji dengan `fetch` di-mock: URL yang dipanggil
   TIDAK PERNAH mengandung `apikey=` di mode default, dan TIDAK PERNAH memanggil
   `api.twelvedata.com` langsung (selalu lewat `PROXY_BASE_URL`) — sekaligus
   memverifikasi bahwa opsi key pribadi tetap terkirim dengan benar saat diisi.
3. Regresi penuh: `computeEngine()` end-to-end masih jalan normal setelah
   seluruh perubahan ini (tidak ada bagian engine yang tersentuh).
4. Sweep `grep` di seluruh `js/` — dipastikan nol key literal atau referensi ke
   pool/index lama yang tersisa.

**Konsekuensi yang perlu diketahui:** aplikasi sekarang butuh Worker yang
sudah di-deploy dan `PROXY_BASE_URL` yang benar supaya bisa fetch data live —
kalau belum deploy, `runCycle` akan gagal dengan pesan yang mengarahkan ke
pengecekan `js/proxy-config.js` (mode CSV tetap berfungsi tanpa proxy sama
sekali, karena tidak butuh network).

## Update: Unit test formal (poin 5, sudah dikerjakan)

**Vitest** dipilih (ringan, konfigurasi minimal, native ESM — cocok untuk
proyek tanpa build step ini). Test HANYA mengimpor modul asli (`js/*.js`),
tidak ada logic yang disalin ulang ke dalam test — kalau modul aslinya
berubah, test langsung memverifikasi kode yang sebenarnya jalan di browser.

**Cara menjalankan:**
```bash
npm install   # sekali saja, install Vitest sebagai devDependency
npm test      # jalankan seluruh suite
```

**Cakupan — 107 test di 7 file:**

| File test | Yang diuji | Jumlah |
|---|---|---|
| `tests/indicators.test.js` | `trueRangeArr`, `rma`, `smaArr`, `efficiencyRatioArr`, `rsiArr`, `rollingHighest/Lowest`, `pivotHighArr/pivotLowArr` | 22 |
| `tests/self-learning.test.js` | `weightForConfluence/Magnitude`, `computeTrendWeights`, `weightedTradeStats`, `computeAdaptiveThreshold` | 18 |
| `tests/engine.test.js` | `computeEngine` (invariant lintas-seed, regime uptrend, snapshot regresi, konfigurasi) | 18 |
| `tests/api-client.test.js` | `isValidCandleRow`, `parseCsv`, `fetchCandles` (fetch di-mock) | 18 |
| `tests/history-store.test.js` | Persistensi riwayat trade & sinyal terlewat (localStorage di-polyfill) | 9 |
| `tests/utils.test.js` | `clamp`, `safeDiv`, `mapClamp`, `presetParams`, `tfToMinutes` | 16 |
| `tests/retry.test.js` | `withRetry` (transient vs permanen, backoff membesar) | 6 |

**Strategi pengujian per jenis modul** (karena tidak semua modul cocok diuji
dengan cara yang sama):

- **`indicators.js` (fungsi matematis murni):** differential testing —
  `rollingHighest/Lowest` dan `rsiArr` diuji terhadap implementasi REFERENSI
  independen yang ditulis ulang dari nol di dalam test (bukan menyalin logika
  sumbernya), di banyak seed & ukuran array. Ini menangkap bug yang tidak
  akan ketahuan dari satu contoh hardcoded saja.
- **`self-learning.js` + `history-store.js` (ada circular import):** diuji
  BERSAMA lewat `history-store.test.js` & `self-learning.test.js` yang saling
  memanggil fungsi satu sama lain persis seperti dipakai aslinya — memverifikasi
  bahwa circular import ES modules-nya memang aman di praktik, bukan cuma di teori.
- **`engine.js` (`computeEngine`, stateful backtest loop besar):** TIDAK
  realistis dibuat fixture "tangan" yang presisi 100% (band ATR, adaptive
  multiplier, dan TQI saling memengaruhi lewat banyak lapisan smoothing) —
  jadi dipakai 3 strategi berlapis:
  1. **Invariant/property test** lintas banyak seed & ukuran (30/100/300 bar):
     memverifikasi kontrak yang WAJIB selalu benar (semua array panjangnya n,
     TQI selalu di [0,1], SL/TP selalu di sisi yang benar relatif entry,
     realizedR selalu dalam rentang valid, dll) — tidak peduli angka
     pastinya, kalau kontraknya dilanggar di seed manapun, test gagal.
  2. **Skenario regime**: candle rally kuat & berkelanjutan HARUS memicu
     minimal satu sinyal BUY di setidaknya satu dari beberapa seed — menguji
     bahwa mekanisme flip+threshold memang bisa menghasilkan sinyal nyata,
     bukan cuma "tidak crash".
  3. **Snapshot regresi**: satu fixture+seed tetap, hasilnya "dibekukan" jadi
     baseline — bukan klaim "angka ini benar secara trading", tapi supaya
     perubahan tak sengaja di `engine.js`/`indicators.js`/`self-learning.js`
     nanti langsung ketahuan, bukan lolos diam-diam.
- **`api-client.js` (ada network):** `isValidCandleRow`/`parseCsv` diuji
  langsung (pure). `fetchCandles` diuji dengan `fetch` di-mock — memverifikasi
  URL yang dipanggil selalu ke proxy (bukan Twelve Data langsung), key tidak
  pernah terkirim di mode default, dan retry transient benar-benar jalan.
- **`history-store.js` (localStorage):** `tests/setup.js` menyediakan
  polyfill `localStorage` in-memory yang di-reset BERSIH sebelum tiap test
  (`beforeEach`), supaya test tidak saling bocor state satu sama lain.

**Yang sengaja TIDAK diuji secara terisolasi:** fungsi internal `computeEngine`
yang tidak di-export (`scoreBreakdown`, `detectCandlePattern`, `openTrade`,
`closeCurrentTrade`, dll) — ini murni detail implementasi, diuji secara
TIDAK LANGSUNG lewat perilaku `computeEngine` yang teramati di atas. Modul
`ui/*.js` juga tidak diuji (butuh DOM/canvas asli, nilainya lebih kecil
dibanding effort mocking-nya untuk skala proyek ini).
