import { NetworkError, ValidationError } from '@domain/errors';

import { FakeCloudFunctionsService } from '../FakeCloudFunctionsService';

describe('FakeCloudFunctionsService', () => {
  it('tipDriver returns the default seeded payment id', async () => {
    const svc = new FakeCloudFunctionsService();
    const r = await svc.tipDriver({
      tripId: 'trip_a',
      tipAmountDollars: 3,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.success).toBe(true);
      expect(r.value.paymentId).toBe('pi_fake_tip');
    }
  });

  it('tipDriver returns the per-trip seeded result when present', async () => {
    const svc = new FakeCloudFunctionsService();
    svc.seedTipDriverResult({
      tripId: 'trip_a',
      result: { success: true, paymentId: 'pi_custom' },
    });
    const r = await svc.tipDriver({
      tripId: 'trip_a',
      tipAmountDollars: 3,
    });
    if (r.ok) expect(r.value.paymentId).toBe('pi_custom');
  });

  it('records calls to tipDriver in spies', async () => {
    const svc = new FakeCloudFunctionsService();
    await svc.tipDriver({ tripId: 'trip_a', tipAmountDollars: 5 });
    await svc.tipDriver({ tripId: 'trip_b', tipAmountDollars: 1 });
    expect(svc.spies.tipDriverCalls).toEqual([
      { tripId: 'trip_a', tipAmountDollars: 5 },
      { tripId: 'trip_b', tipAmountDollars: 1 },
    ]);
  });

  it('failNext is one-shot: subsequent calls run the seeded path', async () => {
    const svc = new FakeCloudFunctionsService();
    svc.failNext({
      method: 'tipDriver',
      error: new NetworkError({
        code: 'tip_network_down',
        message: 'down',
      }),
    });
    const r1 = await svc.tipDriver({
      tripId: 'trip_a',
      tipAmountDollars: 3,
    });
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.error.kind).toBe('network');
    const r2 = await svc.tipDriver({
      tripId: 'trip_a',
      tipAmountDollars: 3,
    });
    expect(r2.ok).toBe(true);
  });

  it('failNext targeted at one method does not affect others', async () => {
    const svc = new FakeCloudFunctionsService();
    svc.failNext({
      method: 'completeTrip',
      error: new ValidationError({ code: 'x', message: 'x' }),
    });
    const tip = await svc.tipDriver({
      tripId: 'trip_a',
      tipAmountDollars: 3,
    });
    expect(tip.ok).toBe(true);
    const complete = await svc.completeTrip({
      tripId: 'trip_a',
      odometerMeters: 10,
    });
    expect(complete.ok).toBe(false);
  });

  it('reset clears seeds, failures, and spies', async () => {
    const svc = new FakeCloudFunctionsService();
    svc.seedTipDriverResult({
      tripId: 'trip_a',
      result: { success: true, paymentId: 'pi_x' },
    });
    await svc.tipDriver({ tripId: 'trip_a', tipAmountDollars: 3 });
    svc.reset();
    expect(svc.spies.tipDriverCalls).toEqual([]);
    const r = await svc.tipDriver({
      tripId: 'trip_a',
      tipAmountDollars: 3,
    });
    if (r.ok) expect(r.value.paymentId).toBe('pi_fake_tip'); // back to default
  });
});
