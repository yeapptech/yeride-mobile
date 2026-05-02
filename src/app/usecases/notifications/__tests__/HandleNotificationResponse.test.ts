import type { NotificationData, NotificationResponse } from '@domain/services';

import { HandleNotificationResponse } from '../HandleNotificationResponse';

function response(data: NotificationData): NotificationResponse {
  return {
    title: null,
    body: null,
    data,
    receivedAt: new Date('2026-05-02T12:00:00Z'),
  };
}

const TRIP_ID = 'trip12345abc';

describe('HandleNotificationResponse — driver-side routes', () => {
  const usecase = new HandleNotificationResponse();

  it('routes awaiting_driver → driver_dispatch', () => {
    const r = usecase.execute(
      response({ type: 'awaiting_driver', tripId: TRIP_ID }),
    );
    expect(r.ok).toBe(true);
    if (r.ok && r.value.target === 'driver_dispatch') {
      expect(String(r.value.rideId)).toBe(TRIP_ID);
    }
  });

  it('routes scheduled → driver_dispatch', () => {
    const r = usecase.execute(response({ type: 'scheduled', tripId: TRIP_ID }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.target).toBe('driver_dispatch');
  });

  it('routes tip_succeeded → driver_earnings (no rideId required)', () => {
    const r = usecase.execute(
      response({ type: 'tip_succeeded', tripId: TRIP_ID, tipAmount: '5.00' }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.target).toBe('driver_earnings');
  });

  it('tip_succeeded routes even without a tripId (driver lands on Earnings)', () => {
    const r = usecase.execute(response({ type: 'tip_succeeded' }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.target).toBe('driver_earnings');
  });
});

describe('HandleNotificationResponse — rider-side routes to RideMonitor', () => {
  const usecase = new HandleNotificationResponse();

  it.each([
    'driver_dispatched',
    'driver_pickup_arrived',
    'payment_failed',
    'scheduled_driver_accepted',
    'pickup_reminder',
  ] as const)('routes %s → rider_ride_monitor', (type) => {
    const r = usecase.execute(response({ type, tripId: TRIP_ID }));
    expect(r.ok).toBe(true);
    if (r.ok && r.value.target === 'rider_ride_monitor') {
      expect(String(r.value.rideId)).toBe(TRIP_ID);
    }
  });
});

describe('HandleNotificationResponse — rider-side routes to RideReceipt', () => {
  const usecase = new HandleNotificationResponse();

  it('routes payment_succeeded → rider_ride_receipt', () => {
    const r = usecase.execute(
      response({ type: 'payment_succeeded', tripId: TRIP_ID }),
    );
    expect(r.ok).toBe(true);
    if (r.ok && r.value.target === 'rider_ride_receipt') {
      expect(String(r.value.rideId)).toBe(TRIP_ID);
    }
  });
});

describe('HandleNotificationResponse — unknown / forward-compat', () => {
  const usecase = new HandleNotificationResponse();

  it('routes an unrecognized type → unknown (no-op)', () => {
    const r = usecase.execute(
      response({ type: 'some_future_type', tripId: TRIP_ID }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.target).toBe('unknown');
  });

  it('does NOT require a tripId for the unknown arm (no validation triggered)', () => {
    const r = usecase.execute(response({ type: 'some_future_type' }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.target).toBe('unknown');
  });
});

describe('HandleNotificationResponse — validation', () => {
  const usecase = new HandleNotificationResponse();

  it('returns ValidationError when type is missing', () => {
    const r = usecase.execute(response({ tripId: TRIP_ID }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('notification_payload_missing_type');
    }
  });

  it('returns ValidationError when type is empty string', () => {
    const r = usecase.execute(response({ type: '', tripId: TRIP_ID }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('notification_payload_missing_type');
    }
  });

  it('returns ValidationError when type is non-string', () => {
    const r = usecase.execute(response({ type: 42, tripId: TRIP_ID }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('notification_payload_missing_type');
    }
  });

  it('returns ValidationError when a tripId-requiring type lacks tripId', () => {
    const r = usecase.execute(response({ type: 'driver_dispatched' }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('notification_payload_missing_trip_id');
    }
  });

  it('returns ValidationError when tripId is not a string', () => {
    const r = usecase.execute(
      response({ type: 'driver_dispatched', tripId: 12345 }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('notification_payload_missing_trip_id');
    }
  });

  it('returns ValidationError when tripId is malformed (RideId.create rejects)', () => {
    const r = usecase.execute(
      response({ type: 'driver_dispatched', tripId: 'has space' }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('ride_id_invalid_format');
    }
  });

  it('returns ValidationError when tripId is too short', () => {
    const r = usecase.execute(
      response({ type: 'driver_dispatched', tripId: 'ab' }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('ride_id_invalid_length');
    }
  });
});
