/**
 * Cover the Phase 6 turn 2 `tipDriver` extension. The pre-existing
 * `completeTrip` / `cancelTrip` paths are exercised end-to-end via the
 * `FirestoreRideRepository` adapter tests — this file only adds coverage
 * for the new method's wiring + error mapping.
 */

import { httpsCallable } from '@react-native-firebase/functions';

import { CloudFunctionsService } from '../CloudFunctionsService';

jest.mock('@react-native-firebase/app', () => ({
  getApp: jest.fn(() => ({})),
}));

jest.mock('@react-native-firebase/functions', () => ({
  getFunctions: jest.fn(() => ({})),
  httpsCallable: jest.fn(),
}));

const mockHttpsCallable = httpsCallable as jest.MockedFunction<
  typeof httpsCallable
>;

describe('CloudFunctionsService.tipDriver', () => {
  beforeEach(() => {
    mockHttpsCallable.mockReset();
  });

  it('routes to the tipDriver callable with tipAmount in dollars', async () => {
    const callable = jest.fn().mockResolvedValue({
      data: { success: true, paymentId: 'pi_xyz' },
    });
    mockHttpsCallable.mockReturnValue(
      callable as unknown as ReturnType<typeof httpsCallable>,
    );

    const svc = new CloudFunctionsService();
    const r = await svc.tipDriver({
      tripId: 'trip_abc',
      tipAmountDollars: 3,
    });

    expect(mockHttpsCallable).toHaveBeenCalledWith(
      expect.anything(),
      'tipDriver',
    );
    expect(callable).toHaveBeenCalledWith({
      tripId: 'trip_abc',
      tipAmount: 3,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.success).toBe(true);
      expect(r.value.paymentId).toBe('pi_xyz');
    }
  });

  it('maps functions/permission-denied to AuthorizationError', async () => {
    const e = Object.assign(new Error('Only the rider can tip'), {
      code: 'functions/permission-denied',
      details: { code: 'tip_not_passenger' },
    });
    const callable = jest.fn().mockRejectedValue(e);
    mockHttpsCallable.mockReturnValue(
      callable as unknown as ReturnType<typeof httpsCallable>,
    );

    const r = await new CloudFunctionsService().tipDriver({
      tripId: 'trip_abc',
      tipAmountDollars: 3,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('authorization');
      expect(r.error.code).toBe('tip_not_passenger');
    }
  });

  it('maps functions/failed-precondition to ValidationError (e.g. trip not completed)', async () => {
    const e = Object.assign(new Error('Can only tip on completed trips'), {
      code: 'functions/failed-precondition',
      details: { code: 'trip_not_completed' },
    });
    const callable = jest.fn().mockRejectedValue(e);
    mockHttpsCallable.mockReturnValue(
      callable as unknown as ReturnType<typeof httpsCallable>,
    );

    const r = await new CloudFunctionsService().tipDriver({
      tripId: 'trip_abc',
      tipAmountDollars: 3,
    });
    if (!r.ok) {
      expect(r.error.kind).toBe('validation');
      expect(r.error.code).toBe('trip_not_completed');
    }
  });

  it('maps an unknown code to NetworkError', async () => {
    const e = Object.assign(new Error('boom'), {
      code: 'functions/internal',
      details: undefined,
    });
    const callable = jest.fn().mockRejectedValue(e);
    mockHttpsCallable.mockReturnValue(
      callable as unknown as ReturnType<typeof httpsCallable>,
    );

    const r = await new CloudFunctionsService().tipDriver({
      tripId: 'trip_abc',
      tipAmountDollars: 3,
    });
    if (!r.ok) expect(r.error.kind).toBe('network');
  });
});
