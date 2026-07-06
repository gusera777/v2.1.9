import { state } from '../state.js';
import { getPersistedStats } from '../history-store.js';

/* ═══════════════════════════════════════════════════════════
   PROFIL: ringkasan performa lintas sesi & preferensi aktif
   ═══════════════════════════════════════════════════════════ */
export function updateProfilePanel(res){
  const pairLabelEl = document.getElementById('profPairLabel');
  if(pairLabelEl) pairLabelEl.textContent = state.symbol+' · '+state.interval;

  const pStats = getPersistedStats(30);
  const winRateEl = document.getElementById('profWinRate');
  if(winRateEl){
    winRateEl.textContent = pStats.winRate!=null ? pStats.winRate.toFixed(0)+'%' : '—';
    winRateEl.className = 'v '+(pStats.winRate>50?'pos':pStats.winRate!=null&&pStats.winRate<=50?'neg':'');
  }
  const avgREl = document.getElementById('profAvgR');
  if(avgREl){
    avgREl.textContent = pStats.avgR!=null ? pStats.avgR.toFixed(2)+'R' : '—';
    avgREl.className = 'v '+(pStats.avgR>0?'pos':pStats.avgR!=null&&pStats.avgR<=0?'neg':'');
  }
  const totalEl = document.getElementById('profTotalTrades');
  if(totalEl) totalEl.textContent = pStats.total || '—';
  const streakEl = document.getElementById('profBestStreak');
  if(streakEl && res && res.stats){
    streakEl.textContent = res.stats.maxWinStreak>0 ? res.stats.maxWinStreak+'W' : '—';
  }

  const symTfEl = document.getElementById('profSymbolTf');
  if(symTfEl) symTfEl.textContent = state.symbol+' · '+state.interval;
  const presetEl = document.getElementById('profPreset');
  if(presetEl) presetEl.textContent = state.preset;
  const tpModeEl = document.getElementById('profTpMode');
  if(tpModeEl) tpModeEl.textContent = state.tpMode;
  const sourceEl = document.getElementById('profDataSource');
  if(sourceEl) sourceEl.textContent = state.csvMode ? 'Mode CSV (Offline)' : 'Twelve Data (Live)';
}
