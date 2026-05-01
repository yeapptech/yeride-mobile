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

describe('CloudFunctionsService.completeTrip wire-format translation', () => {
  beforeEach(() => {
    mockHttpsCallable.mockReset();
  });

  // Regression test for the Phase 8 turn 2 RequestPayment failure:
  // the deployed Cloud Function reads `request.data.odometer` (legacy
  // yeride parity), but the rewrite's domain layer carries
  // `odometerMeters` (semantic / typed). The adapter translates
  // `odometerMeters` → `odometer` at the wire boundary so domain code
  // keeps its semantics. Without this rename the function throws
  // `invalid-argument: "odometer must be a non-negative number"`.
  it('translates domain `odometerMeters` to wire `odometer` on the completeTrip payload', async () => {
    const callable = jest.fn().mockResolvedValue({
      data: { fare: 1234, appChargesTotal: 200 },
    });
    mockHttpsCallable.mockReturnValue(
      callable as unknown as ReturnType<typeof httpsCallable>,
    );

    const svc = new CloudFunctionsService();
    const r = await svc.completeTrip({
      tripId: 'trip_abc',
      odometerMeters: 5432,
    });

    expect(mockHttpsCallable).toHaveBeenCalledWith(
      expect.anything(),
      'completeTrip',
    );
    expect(callable).toHaveBeenCalledWith({
      tripId: 'trip_abc',
      odometer: 5432,
    });
    // Critical assertion: NO `odometerMeters` field on the wire payload.
    const wirePayload = callable.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(wirePayload).not.toHaveProperty('odometerMeters');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.fare).toBe(1234);
      expect(r.value.appChargesTotal).toBe(200);
    }
  });

  // RNFirebase v24+ regression: the SDK surfaces bare error codes
  // (`invalid-argument`), older versions and the JS docs use the
  // `functions/`-prefixed form. Both must map to ValidationError.
  it('maps bare `invalid-argument` (RNFirebase v24+) to ValidationError', async () => {
    const e = Object.assign(
      new Error('odometer must be a non-negative number'),
      {
        code: 'invalid-argument',
        details: undefined,
      },
    );
    const callable = jest.fn().mockRejectedValue(e);
    mockHttpsCallable.mockReturnValue(
      callable as unknown as ReturnType<typeof httpsCallable>,
    );

    const r = await new CloudFunctionsService().completeTrip({
      tripId: 'trip_abc',
      odometerMeters: 5432,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('validation');
      // Falls back to synthesized `cf_<op>_<normalized-code>` when no
      // `details.code` is provided.
      expect(r.error.code).toBe('cf_completeTrip_invalid_argument');
    }
  });

  it('maps bare `permission-denied` to AuthorizationError', async () => {
    const e = Object.assign(new Error('Not the assigned driver'), {
      code: 'permission-denied',
      details: { code: 'not_assigned_driver' },
    });
    const callable = jest.fn().mockRejectedValue(e);
    mockHttpsCallable.mockReturnValue(
      callable as unknown as ReturnType<typeof httpsCallable>,
    );

    const r = await new CloudFunctionsService().completeTrip({
      tripId: 'trip_abc',
      odometerMeters: 5432,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('authorization');
      expect(r.error.code).toBe('not_assigned_driver');
    }
  });
});

describe('CloudFunctionsService.cancelTrip wire-format translation', () => {
  beforeEach(() => {
    mockHttpsCallable.mockReset();
  });

  // Regression test for Phase 3 latent bug surfaced during the Phase 8
  // turn 3 device-build smoke: the deployed Cloud Function reads
  // `request.data.reason` (legacy yeride parity), but the rewrite's
  // domain layer carries `CancellationReason.code`. The adapter
  // translates `code` → `reason` at the wire boundary so domain code
  // keeps its semantics. Without this rename the function throws
  // `invalid-argument: "reason is required"`.
  it('translates domain `code` to wire `reason` on the cancelTrip payload', async () => {
    const callable = jest.fn().mockResolvedValue({
      data: { cancellationFee: 0 },
    });
    mockHttpsCallable.mockReturnValue(
      callable as unknown as ReturnType<typeof httpsCallable>,
    );

    const svc = new CloudFunctionsService();
    await svc.cancelTrip({
      tripId: 'trip_abc',
      by: 'rider',
      code: 'changed_mind',
      reasonText: null,
      odometerMeters: null,
    });

    expect(mockHttpsCallable).toHaveBeenCalledWith(
      expect.anything(),
      'cancelTrip',
    );
    expect(callable).toHaveBeenCalledWith({
      tripId: 'trip_abc',
      by: 'rider',
      reason: 'changed_mind',
      reasonText: null,
      odometerMeters: null,
    });
    // Critical assertion: NO `code` field on the wire payload.
    const wirePayload = callable.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(wirePayload).not.toHaveProperty('code');
  });

  it('forwards reasonText and odometerMeters when provided', async () => {
    const callable = jest.fn().mockResolvedValue({
      data: { cancellationFee: 5 },
    });
    mockHttpsCallable.mockReturnValue(
      callable as unknown as ReturnType<typeof httpsCallable>,
    );

    await new CloudFunctionsService().cancelTrip({
      tripId: 'trip_xyz',
      by: 'driver',
      code: 'other',
      reasonText: 'flat tire',
      odometerMeters: 12345,
    });

    expect(callable).toHaveBeenCalledWith({
      tripId: 'trip_xyz',
      by: 'driver',
      reason: 'other',
      reasonText: 'flat tire',
      odometerMeters: 12345,
    });
  });
});
