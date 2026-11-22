/** OMH trace utilities: bounded, redacted, explicit opt-in recording. */
const SECRET_KEY = /(?:authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|cookie)/i;
const TOKEN = /\b(?:sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9_]{12,}|Bearer\s+\S+)\b/gi;
export function redact(value, depth = 0) {
  if (depth > 12) return '[TRUNCATED]';
  if (typeof value === 'string') return value.replace(TOKEN, '[REDACTED]');
  if (Array.isArray(value)) return value.map(v => redact(v, depth + 1));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) => [k, SECRET_KEY.test(k) ? '[REDACTED]' : redact(v, depth + 1)]));
  return value;
}
const ALLOWED = new Set(['turn.started','turn.completed','tool.requested','tool.completed','tool.denied','agent.delegated','agent.completed','task.failed']);
export class TraceBuffer {
  #events = [];
  constructor({capacity = 500, enabled = false} = {}) {
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 10000) throw new RangeError('Invalid capacity');
    this.capacity = capacity;
    this.enabled = enabled;
  }
  record(type, data = {}) {
    if (!ALLOWED.has(type)) throw new TypeError('Unknown trace event');
    if (!this.enabled) return null;
    const event = Object.freeze({type, at: new Date().toISOString(), data: redact(data)});
    this.#events.push(event);
    if (this.#events.length > this.capacity) this.#events.shift();
    return event;
  }
  list() { return structuredClone(this.#events); }
  clear() { this.#events = []; }
  exportJSON() { return JSON.stringify({schema: 'omh.trace.v1', events: this.list()}); }
}
