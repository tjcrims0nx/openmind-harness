/** OMH independent provider policy engine. No network calls or credentials. */
export const MODES = Object.freeze(['manual', 'balanced', 'budget', 'quality']);
const finite = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
export function chooseProvider(candidates, options = {}) {
  const { mode = 'balanced', preferred, maxCostPerMillion = Infinity, maxLatencyMs = Infinity } = options;
  if (!MODES.includes(mode)) throw new TypeError('Unsupported routing mode');
  if (!Array.isArray(candidates)) throw new TypeError('Candidates must be an array');
  const valid = candidates.filter(c => c && typeof c.id === 'string' && c.id && c.healthy === true && finite(c.costPerMillion) && finite(c.latencyMs) && finite(c.quality) && c.quality <= 1 && c.costPerMillion <= maxCostPerMillion && c.latencyMs <= maxLatencyMs);
  if (mode === 'manual') return valid.find(c => c.id === preferred) ?? null;
  const score = c => mode === 'budget' ? c.costPerMillion : mode === 'quality' ? -c.quality : c.costPerMillion / 10 + c.latencyMs / 1000 - c.quality * 2;
  return [...valid].sort((a,b) => score(a) - score(b) || a.id.localeCompare(b.id))[0] ?? null;
}
export function failoverCandidate(candidates, failedIds, options = {}) {
  if (!Array.isArray(failedIds)) throw new TypeError('failedIds must be an array');
  return chooseProvider(candidates.filter(c => !failedIds.includes(c.id)), options);
}
export function estimateCost({inputTokens, outputTokens, inputPerMillion, outputPerMillion}) {
  if (![inputTokens, outputTokens, inputPerMillion, outputPerMillion].every(finite)) throw new TypeError('Invalid token count or price');
  return (inputTokens * inputPerMillion + outputTokens * outputPerMillion) / 1e6;
}
export function withinBudget(estimated, spent, limit) {
  if (![estimated, spent, limit].every(finite)) throw new TypeError('Invalid budget');
  return spent + estimated <= limit;
}
