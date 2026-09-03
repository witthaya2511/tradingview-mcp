import { z } from 'zod';
import { jsonResult } from './_format.js';
import * as core from '../core/tfex.js';

const timeframes = z.array(z.string()).optional().describe('Timeframes from lower to higher priority (default: ["15", "60"])');
const count = z.coerce.number().min(36).max(500).optional().describe('Bars per timeframe (default 120, min 36, max 500)');

function tool(server, name, description, schema, handler) {
  server.tool(name, description, schema, async (args) => {
    try { return jsonResult(await handler(args)); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });
}

export function registerTfexTools(server) {
  tool(server, 'tfex_analyze', 'Analyze the current TFEX chart and return LONG, SHORT, or WAIT with MTF evidence, regime, and risk plan. Analysis only; never places orders.', { timeframes, count, risk_reward: z.coerce.number().min(1).max(5).optional(), atr_stop: z.coerce.number().min(0.5).max(5).optional() }, core.analyze);
  tool(server, 'tfex_market_regime', 'Classify the current chart as BULL, BEAR, SIDEWAYS, or HIGH_VOLATILITY.', { timeframe: z.string().optional(), count }, core.marketRegime);
  tool(server, 'tfex_mtf_signal', 'Combine TFEX signals across multiple chart timeframes. Higher timeframes receive more weight.', { timeframes, count }, core.mtfSignal);
  tool(server, 'tfex_strategy_report', 'Summarize Strategy Tester metrics and assess sample quality, profit factor, win rate, and drawdown.', {}, core.strategyReport);
  tool(server, 'tfex_risk_plan', 'Build an ATR-based entry, stop, TP1, TP2, and risk/reward plan for the current chart. Analysis only.', { signal: z.enum(['LONG', 'SHORT', 'WAIT']).optional(), count, risk_reward: z.coerce.number().min(1).max(5).optional(), atr_stop: z.coerce.number().min(0.5).max(5).optional() }, core.riskPlan);
}
