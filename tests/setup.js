import { beforeEach } from 'vitest';

/* history-store.js memakai localStorage (browser-only). Node tidak selalu punya
   ini bawaan (dan meskipun ada di versi Node terbaru, kita tetap sediakan
   polyfill sendiri di sini supaya perilakunya deterministik & tidak bergantung
   versi Node siapa pun yang menjalankan test). Direset bersih SEBELUM tiap test
   (bukan cuma sekali di awal) supaya test tidak saling bocor state lewat
   localStorage. */
class MemoryStorage {
  constructor(){ this._data = new Map(); }
  getItem(k){ return this._data.has(k) ? this._data.get(k) : null; }
  setItem(k,v){ this._data.set(k, String(v)); }
  removeItem(k){ this._data.delete(k); }
  clear(){ this._data.clear(); }
  get length(){ return this._data.size; }
  key(i){ return Array.from(this._data.keys())[i] ?? null; }
}

beforeEach(() => {
  globalThis.localStorage = new MemoryStorage();
});
