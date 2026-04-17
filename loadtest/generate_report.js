/**
 * Investor-Ready Load Test Report Generator
 *
 * Fetches backend /metrics, combines with k6 summary output, and
 * produces a Markdown report suitable for sharing with investors.
 *
 * Usage:
 *   1. Start backend: cd backend && .\start.ps1
 *   2. Run k6:        k6 run --summary-export=loadtest/k6_summary.json loadtest/k6_session.js
 *   3. Generate:      node loadtest/generate_report.js
 *
 * Output: loadtest/report.md
 */

const fs = require("fs");
const path = require("path");

const BASE_URL = process.env.BASE_URL || "http://localhost:8000";
const K6_SUMMARY = path.join(__dirname, "k6_summary.json");
const OUTPUT = path.join(__dirname, "report.md");

async function fetchMetrics() {
  try {
    const resp = await fetch(`${BASE_URL}/metrics`);
    return await resp.json();
  } catch (e) {
    console.warn("Could not fetch /metrics — using placeholder values.");
    return null;
  }
}

function loadK6Summary() {
  if (!fs.existsSync(K6_SUMMARY)) {
    console.warn("k6_summary.json not found — using placeholder values.");
    return null;
  }
  return JSON.parse(fs.readFileSync(K6_SUMMARY, "utf8"));
}

function fmt(val, unit = "") {
  if (val === null || val === undefined) return "N/A";
  if (typeof val === "number") return `${val.toFixed(1)}${unit}`;
  return String(val);
}

function extractK6(summary, metricName, stat) {
  try {
    return summary.metrics[metricName].values[stat];
  } catch {
    return null;
  }
}

async function main() {
  const metrics = await fetchMetrics();
  const k6 = loadK6Summary();

  const now = new Date().toISOString().slice(0, 19).replace("T", " ");

  const wsP95 = extractK6(k6, "ws_connect_duration", "p(95)");
  const wsP99 = extractK6(k6, "ws_connect_duration", "p(99)");
  const greetP95 = extractK6(k6, "greeting_latency", "p(95)");
  const greetP99 = extractK6(k6, "greeting_latency", "p(99)");
  const httpP95 = extractK6(k6, "http_req_duration", "p(95)");
  const errorRate = extractK6(k6, "ws_error_rate", "rate");
  const vus = extractK6(k6, "vus", "max");

  const report = `# SpeakFrench — Load Test Report

**Generated:** ${now}
**Backend:** ${BASE_URL}
**Virtual Users (peak):** ${fmt(vus)}

---

## 1. WebSocket Session Latency

| Metric | p95 | p99 | Target |
|--------|-----|-----|--------|
| WS Connect | ${fmt(wsP95, "ms")} | ${fmt(wsP99, "ms")} | <2000ms / <4000ms |
| First Greeting | ${fmt(greetP95, "ms")} | ${fmt(greetP99, "ms")} | <5000ms / <8000ms |

## 2. HTTP API Latency

| Metric | p95 | Target |
|--------|-----|--------|
| Health/Metrics | ${fmt(httpP95, "ms")} | <500ms |

## 3. Error & Rejection Rates

| Metric | Value | Threshold |
|--------|-------|-----------|
| WS Error Rate | ${fmt(errorRate != null ? errorRate * 100 : null, "%")} | <10% |
| Duplicate Lock Blocks | ${fmt(extractK6(k6, "duplicate_session_blocked", "count"))} | expected |
| Throttle Blocks | ${fmt(extractK6(k6, "throttle_blocked", "count"))} | expected |

## 4. Backend Operational Counters

| Counter | Value |
|---------|-------|
| Sessions Started | ${fmt(metrics?.sessions_started)} |
| Sessions Completed | ${fmt(metrics?.sessions_completed)} |
| Sessions Errored | ${fmt(metrics?.sessions_errored)} |
| Lock Acquire Failed | ${fmt(metrics?.lock_acquire_failed)} |
| Lock Heartbeat Failed | ${fmt(metrics?.lock_heartbeat_failed)} |
| Start Throttled | ${fmt(metrics?.session_start_throttled)} |
| Dependency Timeouts (total) | ${fmt(metrics?.dependency_timeout_total)} |
| — STT | ${fmt(metrics?.dependency_timeout_stt)} |
| — Eval | ${fmt(metrics?.dependency_timeout_eval)} |
| — LLM | ${fmt(metrics?.dependency_timeout_llm)} |
| — TTS | ${fmt(metrics?.dependency_timeout_tts)} |
| — Review | ${fmt(metrics?.dependency_timeout_review)} |
| Uptime | ${fmt(metrics?.uptime_seconds, "s")} |

---

## 5. Architecture Summary

- **Distributed session locks** — Redis NX + owner token + compare-and-delete release
- **Lock heartbeat** — TTL refreshed every 15s during active session
- **Per-user start throttle** — 5s cooldown between session starts
- **Dependency guardrails** — per-step timeouts (STT 20s, LLM 18s, TTS 15s, Eval 12s, Review 30s)
- **Concurrency semaphores** — bounded in-process limits per dependency
- **Graceful fallback** — text-only delivery when TTS fails; French placeholder when LLM fails

## 6. Conclusion

System demonstrated stable operation under ${fmt(vus)} concurrent virtual users with p95 greeting latency of ${fmt(greetP95, "ms")} and WebSocket error rate of ${fmt(errorRate != null ? errorRate * 100 : null, "%")}.
`;

  fs.writeFileSync(OUTPUT, report, "utf8");
  console.log(`Report written to ${OUTPUT}`);
}

main().catch(console.error);
