import { clamp } from '../utils.js';

export function drawGauge(tqi){
  const cv = document.getElementById('gaugeCanvas');
  const ctx = cv.getContext('2d');
  const dpr = window.devicePixelRatio||1;
  const cssSize = cv.clientWidth || 170;
  cv.width = cssSize*dpr; cv.height = cssSize*dpr;
  ctx.setTransform(dpr,0,0,dpr,0,0);
  const w=cssSize, h=cssSize, cx=w/2, cy=h/2, r=w/2-14;
  ctx.clearRect(0,0,w,h);
  const start=Math.PI*0.75, end=Math.PI*2.25;
  ctx.lineWidth=14; ctx.lineCap='round';
  ctx.strokeStyle='#1a1f28';
  ctx.beginPath(); ctx.arc(cx,cy,r,start,end); ctx.stroke();
  if(tqi!=null){
    const val = clamp(tqi,0,1);
    const lg = ctx.createLinearGradient(0,h,w,0);
    lg.addColorStop(0,'#FF5C7A'); lg.addColorStop(.35,'#FF8A4C'); lg.addColorStop(.65,'#FFB648'); lg.addColorStop(1,'#2FE6B8');
    ctx.strokeStyle=lg;
    ctx.beginPath(); ctx.arc(cx,cy,r,start,start+(end-start)*val); ctx.stroke();
  }
}

export function drawSparkline(candles){
  const wrap = document.getElementById('sparkWrap');
  const canvas = document.getElementById('sparkCanvas');
  if(!wrap || !canvas || !candles || !candles.length) return;
  const dpr = window.devicePixelRatio||1;
  const W = wrap.clientWidth, H = wrap.clientHeight;
  if(W<=0 || H<=0) return;
  canvas.width = W*dpr; canvas.height = H*dpr;
  canvas.style.width = W+'px'; canvas.style.height = H+'px';
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.clearRect(0,0,W,H);

  const N = Math.min(60, candles.length);
  const slice = candles.slice(candles.length-N);
  const closes = slice.map(c=>c.close);
  const lo = Math.min(...closes), hi = Math.max(...closes);
  const pad = (hi-lo)*0.1 || 1;
  const yLo = lo-pad, yHi = hi+pad;
  const marginTop=6, marginBottom=6;
  const x = i => (i/(N-1===0?1:N-1))*W;
  const y = v => marginTop + (1-(v-yLo)/(yHi-yLo))*(H-marginTop-marginBottom);

  const up = closes[closes.length-1] >= closes[0];
  const lineColor = up ? '#2FE6B8' : '#FF5C7A';

  // filled area
  const grad = ctx.createLinearGradient(0,0,0,H);
  grad.addColorStop(0, up ? 'rgba(47,230,184,.35)' : 'rgba(255,92,122,.30)');
  grad.addColorStop(1, 'rgba(47,230,184,0)');
  ctx.beginPath();
  ctx.moveTo(x(0), y(closes[0]));
  closes.forEach((v,i)=> ctx.lineTo(x(i), y(v)));
  ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath();
  ctx.fillStyle = grad; ctx.fill();

  // line
  ctx.beginPath();
  closes.forEach((v,i)=>{ i===0 ? ctx.moveTo(x(i),y(v)) : ctx.lineTo(x(i),y(v)); });
  ctx.strokeStyle = lineColor; ctx.lineWidth = 2; ctx.lineJoin='round'; ctx.stroke();

  // dot at last point
  const lastX = x(closes.length-1), lastY = y(closes[closes.length-1]);
  ctx.beginPath(); ctx.arc(lastX,lastY,4,0,Math.PI*2);
  ctx.fillStyle = '#0d0f14'; ctx.fill();
  ctx.lineWidth=2; ctx.strokeStyle = lineColor; ctx.stroke();
}

export function drawChart(res, candles){
  const canvas = document.getElementById('chartCanvas');
  const wrap = document.getElementById('chartWrap');
  if(wrap.clientWidth<=0 || wrap.clientHeight<=0) return; // tab currently hidden — skip, will redraw when shown
  const dpr = window.devicePixelRatio||1;
  canvas.width = wrap.clientWidth*dpr; canvas.height = wrap.clientHeight*dpr;
  canvas.style.width = wrap.clientWidth+'px'; canvas.style.height = wrap.clientHeight+'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr,dpr);
  const W = wrap.clientWidth, H = wrap.clientHeight;
  ctx.clearRect(0,0,W,H);

  const N = Math.min(140, candles.length);
  const startIdx = candles.length-N;
  const slice = candles.slice(startIdx);
  const stLineSlice = res.stLine.slice(startIdx);
  const stTrendSlice = res.stTrend.slice(startIdx);

  let lo=Infinity, hi=-Infinity;
  slice.forEach((c,idx)=>{
    lo=Math.min(lo,c.low,stLineSlice[idx]); hi=Math.max(hi,c.high,stLineSlice[idx]);
  });
  if(res.openTrade){ [res.openTrade.sl, ...res.openTrade.tp].forEach(v=>{ lo=Math.min(lo,v); hi=Math.max(hi,v); }); }
  const pad=(hi-lo)*0.08 || 1; lo-=pad; hi+=pad;

  const marginL=6, marginR=54, marginTop=8, marginBottom=20;
  const plotW = W-marginL-marginR, plotH = H-marginTop-marginBottom;
  const x = i => marginL + (i/(N-1===0?1:N-1))*plotW;
  const y = v => marginTop + (1-(v-lo)/(hi-lo))*plotH;

  // grid + axis labels
  ctx.strokeStyle = '#1a1e24'; ctx.fillStyle='#565C64'; ctx.font='10px IBM Plex Mono'; ctx.lineWidth=1;
  for(let g=0; g<=4; g++){
    const v = lo + (hi-lo)*g/4;
    const yy = y(v);
    ctx.beginPath(); ctx.moveTo(marginL,yy); ctx.lineTo(W-marginR,yy); ctx.stroke();
    ctx.fillText(v.toFixed(2), W-marginR+6, yy+3);
  }

  // candles
  const cw = Math.max(2, plotW/N*0.6);
  slice.forEach((c,i)=>{
    const xi = x(i);
    const up = c.close>=c.open;
    ctx.strokeStyle = up?'#2FD9C4':'#FF5C5C';
    ctx.fillStyle = up?'#2FD9C4':'#FF5C5C';
    ctx.beginPath(); ctx.moveTo(xi,y(c.high)); ctx.lineTo(xi,y(c.low)); ctx.stroke();
    const oy=y(c.open), cy2=y(c.close);
    ctx.fillRect(xi-cw/2, Math.min(oy,cy2), cw, Math.max(1,Math.abs(cy2-oy)));
  });

  // supertrend line, colored by trend + tqi brightness
  for(let i=1;i<slice.length;i++){
    const bull = stTrendSlice[i]===1;
    ctx.strokeStyle = bull ? '#2FD9C4' : '#FF5C5C';
    ctx.globalAlpha = 0.85;
    ctx.lineWidth=2;
    ctx.beginPath(); ctx.moveTo(x(i-1), y(stLineSlice[i-1])); ctx.lineTo(x(i), y(stLineSlice[i])); ctx.stroke();
  }
  ctx.globalAlpha=1;

  // active trade levels
  if(res.openTrade){
    const ot = res.openTrade;
    const lines = [[ot.sl,'#FF1744','SL'], [ot.tp[0],'#00E676','TP1'], [ot.tp[1],'#00E676','TP2'], [ot.tp[2],'#00E676','TP3'], [ot.entry,'#8b9098','ENTRY']];
    lines.forEach(([v,color,label])=>{
      const yy=y(v);
      ctx.strokeStyle=color; ctx.setLineDash([4,3]); ctx.lineWidth=1;
      ctx.beginPath(); ctx.moveTo(marginL,yy); ctx.lineTo(W-marginR,yy); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle=color; ctx.font='9px IBM Plex Mono';
      ctx.fillText(label, marginL+2, yy-2);
    });
  }

  // buy/sell markers
  res.signals.forEach(sig=>{
    if(sig.i<startIdx) return;
    const idx = sig.i-startIdx;
    const xi=x(idx);
    ctx.fillStyle = sig.side==='BUY' ? '#2FD9C4' : '#FF5C5C';
    ctx.beginPath();
    if(sig.side==='BUY'){ ctx.moveTo(xi-5,y(slice[idx].low)+14); ctx.lineTo(xi+5,y(slice[idx].low)+14); ctx.lineTo(xi,y(slice[idx].low)+4); }
    else{ ctx.moveTo(xi-5,y(slice[idx].high)-14); ctx.lineTo(xi+5,y(slice[idx].high)-14); ctx.lineTo(xi,y(slice[idx].high)-4); }
    ctx.closePath(); ctx.fill();
  });
}
