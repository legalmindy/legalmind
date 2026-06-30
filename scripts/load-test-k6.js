/**
 * k6 load test template — run against STAGING only.
 * Install: https://k6.io/docs/get-started/installation/
 * Usage:
 *   k6 run -e SUPABASE_URL=... -e SUPABASE_ANON_KEY=... -e TEST_EMAIL=... -e TEST_PASSWORD=... scripts/load-test-k6.js
 */
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '1m', target: 100 },
    { duration: '2m', target: 500 },
    { duration: '2m', target: 1000 },
    { duration: '2m', target: 5000 },
    { duration: '1m', target: 0 }
  ],
  thresholds: {
    http_req_failed: ['rate<0.05'],
    http_req_duration: ['p(95)<3000']
  }
};

const base = __ENV.SUPABASE_URL;
const anon = __ENV.SUPABASE_ANON_KEY;

export default function () {
  const headers = {
    apikey: anon,
    Authorization: `Bearer ${anon}`,
    'Content-Type': 'application/json'
  };

  const health = http.post(
    `${base}/rest/v1/rpc/list_approved_testimonials`,
    JSON.stringify({ p_limit: 5 }),
    { headers }
  );
  check(health, { 'public testimonials 200': (r) => r.status === 200 });

  if (__ENV.TEST_EMAIL && __ENV.TEST_PASSWORD) {
    const login = http.post(
      `${base}/auth/v1/token?grant_type=password`,
      JSON.stringify({ email: __ENV.TEST_EMAIL, password: __ENV.TEST_PASSWORD }),
      { headers: { ...headers, 'Content-Type': 'application/json' } }
    );
    check(login, { 'login 200': (r) => r.status === 200 });
    if (login.status === 200) {
      const token = login.json('access_token');
      const authed = {
        apikey: anon,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      };
      const cases = http.get(`${base}/rest/v1/cases?select=id&limit=20`, { headers: authed });
      check(cases, { 'cases 200': (r) => r.status === 200 });
    }
  }

  sleep(1);
}
