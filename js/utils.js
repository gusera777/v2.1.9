/* ── small numeric helpers (port of Pine util fns) ─────────── */
export const clamp = (x,lo,hi)=>Math.min(hi,Math.max(lo,x));
export const safeDiv = (a,b,fb)=> (b===0||!isFinite(b)) ? fb : a/b;
export function mapClamp(x, inLo, inHi, outLo, outHi){
  if(inHi===inLo) return outLo;
  let t = (x-inLo)/(inHi-inLo);
  t = clamp(t,0,1);
  return outLo + t*(outHi-outLo);
}
export const mapClampInv = mapClamp; // same linear interpolation, direction encoded by outLo/outHi order

export function presetParams(preset, tfMinutes){
  let resolved = preset;
  if(preset==='Auto') resolved = tfMinutes<=5 ? 'Scalping' : (tfMinutes<=240 ? 'Default' : 'Swing');
  const table = {
    Scalping:{atrLen:10, baseMult:1.5, erLen:14, rsiLen:9,  slMult:1.0},
    Default: {atrLen:14, baseMult:2.0, erLen:20, rsiLen:14, slMult:1.5},
    Swing:   {atrLen:21, baseMult:2.5, erLen:30, rsiLen:21, slMult:2.0},
    // Trend Quality Index — pengaturan diminta: ATR Length 21, Base Band Width 4×ATR,
    // Source = close (source memang selalu close di port ini, lihat catatan di dekat charFlipCond).
    Custom:  {atrLen:21, baseMult:4.0, erLen:30, rsiLen:21, slMult:2.0},
  };
  return {resolved, ...table[resolved]};
}
export function tfToMinutes(iv){
  const map = {'1min':1,'5min':5,'15min':15,'30min':30,'1h':60,'4h':240,'1day':1440};
  return map[iv] || 15;
}
