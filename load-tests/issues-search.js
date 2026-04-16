/**
 * k6 load test — issues search endpoint
 *
 * Simulates concurrent dashboard users performing issue searches.
 *
 * Usage:
 *   ACCESS_TOKEN=<token> PROJECT_ID=<id> k6 run load-tests/issues-search.js
 *
 * Thresholds:
 *   - p95 < 500 ms
 *   - p99 < 1000 ms
 *   - error rate < 1%
 */

import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Trend } from "k6/metrics";

const BASE_URL = __ENV.BASE_URL || "http://localhost:8080";
const ACCESS_TOKEN = __ENV.ACCESS_TOKEN;
const PROJECT_ID = __ENV.PROJECT_ID || "test-project-id";

if (!ACCESS_TOKEN) {
  throw new Error("ACCESS_TOKEN env var is required. Example: ACCESS_TOKEN=<token> PROJECT_ID=<id> k6 run load-tests/issues-search.js");
}

export const options = {
  stages: [
    { duration: "10s", target: 10 },
    { duration: "60s", target: 30 },
    { duration: "10s", target: 0 },
  ],
  thresholds: {
    http_req_duration: ["p(95)<500", "p(99)<1000"],
    http_req_failed: ["rate<0.01"],
  },
};

const errorRate = new Rate("errors");
const searchDuration = new Trend("search_duration", true);

const FILTER_VARIANTS = [
  {},
  { status: "unresolved" },
  { status: "resolved" },
  { search: "TypeError" },
  { environment: "production" },
  { status: "unresolved", environment: "production" },
  { level: "error" },
];

export default function () {
  // Use (__VU + __ITER) so different VUs hit different filter variants simultaneously,
  // exercising concurrent mixed-filter load rather than all VUs using the same query plan.
  const filters = FILTER_VARIANTS[(__VU + __ITER) % FILTER_VARIANTS.length];

  const body = JSON.stringify({
    page: 1,
    per_page: 25,
    sort: "last_seen",
    order: "desc",
    filters: Object.keys(filters).length > 0 ? filters : undefined,
  });

  const res = http.post(
    `${BASE_URL}/api/v1/projects/${PROJECT_ID}/issues/search`,
    body,
    {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ACCESS_TOKEN}`,
      },
    }
  );

  const ok = check(res, {
    "status 200": (r) => r.status === 200,
    "has issues array": (r) => {
      try {
        const data = JSON.parse(r.body);
        return Array.isArray(data.data);
      } catch {
        return false;
      }
    },
  });

  errorRate.add(!ok);
  searchDuration.add(res.timings.duration);

  sleep(0.5);
}
