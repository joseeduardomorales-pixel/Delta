// LIVE integration test against TrackFleet (tracking.lt) US endpoint.
// Skipped if credentials are absent.
// Validates: auth flow, carlist returns trailers, reeferPeriod returns
// work_hours/engine_hours for at least one trailer.

import { describe, it, expect, beforeAll } from 'vitest';
import { listCarlist, getLatestReeferData } from './trackfleet.js';

const HAS_CREDS =
  Boolean(process.env.TRACKFLEET_USERCODE) &&
  Boolean(process.env.TRACKFLEET_USERNAME) &&
  Boolean(process.env.TRACKFLEET_PASSWORD);

describe.runIf(HAS_CREDS)('trackfleet live', () => {
  let trailers;

  beforeAll(async () => {
    const list = await listCarlist();
    trailers = list.filter((c) => c.type === 'trailer');
  }, 30_000);

  it('carlist has at least 1 trailer', () => {
    expect(trailers.length).toBeGreaterThan(0);
  });

  it(
    'reeferPeriod returns work_hours + engine_hours for a real trailer',
    async () => {
      // Pick the first trailer
      const target = trailers[0];
      const out = await getLatestReeferData([target.licence], { hoursBack: 72 });
      expect(out.length).toBe(1);
      const r = out[0];
      expect(r.licence).toBe(target.licence);

      // At least one point in window — trailers report frequently
      expect(r.points_in_window).toBeGreaterThan(0);

      // Latest reading should have at least one of work_hours/engine_hours.
      // (Some trailers may not report both, so just require one populated.)
      expect(r.latest).not.toBeNull();
      const hasHours =
        r.latest.work_hours != null || r.latest.engine_hours != null;
      expect(hasHours, 'expected work_hours or engine_hours on latest point').toBe(true);

      // Sanity: reefer hours for a working unit should be > 0 and < 100k.
      if (r.latest.engine_hours != null) {
        expect(r.latest.engine_hours).toBeGreaterThan(0);
        expect(r.latest.engine_hours).toBeLessThan(100_000);
      }
    },
    30_000,
  );
});
