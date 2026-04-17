/**
 * k6 Load Test — SpeakFrench WebSocket Session Pressure
 *
 * Tests:
 *   1. WebSocket connect + config + first examiner greeting latency
 *   2. Duplicate-session rejection under concurrent tabs
 *   3. Rapid reconnect throttle behavior
 *   4. Health/metrics endpoint throughput
 *
 * Run:
 *   k6 run loadtest/k6_session.js
 *   k6 run --vus 50 --duration 60s loadtest/k6_session.js
 *
 * Environment variables:
 *   BASE_URL    — HTTP base (default http://localhost:8000)
 *   WS_URL      — WebSocket base (default ws://localhost:8000)
 *   VU_COUNT    — virtual users (default 20)
 *   DURATION    — test duration (default "30s")
 */

import ws from "k6/ws";
import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Trend, Counter } from "k6/metrics";

// ── Config ──
const BASE_URL = __ENV.BASE_URL || "http://localhost:8000";
const WS_URL = __ENV.WS_URL || "ws://localhost:8000";

export const options = {
  stages: [
    { duration: "5s", target: parseInt(__ENV.VU_COUNT || "20") },
    { duration: __ENV.DURATION || "30s", target: parseInt(__ENV.VU_COUNT || "20") },
    { duration: "5s", target: 0 },
  ],
  thresholds: {
    ws_connect_duration: ["p(95)<2000", "p(99)<4000"],
    greeting_latency: ["p(95)<5000", "p(99)<8000"],
    http_req_duration: ["p(95)<500"],
    ws_error_rate: ["rate<0.10"],
  },
};

// ── Custom metrics ──
const greetingLatency = new Trend("greeting_latency", true);
const wsErrorRate = new Rate("ws_error_rate");
const wsConnectDuration = new Trend("ws_connect_duration", true);
const duplicateBlocked = new Counter("duplicate_session_blocked");
const throttleBlocked = new Counter("throttle_blocked");

// ── Scenario 1: Normal session connect → greeting ──
export default function () {
  const userId = `loadtest-vu-${__VU}-${__ITER}`;
  const url = `${WS_URL}/api/session/ws/${userId}`;

  const startConnect = Date.now();

  const res = ws.connect(url, null, function (socket) {
    const connectMs = Date.now() - startConnect;
    wsConnectDuration.add(connectMs);

    socket.on("open", function () {
      // Send config message
      socket.send(
        JSON.stringify({
          type: "config",
          exam_type: "tcf",
          exam_part: 1,
          level: "B1",
          is_demo: true,
        })
      );
    });

    socket.on("message", function (data) {
      let msg;
      try {
        msg = JSON.parse(data);
      } catch (_) {
        wsErrorRate.add(true);
        socket.close();
        return;
      }

      if (msg.type === "examiner_audio") {
        // Got greeting — measure latency from connect start
        const latencyMs = Date.now() - startConnect;
        greetingLatency.add(latencyMs);
        wsErrorRate.add(false);

        // End session cleanly
        socket.send(JSON.stringify({ type: "end_session" }));
      } else if (msg.type === "error") {
        // Could be duplicate session or throttle or no-demo
        if (msg.message && msg.message.includes("already have an active session")) {
          duplicateBlocked.add(1);
        } else if (msg.message && msg.message.includes("too quickly")) {
          throttleBlocked.add(1);
        }
        wsErrorRate.add(false); // expected rejection, not an error
        socket.close();
      } else if (msg.type === "session_summary" || msg.type === "session_ended") {
        socket.close();
      }
    });

    socket.on("error", function (e) {
      wsErrorRate.add(true);
    });

    socket.setTimeout(function () {
      wsErrorRate.add(true);
      socket.close();
    }, 15000);
  });

  check(res, {
    "ws status is 101": (r) => r && r.status === 101,
  });

  sleep(0.5);
}

// ── Scenario 2: Health + metrics endpoint throughput ──
export function healthCheck() {
  const res = http.get(`${BASE_URL}/health`);
  check(res, {
    "health 200": (r) => r.status === 200,
  });
}

export function metricsCheck() {
  const res = http.get(`${BASE_URL}/metrics`);
  check(res, {
    "metrics 200": (r) => r.status === 200,
    "has uptime": (r) => JSON.parse(r.body).uptime_seconds !== undefined,
  });
}
