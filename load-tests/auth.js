/**
 * k6 load test — auth endpoints (login + token refresh)
 *
 * The server uses httpOnly cookies exclusively — tokens are NOT in the response body.
 * This test uses k6's cookie jar to carry the refresh_token cookie from login to refresh.
 *
 * Usage:
 *   TEST_EMAIL=user@example.com TEST_PASSWORD=secret k6 run load-tests/auth.js
 *
 * Prerequisites:
 *   The TEST_EMAIL account must already exist. Run setup() once to create it, or pre-seed.
 *
 * Thresholds:
 *   - p95 login < 500 ms
 *   - p95 refresh < 200 ms
 *   - error rate < 0.5%
 */

import http from "k6/http";
import { check, sleep } from "k6";
import { Rate } from "k6/metrics";

const BASE_URL = __ENV.BASE_URL || "http://localhost:8080";
const EMAIL = __ENV.TEST_EMAIL;
const PASSWORD = __ENV.TEST_PASSWORD;

if (!EMAIL || !PASSWORD) {
  throw new Error("TEST_EMAIL and TEST_PASSWORD env vars are required. Example: TEST_EMAIL=user@example.com TEST_PASSWORD=secret k6 run load-tests/auth.js");
}

export const options = {
  stages: [
    { duration: "10s", target: 5 },
    { duration: "30s", target: 20 },
    { duration: "10s", target: 0 },
  ],
  thresholds: {
    "http_req_duration{endpoint:login}": ["p(95)<500"],
    "http_req_duration{endpoint:refresh}": ["p(95)<200"],
    http_req_failed: ["rate<0.005"],
  },
};

const errorRate = new Rate("errors");

/**
 * Ensure the test account exists before load begins.
 * Accepts 409 (already exists) as a success condition.
 */
export function setup() {
  const res = http.post(
    `${BASE_URL}/api/v1/auth/signup`,
    JSON.stringify({ email: EMAIL, password: PASSWORD, name: "Load Test User" }),
    { headers: { "Content-Type": "application/json" } }
  );
  if (res.status !== 201 && res.status !== 409) {
    console.warn(`setup: unexpected status ${res.status} — test user may not exist`);
  }
}

export default function () {
  // Each VU gets its own cookie jar so httpOnly cookies are forwarded automatically.
  const jar = http.cookieJar();

  // Login — server sets refresh_token as httpOnly cookie
  const loginRes = http.post(
    `${BASE_URL}/api/v1/auth/login`,
    JSON.stringify({ email: EMAIL, password: PASSWORD }),
    {
      headers: { "Content-Type": "application/json" },
      jar,
      tags: { endpoint: "login" },
    }
  );

  const loginOk = check(loginRes, {
    "login 200": (r) => r.status === 200,
    "has user data": (r) => {
      try {
        return JSON.parse(r.body).data?.user?.id !== undefined;
      } catch {
        return false;
      }
    },
  });

  errorRate.add(!loginOk);

  if (!loginOk) {
    sleep(1);
    return;
  }

  sleep(0.5);

  // Refresh — relies on the httpOnly refresh_token cookie set during login
  const refreshRes = http.post(
    `${BASE_URL}/api/v1/auth/refresh`,
    null,
    {
      jar,
      tags: { endpoint: "refresh" },
    }
  );

  const refreshOk = check(refreshRes, {
    "refresh 200": (r) => r.status === 200,
    "has expires_in": (r) => {
      try {
        return JSON.parse(r.body).data?.expires_in !== undefined;
      } catch {
        return false;
      }
    },
  });

  errorRate.add(!refreshOk);

  sleep(1);
}
