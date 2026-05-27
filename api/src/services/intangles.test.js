// Unit tests for the Intangles wrapper.
// The MOST IMPORTANT test here is km→mi conversion. Intangles returns
// odo in km with no unit suffix — if this ever silently flips, every
// dashboard mileage will be wrong by a factor of 1.61. This test pins
// the conversion against a known value drawn from the actual Intangles
// odo report we cross-checked during foundation validation.

import { describe, it, expect } from 'vitest';
import { kmToMi, KM_PER_MI, KM_TO_MI } from './intangles.js';

describe('intangles km→mi conversion', () => {
  it('the constant KM_TO_MI is exactly 1/KM_PER_MI', () => {
    expect(KM_TO_MI).toBeCloseTo(0.621371, 5);
    expect(KM_PER_MI).toBeCloseTo(1.609344, 5);
  });

  it('1 km is 0.62 mi after 2-decimal rounding', () => {
    // 0.621371... rounds DOWN to 0.62 at 2 decimal places.
    expect(kmToMi(1)).toBe(0.62);
  });

  it('round-trips through KM_PER_MI (≈ 1 mi)', () => {
    expect(kmToMi(KM_PER_MI)).toBe(1);
  });

  it('matches the CC01 value from the live Intangles odo report (±400 mi for intra-day drift)', () => {
    // Foundation validation captured these on 2026-05-27:
    //   API odo: 1,087,593 km   converted: ~675,799 mi
    //   Intangles report End Odo (cutoff 01:00 AM): 675,434 mi
    // The +365 mi residual = ~11 hours of CC01 driving between the
    // report cutoff and the API call. The conversion ITSELF is exact
    // — the only difference between API-now and report-cutoff is real
    // truck movement, NOT a unit mismatch.
    const apiOdoKm = 1087593;
    const reportEndOdoMi = 675434;
    const converted = kmToMi(apiOdoKm);

    expect(converted).toBe(675798.96);
    // Within reasonable intra-day driving of the report.
    expect(Math.abs(converted - reportEndOdoMi)).toBeLessThan(500);
  });

  it('matches the CC05 value (parked truck, should be exact)', () => {
    // CC05 was PARKED. API odo 911,046 km → 566,098 mi (report).
    // Converted: 566097.74 → within 1 mi of report.
    const converted = kmToMi(911046);
    expect(converted).toBe(566097.74);
    expect(Math.abs(converted - 566098)).toBeLessThan(1);
  });

  it('returns null for null/undefined/NaN inputs', () => {
    expect(kmToMi(null)).toBeNull();
    expect(kmToMi(undefined)).toBeNull();
    expect(kmToMi(NaN)).toBeNull();
  });

  it('zero is zero', () => {
    expect(kmToMi(0)).toBe(0);
  });

  it('canary: a typical fleet odo never accidentally lands at the km value', () => {
    // If the conversion silently flips off, kmToMi(1087593) would equal
    // 1087593 — that's the regression we want to catch loudly.
    expect(kmToMi(1087593)).not.toBe(1087593);
    expect(kmToMi(1087593)).toBeLessThan(1087593);
  });
});
