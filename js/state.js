/* `state` dipakai sebagai singleton yang di-mutate di tempat (properti diubah,
   objeknya sendiri tidak pernah di-reassign) — jadi modul manapun yang
   mengimpornya (`import { state } from './state.js'`) selalu melihat nilai
   terbaru tanpa perlu getter/setter. */
export let state = {
  // apiKey sekarang OPSIONAL murni — kosong berarti proxy Worker pakai pool key
  // miliknya sendiri (lihat worker/index.js). Tidak ada lagi default key bawaan
  // di sisi client (poin 2: API key dipindah ke proxy/backend).
  apiKey:'', symbol:'XAU/USD', interval:'15min', outputSize:300,
  refreshMs:900000, notif:true, sound:true,
  preset:'Custom', tpMode:'Fixed', qualityStrength:0.4,
  useAsym:true, useCharFlip:true, useEffAtr:true, useBreakeven:false,
  useAdaptiveThreshold:true, useCandleConfirm:true, useRequirePattern:true,
  timer:null, candles:[], lastBarTime:null, notifPermission:false,
  csvMode:false,
  currentThreshold:null, // set each cycle by computeAdaptiveThreshold()
};

/* lastResult (hasil computeEngine() paling baru) DI-REASSIGN, bukan cuma
   dimutasi propertinya — binding `let` yang di-export tidak bisa di-reassign
   dari modul lain (hanya bisa dibaca sebagai live-binding), jadi reassignment
   HARUS lewat setLastResult() di sini. Modul lain cukup import getLastResult(). */
let lastResult = null; // most recent computeEngine() output, kept for CSV export
export function getLastResult(){ return lastResult; }
export function setLastResult(v){ lastResult = v; }
