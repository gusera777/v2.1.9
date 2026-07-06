/* ═══════════════════════════════════════════════════════════
   CONSTANTS — konstanta scoring & pattern weight (tidak berubah)
   ═══════════════════════════════════════════════════════════ */
export const CONST = {
  MAX_HISTORY_SIGS: 100,
  BYPASS_SCORE: 12.0, MULT_SMOOTH_ALPHA: 0.15,
  // True max score ceilings for scoreBreakdown(): momScore(17)+erScore(17)+rsiScore(17)
  // +structScore(16)+breakScore(16) = 83, plus vScore which is either up to 17 (real volume)
  // or a fixed 12 (BYPASS_SCORE, no volume data — e.g. most forex/gold pairs), plus
  // patternScore (up to MAX_PATTERN_SCORE) from candlestick/chart-pattern confluence.
  MAX_SCORE_WITH_VOLUME: 110, MAX_SCORE_NO_VOLUME: 105,
  // Confluence weights for chart/candlestick patterns detected around a signal bar.
  // Reversal candles (engulfing/pin bar) count more than plain trend-structure
  // confirmation (higher-low/lower-high), since the former directly contradicts the
  // prior bar while the latter simply restates the existing trend.
  PATTERN_WEIGHTS: {
    'Bullish Engulfing':6, 'Bearish Engulfing':6,
    'Hammer':5, 'Shooting Star':5,
    'Double Bottom':4, 'Double Top':4,
    'Higher Low':2, 'Lower High':2,
  },
  MAX_PATTERN_SCORE: 10,
};
