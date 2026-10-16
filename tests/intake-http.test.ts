import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readBody, sameOrigin } from '../src/lib/intake-http';

test('origin uses incoming host even when Next normalizes the URL', () => {
  const request = new Request('http://localhost:3001/api/intake', { headers: { host: '127.0.0.1:3001', origin: 'http://127.0.0.1:3001', 'content-type': 'application/json' } });
  assert.doesNotThrow(() => sameOrigin(request));
  for (const origin of ['https://other.example', 'null', '']) {
    assert.throws(() => sameOrigin(new Request(request.url, { headers: { host: '127.0.0.1:3001', origin, 'content-type': 'application/json' } })));
  }
});
test('rejects malformed and oversized JSON', async () => {
  await assert.rejects(readBody(new Request('http://localhost', { method: 'POST', body: '{' })));
  await assert.rejects(readBody(new Request('http://localhost', { method: 'POST', body: 'x'.repeat(4097) })));
});
