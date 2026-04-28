import { Coordinates } from '../Coordinates';
import { Endpoint } from '../Endpoint';
import { Money } from '../Money';
import { Route } from '../Route';

function unwrap<T>(r: { ok: true; value: T } | { ok: false; error: Error }): T {
  if (!r.ok) throw r.error;
  return r.value;
}

const MIAMI = unwrap(Coordinates.create(25.7617, -80.1918));
const FORT_LAUDERDALE = unwrap(Coordinates.create(26.1224, -80.1373));

function makeRoute(): Route {
  return unwrap(
    Route.create({
      distanceMeters: 5_000,
      durationSeconds: 600,
      distanceText: '3.1 mi',
      durationText: '10 mins',
      encodedPolyline: '_p~iF',
      startLocation: MIAMI,
      endLocation: FORT_LAUDERDALE,
      routeLabels: ['DEFAULT_ROUTE'],
      tollPrice: unwrap(Money.fromMajor(1.5, 'USD')),
      routeToken: 'tk',
      description: 'via I-95',
    }),
  );
}

describe('Endpoint', () => {
  it('constructs with no placeName / no directions', () => {
    const r = Endpoint.create({
      location: MIAMI,
      address: '100 SE 1st St, Miami, FL',
      placeName: null,
      directions: null,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.placeName).toBeNull();
      expect(r.value.directions).toBeNull();
    }
  });

  it('accepts placeName + directions', () => {
    const r = Endpoint.create({
      location: MIAMI,
      address: '100 SE 1st St, Miami, FL',
      placeName: 'Office',
      directions: makeRoute(),
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.placeName).toBe('Office');
      expect(r.value.directions).not.toBeNull();
    }
  });

  it('rejects an empty address', () => {
    const r = Endpoint.create({
      location: MIAMI,
      address: '   ',
      placeName: null,
      directions: null,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('endpoint_empty_address');
  });

  it('rejects a placeName longer than 120 chars', () => {
    const r = Endpoint.create({
      location: MIAMI,
      address: 'somewhere',
      placeName: 'x'.repeat(121),
      directions: null,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('endpoint_place_name_too_long');
  });

  it('withDirections returns a new Endpoint with the new route attached', () => {
    const initial = unwrap(
      Endpoint.create({
        location: MIAMI,
        address: 'pickup',
        placeName: null,
        directions: null,
      }),
    );
    const updated = initial.withDirections(makeRoute());
    expect(initial.directions).toBeNull();
    expect(updated.directions).not.toBeNull();
    expect(updated.address).toBe('pickup');
  });
});
