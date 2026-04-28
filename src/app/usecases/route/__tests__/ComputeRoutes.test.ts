import { Coordinates } from '@domain/entities/Coordinates';
import { Route } from '@domain/entities/Route';
import { NetworkError, NotFoundError } from '@domain/errors';
import { FakeRoutesService } from '@shared/testing';

import { ComputeRoutes } from '../ComputeRoutes';

function unwrap<T>(r: { ok: true; value: T } | { ok: false; error: Error }): T {
  if (!r.ok) throw r.error;
  return r.value;
}

function makeRoute(distanceMeters: number, durationSeconds: number): Route {
  const start = unwrap(Coordinates.create(25.7617, -80.1918));
  const end = unwrap(Coordinates.create(26.1224, -80.1373));
  return unwrap(
    Route.create({
      distanceMeters,
      durationSeconds,
      distanceText: '',
      durationText: '',
      encodedPolyline: '',
      startLocation: start,
      endLocation: end,
      routeLabels: [],
      tollPrice: null,
      routeToken: 'tk',
      description: '',
    }),
  );
}

describe('ComputeRoutes', () => {
  it('returns the seeded routes from the service', async () => {
    const service = new FakeRoutesService();
    service.seed([makeRoute(5_000, 600), makeRoute(7_000, 900)]);
    const sut = new ComputeRoutes(service);
    const r = await sut.execute({
      origin: { placeId: 'origin-place' },
      destination: { placeId: 'dest-place' },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toHaveLength(2);
      expect(r.value[0]?.distanceMeters).toBe(5_000);
    }
  });

  it('forwards a NetworkError when the service surfaces one', async () => {
    const service = new FakeRoutesService();
    service.seedError(
      new NetworkError({
        code: 'routes_request_timeout',
        message: 'timed out',
      }),
    );
    const sut = new ComputeRoutes(service);
    const r = await sut.execute({
      origin: { placeId: 'a' },
      destination: { placeId: 'b' },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('network');
      expect(r.error.code).toBe('routes_request_timeout');
    }
  });

  it('forwards a NotFoundError when the service has no routes', async () => {
    const service = new FakeRoutesService();
    service.seedError(
      new NotFoundError({
        code: 'routes_not_found',
        message: 'no route',
        resource: 'route',
      }),
    );
    const sut = new ComputeRoutes(service);
    const r = await sut.execute({
      origin: { placeId: 'a' },
      destination: { placeId: 'b' },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('not_found');
  });

  it('captures the call args verbatim for assertion in upstream tests', async () => {
    const service = new FakeRoutesService();
    const sut = new ComputeRoutes(service);
    await sut.execute({
      origin: {
        coordinates: unwrap(Coordinates.create(25.7617, -80.1918)),
      },
      destination: { placeId: 'dest' },
      options: { alternatives: true, tolls: true },
    });
    expect(service.spies).toHaveLength(1);
    const call = service.spies[0]!;
    expect(call.options?.alternatives).toBe(true);
    expect(call.options?.tolls).toBe(true);
    expect('coordinates' in call.origin).toBe(true);
    expect('placeId' in call.destination).toBe(true);
  });

  it('default behaviour: returns one default route when nothing seeded', async () => {
    const service = new FakeRoutesService();
    const sut = new ComputeRoutes(service);
    const r = await sut.execute({
      origin: { placeId: 'a' },
      destination: { placeId: 'b' },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toHaveLength(1);
      expect(r.value[0]?.distanceMeters).toBeGreaterThan(0);
      expect(r.value[0]?.tollPrice).not.toBeNull();
    }
  });
});
