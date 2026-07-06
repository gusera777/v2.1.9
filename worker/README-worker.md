# Deploy Proxy Worker (Cloudflare, gratis)

Proxy ini menyembunyikan API key Twelve Data dari `app.js` sepenuhnya — key
disimpan sebagai *secret* terenkripsi di server Cloudflare, bukan di source
code yang dikirim ke browser.

## 1. Prasyarat

- Akun Cloudflare gratis (https://dash.cloudflare.com/sign-up).
- Node.js terpasang di komputer Anda (untuk menjalankan `wrangler`, CLI resmi
  Cloudflare Workers).

## 2. Install Wrangler & login

```bash
npm install -g wrangler
wrangler login   # buka browser, login ke akun Cloudflare Anda
```

## 3. Siapkan API key

Kumpulkan key Twelve Data Anda (boleh 1, boleh beberapa untuk auto-switch —
sama seperti pool 5 key bawaan yang dulu ada di client). Pisahkan dengan koma,
**tanpa spasi**, contoh: `keyA,keyB,keyC`.

## 4. Deploy

```bash
cd worker
wrangler secret put TWELVEDATA_API_KEYS
# ^ akan diminta paste key(s) Anda — INI TIDAK masuk ke source control,
#   tersimpan terenkripsi di Cloudflare.

wrangler deploy
```

Setelah sukses, Wrangler akan menampilkan URL Worker Anda, contoh:

```
https://gusera-sats-proxy.NAMA-SUBDOMAIN-ANDA.workers.dev
```

## 5. Hubungkan ke aplikasi

Buka `js/proxy-config.js` di project utama, ganti isinya dengan URL di atas:

```js
export const PROXY_BASE_URL = 'https://gusera-sats-proxy.NAMA-SUBDOMAIN-ANDA.workers.dev';
```

Deploy ulang situs statisnya (GitHub Pages/dsb — tidak ada perubahan cara
deploy situs utama, cuma isi file ini yang berubah).

## 6. Tes

Buka di browser (harus muncul JSON candle, bukan error):

```
https://gusera-sats-proxy.NAMA-SUBDOMAIN-ANDA.workers.dev/api/candles?symbol=XAU/USD&interval=15min&outputsize=5
```

## Opsional: mengingat key mana yang terakhir jalan (KV)

Tanpa langkah ini, Worker tetap 100% berfungsi — cuma tiap request baru mulai
coba dari key pertama di pool dulu (tetap otomatis lompat ke key berikutnya
DALAM request yang sama kalau kena limit, cuma tidak "diingat" lintas
request). Untuk trafik ringan seperti aplikasi ini, ini bukan masalah nyata —
lewati bagian ini kalau mau simpel.

Kalau tetap mau diaktifkan:

```bash
wrangler kv namespace create KEY_INDEX_KV
```

Salin `id` yang muncul ke `worker/wrangler.toml`, hapus tanda pagar (`#`) pada
baris `[[kv_namespaces]]`, lalu `wrangler deploy` ulang.

## Opsional: batasi CORS ke domain Anda saja

Default-nya proxy menerima request dari domain manapun (`Access-Control-Allow-Origin: *`)
— aman karena data yang dikembalikan (harga OHLC) bukan data sensitif per-user.
Kalau tetap mau dibatasi, buka `worker/wrangler.toml`, isi:

```toml
[vars]
ALLOWED_ORIGIN = "https://username.github.io"
```

lalu `wrangler deploy` ulang.

## Batas gratis (Cloudflare Workers Free)

100.000 request/hari, reset tiap tengah malam UTC — jauh di atas kebutuhan
aplikasi ini (refresh tiap ~15 menit = jauh di bawah 100 request/hari per
pengguna). Tidak ada biaya bandwidth sama sekali. Kalau butuh detail
lebih lanjut, cek https://developers.cloudflare.com/workers/platform/limits/.

## Mengganti/menambah key nanti

```bash
wrangler secret put TWELVEDATA_API_KEYS
# masukkan daftar key yang baru (menimpa yang lama), lalu:
wrangler deploy
```
