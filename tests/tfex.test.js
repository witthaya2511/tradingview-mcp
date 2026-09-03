import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeBars, buildRiskPlan, classifyMarketRegime, combineMtf, summarizeStrategy } from '../src/core/tfex.js';

function bars(direction = 1, volatility = 1) {
  return Array.from({ length: 80 }, (_, index) => {
    const close = 800 + direction * index * 1.5;
    return { time: index, open: close - direction * 0.5, high: close + volatility, low: close - volatility, close, volume: 1000 + index * 10 };
  });
}

describe('TFEX analysis', () => {
  it('identifies bullish and bearish trends', () => {
    assert.equal(analyzeBars(bars(1), '15').signal, 'LONG');
    assert.equal(analyzeBars(bars(-1), '15').signal, 'SHORT');
  });

  it('weights the higher timeframe more heavily', () => {
    const result = combineMtf([{ timeframe: '15', signal: 'LONG', score: 50 }, { timeframe: '60', signal: 'SHORT', score: -80 }]);
    assert.equal(result.signal, 'SHORT');
    assert.equal(result.aligned, false);
  });

  it('creates symmetric ATR risk levels', () => {
    const long = buildRiskPlan({ price: 900, atr: 4, signal: 'LONG', risk_reward: 2, atr_stop: 1.5 });
    assert.deepEqual([long.stop_loss, long.take_profit_1], [894, 912]);
    const short = buildRiskPlan({ price: 900, atr: 4, signal: 'SHORT', risk_reward: 2, atr_stop: 1.5 });
    assert.deepEqual([short.stop_loss, short.take_profit_1], [906, 888]);
  });

  it('flags small strategy samples', () => {
    assert.equal(summarizeStrategy({ total_trades: 12, profit_factor: 2 }).quality, 'INSUFFICIENT_SAMPLE');
  });

  it('reports a directional regime for orderly data', () => {
    assert.equal(classifyMarketRegime(bars(1, 0.8)).regime, 'BULL');
  });
});
