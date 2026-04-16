/**
 * k6 load test — event ingest endpoint
 *
 * Usage:
 *   k6 run load-tests/ingest.js
 *   k6 run --vus 50 --duration 60s load-tests/ingest.js
 *   BASE_URL=https://api.example.com k6 run load-tests/ingest.js
 *
 * Thresholds (adjust to match your SLOs):
 *   - p95 response time < 300 ms
 *   - error rate < 1%
 */

import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Trend } from "k6/metrics";

const BASE_URL = __ENV.BASE_URL || "http://localhost:8080";
const API_KEY = __ENV.API_KEY;
if (!API_KEY) {
  throw new Error("API_KEY env var is required. Example: API_KEY=your-project-api-key k6 run load-tests/ingest.js");
}

export const options = {
  stages: [
    { duration: "10s", target: 10 },  // ramp up
    { duration: "30s", target: 50 },  // steady load
    { duration: "10s", target: 0 },   // ramp down
  ],
  thresholds: {
    http_req_duration: ["p(95)<300", "p(99)<1000"],
    http_req_failed: ["rate<0.01"],
  },
};

const errorRate = new Rate("errors");
const ingestDuration = new Trend("ingest_duration", true);

export default function () {
  const payload = JSON.stringify({
    event_type: "error",
    timestamp: new Date().toISOString(),
    exception: {
      type: "TypeError",
      value: `Load test error ${__ITER}`,
      stacktrace: {
        frames: [
          { filename: "app.js", lineno: 42, colno: 10, function: "handleRequest" },
          { filename: "server.js", lineno: 100, colno: 5, function: "listen" },
        ],
      },
    },
    environment: "load-test",
    release: "1.0.0",
  });

  const params = {
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": API_KEY,
    },
  };

  const res = http.post(`${BASE_URL}/api/v1/events`, payload, params);

  const ok = check(res, {
    "status 202": (r) => r.status === 202,
    "has event id": (r) => {
      try {
        return JSON.parse(r.body).id !== undefined;
      } catch {
        return false;
      }
    },
  });

  errorRate.add(!ok);
  ingestDuration.add(res.timings.duration);

  sleep(0.1);
}
