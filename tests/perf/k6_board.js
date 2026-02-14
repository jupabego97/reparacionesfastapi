import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  vus: 50,
  duration: '1m',
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8000';

export default function () {
  const res = http.get(`${BASE_URL}/api/tarjetas?view=board&page=1&per_page=200`);
  check(res, {
    'status is 200': (r) => r.status === 200,
    'has tarjetas payload': (r) => r.body && r.body.includes('tarjetas'),
  });
  sleep(1);
}
