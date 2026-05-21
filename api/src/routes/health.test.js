import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';

describe('GET /health', () => {
  const app = createApp();

  it('returns 200 within 200ms with the expected shape', async () => {
    const started = Date.now();
    const res = await request(app).get('/health');
    const elapsed = Date.now() - started;

    expect(res.status).toBe(200);
    expect(elapsed).toBeLessThan(200);

    expect(res.body).toMatchObject({
      status: 'ok',
      env: expect.any(String),
      version: expect.any(String),
      db: 'unchecked',
      claude: 'unchecked',
      intangles: 'unchecked',
      lastSync: null,
    });
    expect(typeof res.body.uptime).toBe('number');
  });

  it('does not expose x-powered-by', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});
