import http from "k6/http";
import { check, sleep } from "k6";
import { Rate } from "k6/metrics";

export const errorRate = new Rate("errors");

export const options = {
  stages: [
    { duration: "30s", target: 10 },
    { duration: "1m", target: 50 },
    { duration: "2m", target: 100 },
    { duration: "30s", target: 0 },
  ],
  thresholds: {
    http_req_duration: ["p(95)<500"],
    errors: ["rate<0.01"],
  },
};

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";
const API_KEY = __ENV.API_KEY || "bw_test_key";

export default function () {
  const payload = JSON.stringify({
    event_id: `load-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    timestamp: new Date().toISOString(),
    message: "TypeError: Cannot read properties of undefined",
    level: "error",
    platform: "javascript",
    exception: {
      type: "TypeError",
      value: "Cannot read properties of undefined (reading 'id')",
      stacktrace: [
        { filename: "app.js", lineno: 42, colno: 10, function: "handleClick" },
        { filename: "react-dom.js", lineno: 1234, function: "dispatchEvent" },
      ],
    },
  });

  const res = http.post(`${BASE_URL}/api/v1/events`, payload, {
    headers: {
      "Content-Type": "application/json",
      "x-api-key": API_KEY,
    },
  });

  const ok = check(res, {
    "status 200 or 202": (r) => r.status === 200 || r.status === 202,
    "response time < 500ms": (r) => r.timings.duration < 500,
  });

  errorRate.add(!ok);
  sleep(0.1);
}
