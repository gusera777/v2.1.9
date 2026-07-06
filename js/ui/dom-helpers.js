/* ═══════════════════════════════════════════════════════════
   RENDER
   ═══════════════════════════════════════════════════════════ */
export function setStatus(msg, kind){
  const el = document.getElementById('statusMsg');
  if(!msg){ el.className='statusMsg'; return; }
  el.textContent = msg; el.className = 'statusMsg show '+(kind||'');
}
export function setModalStatus(msg, kind){
  const el = document.getElementById('modalStatus');
  if(!msg){ el.className='statusMsg'; return; }
  el.textContent = msg; el.className='statusMsg show '+(kind||'');
}
export function setConn(kind, text){
  const dot = document.getElementById('connDot');
  dot.className = 'dot '+(kind||'');
  document.getElementById('connText').textContent = text;
  const engineTag = document.getElementById('engineTag');
  if(engineTag){
    if(kind==='live'){
      engineTag.textContent = 'Aktif · Algoritma Terhubung';
      engineTag.className = 'trendTag bull';
      engineTag.style.background=''; engineTag.style.color=''; engineTag.style.border='';
    } else if(kind==='err'){
      engineTag.textContent = 'Gangguan Koneksi';
      engineTag.className = 'trendTag bear';
      engineTag.style.background=''; engineTag.style.color=''; engineTag.style.border='';
    } else if(text==='Offline'){
      engineTag.textContent = '—';
      engineTag.className = 'trendTag';
      engineTag.style.background = '#1c2027'; engineTag.style.color = 'var(--text-dim)'; engineTag.style.border = '1px solid var(--border)';
    } else {
      engineTag.textContent = 'Sinkronisasi…';
      engineTag.className = 'trendTag';
      engineTag.style.background=''; engineTag.style.color=''; engineTag.style.border='';
    }
  }
}

export function fmtPrice(v){ return isFinite(v) ? v.toFixed(2) : '—'; }
