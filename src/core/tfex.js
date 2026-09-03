/**
 * TFEX analysis layer. Decision support only: this module never places orders.
 */
import * as chart from './chart.js';
import * as data from './data.js';

const round = (value, digits = 2) => value == null ? null : Number(value.toFixed(digits));
const mean = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
export const DEFAULT_TFEX_TIMEFRAMES = Object.freeze(['15', '60', '240']);

function ema(values, length) {
  if (!values.length) return null;
  const multiplier = 2 / (length + 1);
  let result = values[0];
  for (let i = 1; i < values.length; i++) result = values[i] * multiplier + result * (1 - multiplier);
  return result;
}

function rsiSeries(values, length = 14) {
  if (values.length <= length) return [];
  const result = [];
  for (let end = length; end < values.length; end++) {
    let gains = 0;
    let losses = 0;
    for (let i = end - length + 1; i <= end; i++) {
      const change = values[i] - values[i - 1];
      if (change >= 0) gains += change;
      else losses -= change;
    }
    if (losses === 0) result.push(100);
    else result.push(100 - (100 / (1 + gains / losses)));
  }
  return result;
}

function stochRsi(values) {
  const rsi = rsiSeries(values);
  if (rsi.length < 14) return null;
  const window = rsi.slice(-14);
  const low = Math.min(...window);
  const high = Math.max(...window);
  return high === low ? 50 : ((window.at(-1) - low) / (high - low)) * 100;
}

function atr(bars, length = 14) {
  if (bars.length < 2) return null;
  const ranges = [];
  for (let i = Math.max(1, bars.length - length); i < bars.length; i++) {
    const previousClose = bars[i - 1].close;
    ranges.push(Math.max(
      bars[i].high - bars[i].low,
      Math.abs(bars[i].high - previousClose),
      Math.abs(bars[i].low - previousClose),
    ));
  }
  return mean(ranges);
}

function midpoint(bars) {
  return (Math.max(...bars.map(bar => bar.high)) + Math.min(...bars.map(bar => bar.low))) / 2;
}

export function ichimokuLevels(bars) {
  if (!Array.isArray(bars) || bars.length < 52) return null;
  const conversion = midpoint(bars.slice(-9));
  const base = midpoint(bars.slice(-26));
  const spanA = (conversion + base) / 2;
  const spanB = midpoint(bars.slice(-52));
  return {
    conversion: round(conversion),
    base: round(base),
    span_a: round(spanA),
    span_b: round(spanB),
    cloud_top: round(Math.max(spanA, spanB)),
    cloud_bottom: round(Math.min(spanA, spanB)),
  };
}

export function volumeProfile(bars, bucketCount = 24, valueAreaPercent = 0.7) {
  if (!Array.isArray(bars) || !bars.length) return null;
  const low = Math.min(...bars.map(bar => bar.low));
  const high = Math.max(...bars.map(bar => bar.high));
  const step = (high - low) / bucketCount;
  if (!Number.isFinite(step) || step <= 0) return null;
  const buckets = Array.from({ length: bucketCount }, (_, index) => ({
    price: low + step * (index + 0.5),
    volume: 0,
    index,
  }));
  for (const bar of bars) {
    const typicalPrice = (bar.high + bar.low + bar.close) / 3;
    const index = Math.max(0, Math.min(bucketCount - 1, Math.floor((typicalPrice - low) / step)));
    buckets[index].volume += Number(bar.volume) || 0;
  }
  const poc = buckets.reduce((best, bucket) => bucket.volume > best.volume ? bucket : best, buckets[0]);
  const totalVolume = buckets.reduce((sum, bucket) => sum + bucket.volume, 0);
  const targetVolume = totalVolume * valueAreaPercent;
  let includedVolume = poc.volume;
  let lower = poc.index;
  let upper = poc.index;
  while (includedVolume < targetVolume && (lower > 0 || upper < buckets.length - 1)) {
    const lowerVolume = lower > 0 ? buckets[lower - 1].volume : -1;
    const upperVolume = upper < buckets.length - 1 ? buckets[upper + 1].volume : -1;
    if (upperVolume >= lowerVolume) includedVolume += buckets[++upper].volume;
    else includedVolume += buckets[--lower].volume;
  }
  return {
    poc: round(poc.price),
    value_area_high: round(low + step * (upper + 1)),
    value_area_low: round(low + step * lower),
    value_area_percent: Math.round(valueAreaPercent * 100),
    buckets: bucketCount,
  };
}

export function analyzeBars(bars, timeframe = null) {
  if (!Array.isArray(bars) || bars.length < 36) throw new Error('TFEX analysis requires at least 36 OHLCV bars.');
  const closes = bars.map(bar => Number(bar.close));
  const fast = ema(closes, 5);
  const slow = ema(closes, 35);
  const last = bars.at(-1);
  const recent = bars.slice(-6);
  const prior = bars.slice(-12, -6);
  const recentHigh = Math.max(...recent.map(bar => bar.high));
  const recentLow = Math.min(...recent.map(bar => bar.low));
  const priorHigh = Math.max(...prior.map(bar => bar.high));
  const priorLow = Math.min(...prior.map(bar => bar.low));
  const structure = recentHigh > priorHigh && recentLow > priorLow ? 'bullish' : recentHigh < priorHigh && recentLow < priorLow ? 'bearish' : 'mixed';
  const oscillator = stochRsi(closes);
  const baselineVolume = mean(bars.slice(-21, -1).map(bar => Number(bar.volume) || 0));
  const volumeRatio = baselineVolume ? (Number(last.volume) || 0) / baselineVolume : null;
  const ichimoku = ichimokuLevels(bars);
  const profile = volumeProfile(bars);
  let score = 0;
  const evidence = [];
  if (fast > slow) { score += 30; evidence.push('EMA 5 is above EMA 35'); }
  else { score -= 30; evidence.push('EMA 5 is below EMA 35'); }
  if (last.close > fast) score += 10;
  else score -= 10;
  if (structure === 'bullish') score += 25;
  else if (structure === 'bearish') score -= 25;
  if (oscillator != null) {
    if (oscillator >= 55 && oscillator <= 90) score += 15;
    else if (oscillator <= 45 && oscillator >= 10) score -= 15;
  }
  if (volumeRatio != null && volumeRatio >= 1.2) score += Math.sign(score || (last.close - last.open)) * 10;
  if (ichimoku) {
    if (last.close > ichimoku.cloud_top && ichimoku.conversion > ichimoku.base) {
      score += 20;
      evidence.push('Price is above the Ichimoku cloud with Conversion above Base');
    } else if (last.close < ichimoku.cloud_bottom && ichimoku.conversion < ichimoku.base) {
      score -= 20;
      evidence.push('Price is below the Ichimoku cloud with Conversion below Base');
    } else {
      evidence.push('Ichimoku confirmation is mixed');
    }
  }
  if (profile) {
    if (last.close > profile.value_area_high) {
      score += 10;
      evidence.push('Price is above the Volume Profile value area');
    } else if (last.close < profile.value_area_low) {
      score -= 10;
      evidence.push('Price is below the Volume Profile value area');
    } else {
      evidence.push('Price is inside the Volume Profile value area');
    }
  }
  score = Math.max(-100, Math.min(100, score));
  const signal = score >= 35 ? 'LONG' : score <= -35 ? 'SHORT' : 'WAIT';
  return {
    timeframe,
    signal,
    score,
    confidence: Math.min(95, 50 + Math.round(Math.abs(score) * 0.45)),
    price: last.close,
    indicators: { ema_5: round(fast), ema_35: round(slow), stoch_rsi: round(oscillator), atr_14: round(atr(bars)), volume_ratio: round(volumeRatio), ichimoku, volume_profile: profile },
    price_structure: structure,
    evidence,
  };
}

export function classifyMarketRegime(bars, timeframe = null) {
  const analysis = analyzeBars(bars, timeframe);
  const closes = bars.map(bar => bar.close);
  const currentAtr = atr(bars);
  const atrPercent = currentAtr && closes.at(-1) ? currentAtr / closes.at(-1) * 100 : 0;
  const separation = Math.abs(analysis.indicators.ema_5 - analysis.indicators.ema_35) / closes.at(-1) * 100;
  let regime = 'SIDEWAYS';
  if (atrPercent >= 1.5) regime = 'HIGH_VOLATILITY';
  else if (analysis.score >= 35 && separation >= 0.15) regime = 'BULL';
  else if (analysis.score <= -35 && separation >= 0.15) regime = 'BEAR';
  return { timeframe, regime, atr_percent: round(atrPercent), ema_separation_percent: round(separation), underlying_signal: analysis.signal, score: analysis.score };
}

export function combineMtf(frames) {
  if (!Array.isArray(frames) || !frames.length) throw new Error('At least one timeframe analysis is required.');
  const weights = frames.map((_, index) => index + 1);
  const weightedScore = frames.reduce((sum, frame, index) => sum + frame.score * weights[index], 0) / weights.reduce((a, b) => a + b, 0);
  const score = Math.round(weightedScore);
  const signal = score >= 35 ? 'LONG' : score <= -35 ? 'SHORT' : 'WAIT';
  const directions = new Set(frames.map(frame => frame.signal).filter(value => value !== 'WAIT'));
  return { signal, score, aligned: directions.size <= 1, confidence: Math.min(95, 45 + Math.round(Math.abs(score) * 0.5)), timeframes: frames };
}

export function buildRiskPlan({ price, atr: atrValue, signal, risk_reward = 2, atr_stop = 1.5 }) {
  if (!Number.isFinite(price) || !Number.isFinite(atrValue) || atrValue <= 0) throw new Error('A positive price and ATR are required.');
  if (!['LONG', 'SHORT', 'WAIT'].includes(signal)) throw new Error('signal must be LONG, SHORT, or WAIT.');
  if (signal === 'WAIT') return { signal, actionable: false, reason: 'No directional edge; wait for LONG or SHORT confirmation.' };
  const direction = signal === 'LONG' ? 1 : -1;
  const stopDistance = atrValue * atr_stop;
  const entry = price;
  const stop_loss = entry - direction * stopDistance;
  const take_profit_1 = entry + direction * stopDistance * risk_reward;
  const take_profit_2 = entry + direction * stopDistance * (risk_reward + 1);
  return { signal, actionable: true, entry: round(entry), stop_loss: round(stop_loss), take_profit_1: round(take_profit_1), take_profit_2: round(take_profit_2), risk_reward: `1:${risk_reward}`, atr_stop_multiple: atr_stop, note: 'Decision support only; size the position to your own risk limit.' };
}

export function summarizeStrategy(metrics = {}) {
  const trades = Number(metrics.total_trades || 0);
  const winRate = Number(metrics.percent_profitable ?? (trades ? Number(metrics.winning_trades || 0) / trades * 100 : 0));
  const profitFactor = Number(metrics.profit_factor || 0);
  const drawdown = Number(metrics.max_drawdown_percent || 0);
  const quality = trades < 30 ? 'INSUFFICIENT_SAMPLE' : profitFactor >= 1.5 && winRate >= 45 && drawdown <= 20 ? 'ROBUST' : profitFactor >= 1.1 && drawdown <= 30 ? 'PROMISING' : 'WEAK';
  return { quality, total_trades: trades, win_rate_percent: round(winRate), profit_factor: round(profitFactor), max_drawdown_percent: round(drawdown), net_profit: metrics.net_profit ?? null, warning: trades < 30 ? 'Fewer than 30 trades; do not rely on this result alone.' : null };
}

async function loadFrame(timeframe, count = 120) {
  await chart.setTimeframe({ timeframe });
  const result = await data.getOhlcv({ count, summary: false });
  return analyzeBars(result.bars, timeframe);
}

export async function mtfSignal({ timeframes = DEFAULT_TFEX_TIMEFRAMES, count = 120 } = {}) {
  const initial = await chart.getState();
  const frames = [];
  try {
    for (const timeframe of timeframes) frames.push(await loadFrame(timeframe, count));
    return { success: true, symbol: initial.symbol, ...combineMtf(frames) };
  } finally {
    if (initial.resolution && timeframes.at(-1) !== initial.resolution) await chart.setTimeframe({ timeframe: initial.resolution });
  }
}

export async function marketRegime({ timeframe, count = 120 } = {}) {
  const initial = await chart.getState();
  const target = timeframe || initial.resolution;
  try {
    if (target !== initial.resolution) await chart.setTimeframe({ timeframe: target });
    const result = await data.getOhlcv({ count, summary: false });
    return { success: true, symbol: initial.symbol, ...classifyMarketRegime(result.bars, target) };
  } finally {
    if (target !== initial.resolution) await chart.setTimeframe({ timeframe: initial.resolution });
  }
}

export async function riskPlan(options = {}) {
  const state = await chart.getState();
  const result = await data.getOhlcv({ count: options.count || 120, summary: false });
  const analysis = analyzeBars(result.bars, state.resolution);
  return { success: true, symbol: state.symbol, timeframe: state.resolution, ...buildRiskPlan({ price: analysis.price, atr: analysis.indicators.atr_14, signal: options.signal || analysis.signal, risk_reward: options.risk_reward, atr_stop: options.atr_stop }) };
}

export async function strategyReport() {
  const result = await data.getStrategyResults();
  return { success: result.success, strategy: result.strategy, currency: result.currency, metrics: result.metrics, assessment: summarizeStrategy(result.metrics), error: result.error };
}

export async function analyze(options = {}) {
  const mtf = await mtfSignal(options);
  const primary = mtf.timeframes.at(-1);
  const regime = await marketRegime({ timeframe: primary.timeframe, count: options.count });
  const risk = buildRiskPlan({ price: primary.price, atr: primary.indicators.atr_14, signal: mtf.signal, risk_reward: options.risk_reward, atr_stop: options.atr_stop });
  return { success: true, symbol: mtf.symbol, decision: mtf.signal, score: mtf.score, confidence: mtf.confidence, regime: regime.regime, mtf, risk, auto_trading: false };
}
