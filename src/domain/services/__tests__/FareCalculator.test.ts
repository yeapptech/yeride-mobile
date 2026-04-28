import { Money } from '../../entities/Money';
import { FareCalculator } from '../FareCalculator';

function unwrap<T>(r: { ok: true; value: T } | { ok: false; error: Error }): T {
  if (!r.ok) throw r.error;
  return r.value;
}

function usd(major: number) {
  return unwrap(Money.fromMajor(major, 'USD'));
}

// Pricing matching the legacy CLAUDE.md example:
//   { baseFare: 1.5, minimumFare: 5, cancelationFee: 5,
//     costPerKm: 0.35, costPerMinute: 0.2 }
const ECONOMY = {
  baseFare: usd(1.5),
  minimumFare: usd(5),
  costPerKm: usd(0.35),
  costPerMinute: usd(0.2),
};

describe('FareCalculator.estimate', () => {
  it('applies the legacy formula for a typical trip', () => {
    // 5 km, 12 minutes
    //   distanceCost = (5_000/1000) * 0.35   = 1.75
    //   durationCost = (720/60)     * 0.20   = 2.40
    //   raw          = 1.50 + 1.75 + 2.40    = 5.65
    //   minimumFare  = 5.00 → raw wins
    const r = FareCalculator.estimate({
      rideService: ECONOMY,
      distanceMeters: 5_000,
      durationSeconds: 720,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.format()).toBe('$5.65');
  });

  it('floors at the minimum fare for a short trip', () => {
    // 500 m, 60 s
    //   distanceCost = 0.5 * 0.35 = 0.175 → 17.5 → 18 cents
    //   durationCost = 1   * 0.20 = 0.20  = 20 cents
    //   raw          = 150 + 18 + 20 = 188 cents = $1.88
    //   minimumFare  = $5.00 → minimumFare wins
    const r = FareCalculator.estimate({
      rideService: ECONOMY,
      distanceMeters: 500,
      durationSeconds: 60,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.format()).toBe('$5.00');
  });

  it('returns the base fare alone for a zero-distance, zero-duration trip', () => {
    // raw = $1.50 → minimum $5 wins
    const r = FareCalculator.estimate({
      rideService: ECONOMY,
      distanceMeters: 0,
      durationSeconds: 0,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.format()).toBe('$5.00');
  });

  it('handles a long trip well above the minimum', () => {
    // 50 km, 60 minutes
    //   distanceCost = 50 * 0.35  = 17.50
    //   durationCost = 60 * 0.20  = 12.00
    //   raw          = 1.50 + 17.50 + 12.00 = 31.00
    const r = FareCalculator.estimate({
      rideService: ECONOMY,
      distanceMeters: 50_000,
      durationSeconds: 3_600,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.format()).toBe('$31.00');
  });

  it('rejects negative distance', () => {
    const r = FareCalculator.estimate({
      rideService: ECONOMY,
      distanceMeters: -1,
      durationSeconds: 60,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('fare_invalid_distance');
  });

  it('rejects non-finite duration', () => {
    const r = FareCalculator.estimate({
      rideService: ECONOMY,
      distanceMeters: 1_000,
      durationSeconds: Number.POSITIVE_INFINITY,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('fare_invalid_duration');
  });

  it('matches the boundary case where raw == minimum', () => {
    // Distance + duration tuned so the formula equals exactly $5.00.
    //   raw = 150 + 175 + 175 = 500 cents ($5.00)
    //   distanceCost 175c → 1.75 → 5 km at $0.35/km
    //   durationCost 175c → 1.75 → 8.75 min at $0.20/min = 525 s
    const r = FareCalculator.estimate({
      rideService: ECONOMY,
      distanceMeters: 5_000,
      durationSeconds: 525,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.format()).toBe('$5.00');
  });
});
