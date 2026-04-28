import { Coordinates } from '@domain/entities/Coordinates';
import { UserId } from '@domain/entities/UserId';
import { UserLocation } from '@domain/entities/UserLocation';
import { NetworkError } from '@domain/errors';
import { InMemoryLocationRepository } from '@shared/testing';

import { UpdateUserLocation } from '../UpdateUserLocation';

function unwrap<T>(r: { ok: true; value: T } | { ok: false; error: Error }): T {
  if (!r.ok) throw r.error;
  return r.value;
}

const USER = unwrap(UserId.create('aaaaaaaaaaaaaaaaaaaaaaaaaaaa'));
const MIAMI = unwrap(Coordinates.create(25.7617, -80.1918));

function makeLocation() {
  return unwrap(
    UserLocation.create({
      userId: USER,
      location: MIAMI,
      speed: 12,
      updatedAt: new Date(),
      tripTracking: null,
    }),
  );
}

describe('UpdateUserLocation', () => {
  it('persists the location through the repo', async () => {
    const repo = new InMemoryLocationRepository();
    const sut = new UpdateUserLocation(repo);
    const r = await sut.execute(makeLocation());
    expect(r.ok).toBe(true);
    expect(repo.spies.updateLocation).toBe(1);
  });

  it('forwards a NetworkError when the repo surfaces one', async () => {
    const repo = new InMemoryLocationRepository();
    repo.mockUpdateError(
      new NetworkError({
        code: 'location_update_failed',
        message: 'simulated',
      }),
    );
    const sut = new UpdateUserLocation(repo);
    const r = await sut.execute(makeLocation());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('network');
  });
});
