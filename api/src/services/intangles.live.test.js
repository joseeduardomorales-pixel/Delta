// LIVE integration test against the real Intangles US endpoint.
// Skipped if INTANGLES_VENDOR_ACCESS_TOKEN is not set in the env.
// Asserts: every truck we expected in Alvys (CC01..CC17) is visible
// in Intangles with a non-null mileage that's well above 100,000 mi
// (these are real fleet trucks; nothing below that makes sense).

import { describe, it, expect, beforeAll } from 'vitest';
import { listVehicles } from './intangles.js';

const HAS_TOKEN = Boolean(process.env.INTANGLES_VENDOR_ACCESS_TOKEN);

describe.runIf(HAS_TOKEN)('intangles live — fleet visibility', () => {
  let vehicles;

  beforeAll(async () => {
    vehicles = await listVehicles();
  }, 30_000);

  it('returns at least 17 vehicles (Cold Cargo fleet)', () => {
    expect(vehicles.length).toBeGreaterThanOrEqual(17);
  });

  it('CC01..CC17 plates all present', () => {
    const plates = new Set(vehicles.map((v) => v.plate));
    for (let i = 1; i <= 17; i++) {
      const p = `CC${String(i).padStart(2, '0')}`;
      expect(plates.has(p), `expected ${p} in fleet`).toBe(true);
    }
  });

  it('every truck has odo_mi populated and > 100k', () => {
    for (const v of vehicles) {
      expect(v.odo_mi, `truck ${v.plate} odo_mi`).not.toBeNull();
      expect(v.odo_mi).toBeGreaterThan(100_000);
      // Sanity: shouldn't be 1.6x higher than typical fleet range
      expect(v.odo_mi).toBeLessThan(2_000_000);
    }
  });

  it('odo_mi is ALWAYS less than odo_km (proves conversion ran)', () => {
    for (const v of vehicles) {
      if (v.odo_km && v.odo_mi) {
        expect(v.odo_mi).toBeLessThan(v.odo_km);
      }
    }
  });
});
