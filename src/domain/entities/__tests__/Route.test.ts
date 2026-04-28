import { Coordinates } from '../Coordinates';
import { Money } from '../Money';
import { Route, type RouteProps } from '../Route';

function unwrap<T>(r: { ok: true; value: T } | { ok: false; error: Error }): T {
  if (!r.ok) throw r.error;
  return r.value;
}

const VALID: RouteProps = {
  distanceMeters: 5_320,
  durationSeconds: 740,
  distanceText: '3.3 mi',
  durationText: '12 mins',
  encodedPolyline: '_p~iF~ps|U_ulLnnqC_mqNvxq`@',
  startLocation: unwrap(Coordinates.create(25.7617, -80.1918)),
  endLocation: unwrap(Coordinates.create(26.1224, -80.1373)),
  routeLabels: ['DEFAULT_ROUTE'],
  tollPrice: unwrap(Money.fromMajor(1.5, 'USD')),
  routeToken: 'CqQEcQAAAAA…',
  description: 'via I-95 N',
};

describe('Route', () => {
  it('constructs from valid props', () => {
    const r = Route.create(VALID);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.distanceMeters).toBe(5_320);
      expect(r.value.durationSeconds).toBe(740);
      expect(r.value.distanceText).toBe('3.3 mi');
      expect(r.value.tollPrice?.format()).toBe('$1.50');
    }
  });

  it('accepts a route with no tollPrice', () => {
    const r = Route.create({ ...VALID, tollPrice: null });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.tollPrice).toBeNull();
  });

  it('rejects negative distanceMeters', () => {
    const r = Route.create({ ...VALID, distanceMeters: -1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('route_invalid_distance');
  });

  it('rejects non-finite durationSeconds', () => {
    const r = Route.create({
      ...VALID,
      durationSeconds: Number.POSITIVE_INFINITY,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('route_invalid_duration');
  });

  it('isDefault returns true when label set contains DEFAULT_ROUTE', () => {
    const r = Route.create({ ...VALID, routeLabels: ['DEFAULT_ROUTE'] });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.isDefault()).toBe(true);
      expect(r.value.isFuelEfficient()).toBe(false);
    }
  });

  it('isFuelEfficient returns true when label set contains FUEL_EFFICIENT', () => {
    const r = Route.create({ ...VALID, routeLabels: ['FUEL_EFFICIENT'] });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.isFuelEfficient()).toBe(true);
      expect(r.value.isDefault()).toBe(false);
    }
  });

  it('handles an unknown label set without crashing', () => {
    const r = Route.create({
      ...VALID,
      routeLabels: ['SOMETHING_NEW_FROM_GOOGLE'],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.isDefault()).toBe(false);
      expect(r.value.isFuelEfficient()).toBe(false);
    }
  });
});
