#!/usr/bin/env node
// Usage: node tools/telemetry-report.mjs <events.json|events.jsonl|report.json>... [--json]
// Aggregates opt-in telemetry into a chapter funnel, glyph-art death heatmaps, endings, perf by tier and crashes.
import fs from 'node:fs';
import { parseEvents, aggregate, renderReport } from './lib/telemetry-report.mjs';
const files = process.argv.slice(2).filter(a => !a.startsWith('--')); if (!files.length) { console.error('usage: node tools/telemetry-report.mjs <file>... [--json]'); process.exit(2); }
const events = files.flatMap(f => { try { return parseEvents(fs.readFileSync(f, 'utf8')); } catch (e) { console.error(`cannot read ${f}: ${e.message}`); process.exit(2); } });
const agg = aggregate(events); console.log(process.argv.includes('--json') ? JSON.stringify(agg, null, 1) : renderReport(agg));
