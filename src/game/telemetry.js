// Telemetry and crash reporting. Privacy rules:
//   - OFF by default. Nothing is ever sent unless the player opts in AND the build is configured with an
//     endpoint (telemetry.json next to index.html; absent in the shipped build).
//   - No identifiers: no user ID, no device fingerprint, no IP handling here, no free text from the player.
//     A random per-session token groups events of one session and is discarded with the tab.
//   - Everything recorded is visible to the player (Settings → Diagnostics) before anything leaves.
// Crash reports carry the deterministic replay context (chapter, seed, input log), so any crash can be
// reproduced exactly with tools/replay.mjs.
export const TELEMETRY_SCHEMA = 1;
const RING = 200;
export const INPUT_CAP = 36000; // ten minutes of 60 Hz input words; the shell re-bases its log before it grows past this

export function createTelemetry({ version, getState, enabled = false, endpoint = null, send = null }) {
  const T = { version, enabled, endpoint, events: [], crashes: [], session: Math.random().toString(36).slice(2, 10), sent: 0, dropped: 0 };
  const sink = send || ((url, body) => { try { return navigator.sendBeacon?.(url, new Blob([body], { type: 'application/json' })) ?? false; } catch { return false; } });
  const push = (list, e, cap) => { list.push(e); if (list.length > cap) list.shift(); };
  function emit(type, data = {}) {
    const e = { schema: TELEMETRY_SCHEMA, type, t: Math.round(performance.now()), session: T.session, version, ...data };
    push(T.events, e, RING);
    if (T.enabled && T.endpoint) { if (sink(T.endpoint, JSON.stringify(e))) T.sent++; else T.dropped++; }
    return e;
  }
  T.track = emit;
  /** Simulation events worth counting; called by the game shell for every event. */
  T.event = (e, sim) => {
    if (sim.def.endless) return; // Endless verses reuse campaign ids as themes; the shell emits endless_verse / endless_end instead
    if (e.type === 'death') emit('death', { chapter: sim.def.id, tick: sim.tick, hp: sim.p.hp, measures: sim.p.measures });
    else if (e.type === 'complete') emit('chapter_complete', { chapter: sim.def.id, tick: sim.tick, hp: sim.p.hp });
    else if (e.type === 'ending') emit('ending', { ending: e.a });
  };
  /** cpu: main-thread work per frame (sim + render + output submit). intervals: time between rendered frames, which also
   *  counts missed refreshes and GPU waits; intervalP95 <= 33.3 ms is the field check for the 30 fps target. */
  T.perf = (tier, cpu, intervals = []) => {
    if (cpu.length < 30) return; const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return +s[Math.min(s.length - 1, Math.floor(s.length * p))].toFixed(1); };
    emit('perf', { tier, cpuP50: q(cpu, 0.5), cpuP95: q(cpu, 0.95), ...(intervals.length >= 30 ? { intervalP50: q(intervals, 0.5), intervalP95: q(intervals, 0.95) } : {}) });
  };
  /** Build a crash report with everything needed to replay the session deterministically. */
  T.crash = (error, origin = 'error') => {
    const st = getState?.() || {};
    const report = {
      schema: TELEMETRY_SCHEMA, kind: 'crash', origin, version, session: T.session, at: new Date().toISOString(),
      message: String(error?.message || error).replace(/https?:\/\/[^/\s)]+/g, '').slice(0, 500), // origins stripped, as in the stack
      stack: String(error?.stack || '').split('\n').slice(0, 12).map(l => l.replace(/https?:\/\/[^/\s)]+/g, '')).join('\n'),
      chapter: st.chapter ?? null, endless: st.endless ?? null, seed: st.seed ?? null, tick: st.tick ?? null, hash: st.hash ?? null,
      // replay baseline: base = { tick, state } (serialized sim) when the log does not start at tick 0 (a restored
      // checkpoint, or a session longer than INPUT_CAP ticks); null means the log starts at the chapter's first tick
      // failingInput: the word whose step() threw, kept out of the log. tick is then the last completed tick and hash is
      // null (the sim may be half-mutated); replay checks the tick, then applies failingInput to reproduce the exception.
      failingInput: st.failingInput ?? null, base: st.base ?? null, inputsFrom: st.log ? Math.max(0, st.log.length - INPUT_CAP) : 0, inputs: st.log ? encodeInputs(st.log.slice(-INPUT_CAP)) : [],
      tier: st.tier ?? null, userAgentFamily: uaFamily(globalThis.navigator?.userAgent),
    };
    push(T.crashes, report, 5); emit('crash', { message: report.message, chapter: report.chapter, tick: report.tick });
    return report;
  };
  T.install = (onCrash) => {
    addEventListener('error', ev => onCrash?.(T.crash(ev.error || ev.message, 'error')));
    addEventListener('unhandledrejection', ev => onCrash?.(T.crash(ev.reason, 'unhandledrejection')));
  };
  /** The full local record, as shown to the player and copied by "Copy diagnostic report". */
  T.report = () => ({ schema: TELEMETRY_SCHEMA, version, session: T.session, enabled: T.enabled, endpoint: T.endpoint, sent: T.sent, dropped: T.dropped, events: T.events, crashes: T.crashes });
  return T;
}

/** Accepted collector endpoints: a root-relative same-origin path ('/api/telemetry'), or an absolute https URL
 *  (an external collector also needs its origin in the CSP connect-src; docs/LIVE_OPS.md §1). A protocol-relative
 *  '//host' (or '/\\host') is rejected: it looks like a path but resolves to another origin. */
export function allowedEndpoint(endpoint) {
  if (/^\/(?![\/\\])/.test(endpoint)) return true;
  try { return new URL(endpoint).protocol === 'https:'; } catch { return false; }
}
/** Read optional endpoint configuration shipped next to the game. Absent → telemetry can never send. */
export async function loadTelemetryConfig() {
  try { const r = await fetch('telemetry.json', { cache: 'no-store' }); if (!r.ok) return null; const c = await r.json(); return typeof c.endpoint === 'string' && allowedEndpoint(c.endpoint) ? c : null; } catch { return null; }
}

/** Browser family only; 'other' when there is no navigator (Node 20 and earlier) or no recognisable agent. */
function uaFamily(ua = '') { return /Firefox\//.test(ua) ? 'firefox' : /Chrome\//.test(ua) ? 'chromium' : /Safari\//.test(ua) ? 'webkit' : 'other'; }

/** Run-length encode a tick-indexed input log: [word, count, word, count, ...]. */
export function encodeInputs(log) { const out = []; for (const w of log) { if (out.length && out[out.length - 2] === w) out[out.length - 1]++; else out.push(w, 1); } return out; }
export function decodeInputs(rle) { const out = []; for (let i = 0; i < rle.length; i += 2) for (let k = 0; k < rle[i + 1]; k++) out.push(rle[i]); return out; }
