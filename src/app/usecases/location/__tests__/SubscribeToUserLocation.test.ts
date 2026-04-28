import { Coordinates } from '@domain/entities/Coordinates';
import { UserId } from '@domain/entities/UserId';
import { UserLocation } from '@domain/entities/UserLocation';
import { InMemoryLocationRepository } from '@shared/testing';

import { SubscribeToUserLocation } from '../SubscribeToUserLocation';

function unwrap<T>(r: { ok: true; value: T } | { ok: false; error: Error }): T {
  if (!r.ok) throw r.error;
  return r.value;
}

const USER = unwrap(UserId.create('aaaaaaaaaaaaaaaaaaaaaaaaaaaa'));
const MIAMI = unwrap(Coordinates.create(25.7617, -80.1918));
const FORT_LAUDERDALE = unwrap(Coordinates.create(26.1224, -80.1373));

describe('SubscribeToUserLocation', () => {
  it('emits null on subscribe when no location yet, then emits on update', async () => {
    const repo = new InMemoryLocationRepository();
    const sut = new SubscribeToUserLocation(repo);
    const calls: (UserLocation | null)[] = [];
    const unsub = sut.execute({
      userId: USER,
      callback: (loc) => {
        calls.push(loc);
      },
    });
    expect(calls).toEqual([null]);

    const newLoc = unwrap(
      UserLocation.create({
        userId: USER,
        location: FORT_LAUDERDALE,
        speed: null,
        updatedAt: new Date(),
        tripTracking: null,
      }),
    );
    await repo.updateLocation(newLoc);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.location.latitude).toBe(FORT_LAUDERDALE.latitude);
    unsub();
  });

  it('emits the seeded location synchronously on subscribe', () => {
    const repo = new InMemoryLocationRepository();
    repo.seed(
      unwrap(
        UserLocation.create({
          userId: USER,
          location: MIAMI,
          speed: null,
          updatedAt: new Date(),
          tripTracking: null,
        }),
      ),
    );
    const sut = new SubscribeToUserLocation(repo);
    let received: UserLocation | null = null;
    const unsub = sut.execute({
      userId: USER,
      callback: (loc) => {
        received = loc;
      },
    });
    expect(received).not.toBeNull();
    expect(received!.location.latitude).toBe(MIAMI.latitude);
    unsub();
  });

  it('returns a synchronous unsubscribe (not a Promise) — fixes legacy footgun', () => {
    const repo = new InMemoryLocationRepository();
    const sut = new SubscribeToUserLocation(repo);
    const unsub = sut.execute({
      userId: USER,
      callback: () => {
        /* no-op */
      },
    });
    expect(typeof unsub).toBe('function');
    expect(unsub).not.toBeInstanceOf(Promise);
    unsub();
  });
});
