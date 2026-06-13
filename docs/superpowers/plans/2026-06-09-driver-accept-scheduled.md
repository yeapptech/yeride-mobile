# Driver-Accept-Scheduled Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let drivers accept scheduled rides (filling the driver Home Scheduled section) and begin them into the existing DriverMonitor flow when the pickup nears.

**Architecture:** Two new immutable `Ride` transitions (`acceptSchedule`, `beginScheduledRide`) + two thin use cases mirror `DispatchRide`. One new repository observe (`observeScheduledRidesByDriver`) mirrors `observeScheduledRidesByPassenger`. The existing `DriverDispatch` screen becomes the single "act on this ride" surface, branching its CTA/action on `ride.status` (pinned to the first-observed status to keep race-detection correct); the DriverMonitor is untouched because Begin flips the ride to `dispatched` before the monitor mounts. The driver Home Scheduled section reuses `HomeRideSections`/`TripCard` (no component changes) fed by a role-generalized scheduled subscription.

**Tech Stack:** TypeScript 5.9 strict, React Native 0.83 / Expo 55, Zustand + TanStack Query, Jest + @testing-library/react-native, in-memory repository fakes via `TestContainerProvider`.

**Design spec:** `docs/superpowers/specs/2026-06-09-driver-accept-scheduled-design.md`

**Conventions for every task:** `Result.ok`/`Result.err` (never throw for domain failures); branded ids constructed via `.create()`; build the in-memory fake before the Firestore method; synchronous unsubscribe for subscriptions; `LOG.warn` (not `LOG.error`) for best-effort/user paths. Run `npm run typecheck && npm run lint` before each commit in addition to the task's targeted test.

---

## Task 1: Entity transition `Ride.acceptSchedule`

**Files:**

- Modify: `src/domain/entities/Ride.ts` (add a method after `dispatch`, ~`:378`)
- Test: `src/domain/entities/__tests__/Ride.test.ts` (add a `describe` block after `Ride.createScheduled`, ~`:458`)

- [ ] **Step 1: Write the failing tests**

Append to `src/domain/entities/__tests__/Ride.test.ts` (the file already has `freshRide()`, `DRIVER`, `PASSENGER`, `RIDE_SERVICE`, `PICKUP`, `DROPOFF`, `T0` at the top; reuse them). Add a local `freshScheduled()` helper that builds a `scheduled` ride:

```ts
describe('Ride.acceptSchedule', () => {
  const SCHEDULED_AT = new Date(T0.getTime() + 30 * 60_000);

  function freshScheduled() {
    return unwrap(
      Ride.createScheduled({
        id: unwrap(RideId.create('aBcDeFgHiJkLmNoPqRsT')),
        passenger: PASSENGER,
        rideService: RIDE_SERVICE,
        pickup: PICKUP,
        dropoff: DROPOFF,
        createdAt: T0,
        schedulePickupAt: SCHEDULED_AT,
      }),
    );
  }

  it('flips scheduled → scheduled_driver_accepted and stores the driver', () => {
    const r = freshScheduled().acceptSchedule({ driver: DRIVER });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.status).toBe('scheduled_driver_accepted');
      expect(r.value.driver?.stripeAccountId).toBe('acct_abc');
      // No pickup directions / timing yet — those land at begin time.
      expect(r.value.pickup.directions).toBeNull();
      expect(r.value.pickupTiming.startedAt).toBeNull();
      // schedulePickupAt is preserved.
      expect(r.value.schedulePickupAt).toEqual(SCHEDULED_AT);
    }
  });

  it('rejects acceptSchedule from a non-scheduled status', () => {
    const r = freshRide().acceptSchedule({ driver: DRIVER });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('ride_illegal_transition');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest src/domain/entities/__tests__/Ride.test.ts -t acceptSchedule`
Expected: FAIL — `acceptSchedule` is not a function / does not exist on `Ride`.

- [ ] **Step 3: Implement the transition**

In `src/domain/entities/Ride.ts`, add this method immediately after the `dispatch(...)` method (after its closing `}` near `:378`, before `start`):

```ts
  /**
   * Driver accepts a SCHEDULED ride. Sets the driver snapshot and flips
   * status `scheduled → scheduled_driver_accepted`. Mirrors legacy
   * `scheduleDriver`: pickup directions + timing are deliberately NOT set
   * here — those are attached later when the driver begins the ride
   * (`beginScheduledRide`). No single-active pointer is set; a driver may
   * hold several accepted scheduled rides (legacy parity).
   */
  acceptSchedule(args: {
    driver: DriverSnapshot;
  }): Result<Ride, ValidationError> {
    if (this.props.status !== 'scheduled') {
      return Result.err(
        illegal(
          this.props.status,
          'acceptSchedule',
          'scheduled → scheduled_driver_accepted',
        ),
      );
    }
    return Ride.fromProps({
      ...this.props,
      status: 'scheduled_driver_accepted',
      driver: args.driver,
    });
  }
```

(`DriverSnapshot` and `illegal` are already imported/declared in this file — `dispatch` uses both.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest src/domain/entities/__tests__/Ride.test.ts -t acceptSchedule`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/domain/entities/Ride.ts src/domain/entities/__tests__/Ride.test.ts
git commit -m "feat(ride): add acceptSchedule transition (scheduled → scheduled_driver_accepted)"
```

---

## Task 2: Entity transition `Ride.beginScheduledRide`

**Files:**

- Modify: `src/domain/entities/Ride.ts` (add a method after `acceptSchedule`)
- Test: `src/domain/entities/__tests__/Ride.test.ts` (add a `describe` block after `Ride.acceptSchedule`)

- [ ] **Step 1: Write the failing tests**

Append to `src/domain/entities/__tests__/Ride.test.ts`:

```ts
describe('Ride.beginScheduledRide', () => {
  const SCHEDULED_AT = new Date(T0.getTime() + 30 * 60_000);

  function acceptedScheduled() {
    const scheduled = unwrap(
      Ride.createScheduled({
        id: unwrap(RideId.create('aBcDeFgHiJkLmNoPqRsT')),
        passenger: PASSENGER,
        rideService: RIDE_SERVICE,
        pickup: PICKUP,
        dropoff: DROPOFF,
        createdAt: T0,
        schedulePickupAt: SCHEDULED_AT,
      }),
    );
    return unwrap(scheduled.acceptSchedule({ driver: DRIVER }));
  }

  it('flips scheduled_driver_accepted → dispatched with pickup directions + startedAt', () => {
    const r = acceptedScheduled().beginScheduledRide({
      pickupDirections: makeRoute(),
      at: T_DISPATCH,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.status).toBe('dispatched');
      expect(r.value.driver?.stripeAccountId).toBe('acct_abc');
      expect(r.value.pickup.directions?.routeToken).toBe('tk');
      expect(r.value.pickupTiming.startedAt).toEqual(T_DISPATCH);
    }
  });

  it('lets start() run after begin (precondition is dispatched)', () => {
    const dispatched = unwrap(
      acceptedScheduled().beginScheduledRide({
        pickupDirections: makeRoute(),
        at: T_DISPATCH,
      }),
    );
    const started = dispatched.start({ odometerMeters: 1000, at: T_PICKUP });
    expect(started.ok).toBe(true);
    if (started.ok) expect(started.value.status).toBe('started');
  });

  it('rejects beginScheduledRide from a non-accepted status', () => {
    const r = freshRide().beginScheduledRide({
      pickupDirections: makeRoute(),
      at: T_DISPATCH,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('ride_illegal_transition');
  });
});
```

(`makeRoute()`, `T_DISPATCH`, `T_PICKUP` already exist at the top of the test file.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest src/domain/entities/__tests__/Ride.test.ts -t beginScheduledRide`
Expected: FAIL — `beginScheduledRide` is not a function.

- [ ] **Step 3: Implement the transition**

In `src/domain/entities/Ride.ts`, add immediately after `acceptSchedule`:

```ts
  /**
   * Driver begins an accepted scheduled ride when the pickup nears.
   * Attaches the freshly-computed driver→pickup directions, records
   * `pickupTiming.startedAt`, and flips status
   * `scheduled_driver_accepted → dispatched` so the ride enters the normal
   * live-trip flow (the driver snapshot is already set from
   * `acceptSchedule`). Deliberate divergence from legacy, which drives a
   * scheduled ride straight to `started`; the rewrite routes through
   * `dispatched` because the monitor's en-route view and `start()` are
   * keyed off it.
   */
  beginScheduledRide(args: {
    pickupDirections: Route;
    at: Date;
  }): Result<Ride, ValidationError> {
    if (this.props.status !== 'scheduled_driver_accepted') {
      return Result.err(
        illegal(
          this.props.status,
          'beginScheduledRide',
          'scheduled_driver_accepted → dispatched',
        ),
      );
    }
    return Ride.fromProps({
      ...this.props,
      status: 'dispatched',
      pickup: this.props.pickup.withDirections(args.pickupDirections),
      pickupTiming: {
        ...this.props.pickupTiming,
        startedAt: args.at,
      },
    });
  }
```

(`Route` is already imported in this file — `dispatch` uses it.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest src/domain/entities/__tests__/Ride.test.ts -t beginScheduledRide`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/domain/entities/Ride.ts src/domain/entities/__tests__/Ride.test.ts
git commit -m "feat(ride): add beginScheduledRide transition (scheduled_driver_accepted → dispatched)"
```

---

## Task 3: Data — `observeScheduledRidesByDriver` (interface + in-memory fake + Firestore)

**Files:**

- Modify: `src/domain/repositories/RideRepository.ts` (add method after `observeScheduledRidesByPassenger`, ~`:163`)
- Modify: `src/shared/testing/InMemoryRideRepository.ts` (field, method, compute helper, extend `notifyScheduled`)
- Modify: `src/data/repositories/FirestoreRideRepository.ts` (add method after `observeScheduledRidesByPassenger`, ~`:450`)
- Test: `src/shared/testing/__tests__/InMemoryRideRepository.test.ts` (add a `describe` block after the `observeInProgressRidesByDriver` block, ~`:917`)

> Build order: the test (Step 1) won't compile until the interface + in-memory method exist, and the project won't typecheck until the Firestore method exists too. So Steps 3–6 add all three before the green run in Step 7. One commit; tree green at commit.

- [ ] **Step 1: Write the failing test**

Append to `src/shared/testing/__tests__/InMemoryRideRepository.test.ts`. The file already has `makeRide`, `makeRoute`, `DRIVER`, `PASSENGER`, `ECONOMY`, `MIAMI`. Add a local helper that produces an accepted scheduled ride owned by `DRIVER`:

```ts
describe('InMemoryRideRepository — observeScheduledRidesByDriver', () => {
  function makeAcceptedScheduled(id: string): Ride {
    const scheduled = unwrap(
      Ride.createScheduled({
        id: unwrap(RideId.create(id)),
        passenger: PASSENGER,
        rideService: ECONOMY,
        pickup: unwrap(
          Endpoint.create({
            location: MIAMI,
            address: 'pickup',
            placeName: null,
            directions: null,
          }),
        ),
        dropoff: unwrap(
          Endpoint.create({
            location: FORT_LAUDERDALE,
            address: 'dropoff',
            placeName: null,
            directions: null,
          }),
        ),
        createdAt: new Date('2026-04-27T12:00:00Z'),
        schedulePickupAt: new Date('2026-04-27T13:00:00Z'),
      }),
    );
    return unwrap(scheduled.acceptSchedule({ driver: DRIVER }));
  }

  it('delivers the driver-scoped scheduled_driver_accepted rides on subscribe', async () => {
    const repo = new InMemoryRideRepository();
    await repo.create(makeAcceptedScheduled('drvSched1234567890ab'));
    // A pure scheduled ride (no driver) must NOT appear for the driver.
    await repo.create(
      unwrap(
        Ride.createScheduled({
          id: unwrap(RideId.create('drvSchedPlain12345ab')),
          passenger: PASSENGER,
          rideService: ECONOMY,
          pickup: unwrap(
            Endpoint.create({
              location: MIAMI,
              address: 'pickup',
              placeName: null,
              directions: null,
            }),
          ),
          dropoff: unwrap(
            Endpoint.create({
              location: FORT_LAUDERDALE,
              address: 'dropoff',
              placeName: null,
              directions: null,
            }),
          ),
          createdAt: new Date('2026-04-27T12:00:00Z'),
          schedulePickupAt: new Date('2026-04-27T13:00:00Z'),
        }),
      ),
    );

    const seen: Ride[][] = [];
    const unsub = repo.observeScheduledRidesByDriver({
      driverId: DRIVER.id,
      callback: (rs) => seen.push([...rs]),
    });
    const latest = seen[seen.length - 1] ?? [];
    expect(latest).toHaveLength(1);
    expect(String(latest[0]?.id)).toBe('drvSched1234567890ab');
    expect(latest[0]?.status).toBe('scheduled_driver_accepted');
    unsub();
  });

  it('re-emits when the driver begins a ride (drops out of the set)', async () => {
    const repo = new InMemoryRideRepository();
    const accepted = makeAcceptedScheduled('drvSchedBegin12345ab');
    await repo.create(accepted);

    const seen: Ride[][] = [];
    const unsub = repo.observeScheduledRidesByDriver({
      driverId: DRIVER.id,
      callback: (rs) => seen.push([...rs]),
    });
    expect(seen[seen.length - 1]).toHaveLength(1);

    await repo.update(
      unwrap(
        accepted.beginScheduledRide({
          pickupDirections: makeRoute(),
          at: new Date(),
        }),
      ),
    );
    expect(seen[seen.length - 1]).toEqual([]);
    unsub();
  });

  it('stops emitting after unsubscribe', async () => {
    const repo = new InMemoryRideRepository();
    const seen: Ride[][] = [];
    const unsub = repo.observeScheduledRidesByDriver({
      driverId: DRIVER.id,
      callback: (rs) => seen.push([...rs]),
    });
    unsub();
    await repo.create(makeAcceptedScheduled('drvSchedAfterUnsub01'));
    expect(seen).toHaveLength(1); // only the initial empty emit
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest src/shared/testing/__tests__/InMemoryRideRepository.test.ts -t observeScheduledRidesByDriver`
Expected: FAIL — `observeScheduledRidesByDriver` does not exist on `InMemoryRideRepository` (TS compile error).

- [ ] **Step 3: Add the interface method**

In `src/domain/repositories/RideRepository.ts`, add immediately after the `observeScheduledRidesByPassenger({...}): () => void;` declaration (~`:163`):

```ts
  /**
   * Live "driver's accepted scheduled rides" subscription for the driver
   * Home Scheduled section. Emits the driver's trips in
   * `'scheduled_driver_accepted'` (a driver never holds a bare
   * `'scheduled'` ride — those are unaccepted/available). Mutates as the
   * driver begins one (drops to `'dispatched'`) or the rider cancels.
   * Synchronous unsubscribe. Ordering NOT specified server-side; callers
   * sort by `schedulePickupAt asc`.
   */
  observeScheduledRidesByDriver(args: {
    driverId: UserId;
    callback: (rides: readonly Ride[]) => void;
  }): () => void;
```

- [ ] **Step 4: Add the in-memory fake field + method + compute helper**

In `src/shared/testing/InMemoryRideRepository.ts`:

(a) Add a field immediately after `scheduledObservers` (~`:52`):

```ts
  private scheduledDriverObservers = new Set<{
    driverId: string;
    callback: (rides: readonly Ride[]) => void;
  }>();
```

(b) Add the method immediately after `observeScheduledRidesByPassenger` (~`:246`):

```ts
  observeScheduledRidesByDriver(args: {
    driverId: UserId;
    callback: (rides: readonly Ride[]) => void;
  }): () => void {
    const entry = {
      driverId: String(args.driverId),
      callback: args.callback,
    };
    this.scheduledDriverObservers.add(entry);
    args.callback(this.computeScheduledByDriver(entry.driverId));
    return () => {
      this.scheduledDriverObservers.delete(entry);
    };
  }
```

(c) Add the compute helper immediately after `computeScheduled` (~`:478`):

```ts
  private computeScheduledByDriver(driverId: string): readonly Ride[] {
    const matching: Ride[] = [];
    for (const r of this.rides.values()) {
      if (!r.driver || String(r.driver.id) !== driverId) continue;
      if (r.status !== 'scheduled_driver_accepted') continue;
      matching.push(r);
    }
    return matching;
  }
```

(d) Extend `notifyScheduled` (~`:459`) so driver observers are notified on every write (create/update/cancel already call `notifyScheduled`):

```ts
  private notifyScheduled(): void {
    for (const obs of this.scheduledObservers) {
      obs.callback(this.computeScheduled(obs.passengerId));
    }
    for (const obs of this.scheduledDriverObservers) {
      obs.callback(this.computeScheduledByDriver(obs.driverId));
    }
  }
```

- [ ] **Step 5: Add the Firestore method**

In `src/data/repositories/FirestoreRideRepository.ts`, add immediately after `observeScheduledRidesByPassenger` (after its closing `}` ~`:450`):

```ts
  observeScheduledRidesByDriver(args: {
    driverId: UserId;
    callback: (rides: readonly Ride[]) => void;
  }): () => void {
    const q = query(
      collection(this.firestore, TRIPS),
      where('driver.id', '==', String(args.driverId)),
      where('status', '==', 'scheduled_driver_accepted'),
    );
    return onSnapshot(
      q,
      (snap) => {
        const out: Ride[] = [];
        snap.forEach((d) => {
          const r = this.toDomainOrCorrupt(d.id, d.data());
          if (!r.ok) return;
          out.push(r.value);
        });
        args.callback(out);
      },
      (e) => {
        logger.warn('observeScheduledRidesByDriver error', {
          driverId: String(args.driverId),
          code: errCode(e),
        });
        args.callback([]);
      },
    );
  }
```

- [ ] **Step 6: Confirm the test file imports `FORT_LAUDERDALE`**

The new test references `FORT_LAUDERDALE`. It is already declared at the top of `InMemoryRideRepository.test.ts` (`const FORT_LAUDERDALE = ...`, ~`:34`). No import change needed. (If a lint "unused"/"undefined" surfaces, verify the constant name matches.)

- [ ] **Step 7: Run the test + typecheck**

Run: `npx jest src/shared/testing/__tests__/InMemoryRideRepository.test.ts -t observeScheduledRidesByDriver && npm run typecheck`
Expected: PASS (3 tests) + typecheck clean (Firestore repo now satisfies the interface).

- [ ] **Step 8: Commit**

```bash
git add src/domain/repositories/RideRepository.ts src/shared/testing/InMemoryRideRepository.ts src/data/repositories/FirestoreRideRepository.ts src/shared/testing/__tests__/InMemoryRideRepository.test.ts
git commit -m "feat(data): add observeScheduledRidesByDriver (interface + fake + Firestore)"
```

---

## Task 4: Use case `AcceptScheduledRide`

**Files:**

- Create: `src/app/usecases/ride/AcceptScheduledRide.ts`
- Test: `src/app/usecases/ride/__tests__/AcceptScheduledRide.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/app/usecases/ride/__tests__/AcceptScheduledRide.test.ts` (modeled on `DispatchRide.test.ts` — reuse its `DRIVER` snapshot shape):

```ts
import { Coordinates } from '@domain/entities/Coordinates';
import {
  DriverSnapshot,
  VehicleSnapshot,
} from '@domain/entities/DriverSnapshot';
import { Email } from '@domain/entities/Email';
import { Endpoint } from '@domain/entities/Endpoint';
import { Money } from '@domain/entities/Money';
import { PassengerSnapshot } from '@domain/entities/PassengerSnapshot';
import { PersonName } from '@domain/entities/PersonName';
import { PhoneNumber } from '@domain/entities/PhoneNumber';
import { Ride } from '@domain/entities/Ride';
import { RideId } from '@domain/entities/RideId';
import { RideServiceId } from '@domain/entities/RideServiceId';
import { RideServiceSnapshot } from '@domain/entities/RideServiceSnapshot';
import { UserId } from '@domain/entities/UserId';
import { InMemoryRideRepository } from '@shared/testing';

import { AcceptScheduledRide } from '../AcceptScheduledRide';

function unwrap<T>(r: { ok: true; value: T } | { ok: false; error: Error }): T {
  if (!r.ok) throw r.error;
  return r.value;
}
function usd(m: number) {
  return unwrap(Money.fromMajor(m, 'USD'));
}

const T_CREATED = new Date('2026-04-27T12:00:00Z');
const MIAMI = unwrap(Coordinates.create(25.7617, -80.1918));
const FORT_LAUDERDALE = unwrap(Coordinates.create(26.1224, -80.1373));

const PASSENGER = unwrap(
  PassengerSnapshot.create({
    id: unwrap(UserId.create('aaaaaaaaaaaaaaaaaaaaaaaaaaaa')),
    name: unwrap(PersonName.create({ first: 'Ada', last: 'Lovelace' })),
    email: unwrap(Email.create('ada@yeapp.tech')),
    phoneNumber: unwrap(PhoneNumber.create('+14155551111')),
    pushToken: null,
    avatarUrl: null,
    stripeCustomerId: null,
    defaultPaymentMethod: null,
  }),
);

const DRIVER = unwrap(
  DriverSnapshot.create({
    id: unwrap(UserId.create('bbbbbbbbbbbbbbbbbbbbbbbbbbbb')),
    name: unwrap(PersonName.create({ first: 'Grace', last: 'Hopper' })),
    email: unwrap(Email.create('grace@yeapp.tech')),
    phoneNumber: unwrap(PhoneNumber.create('+14155552222')),
    stripeAccountId: 'acct_abc',
    pushToken: null,
    avatarUrl: null,
    vehicle: unwrap(
      VehicleSnapshot.create({
        make: 'Toyota',
        model: 'Camry',
        year: 2024,
        color: 'White',
        licensePlate: 'ABC1234',
        stockPhoto: null,
        photos: [],
      }),
    ),
  }),
);

const ECONOMY = unwrap(
  RideServiceSnapshot.create({
    id: unwrap(RideServiceId.create('economy')),
    name: 'Economy',
    baseFare: usd(2.5),
    minimumFare: usd(5),
    cancelationFee: usd(2),
    costPerKm: usd(1.25),
    costPerMinute: usd(0.2),
    seatCapacity: 4,
  }),
);

function makeScheduled(id: string): Ride {
  return unwrap(
    Ride.createScheduled({
      id: unwrap(RideId.create(id)),
      passenger: PASSENGER,
      rideService: ECONOMY,
      pickup: unwrap(
        Endpoint.create({
          location: MIAMI,
          address: 'pickup',
          placeName: null,
          directions: null,
        }),
      ),
      dropoff: unwrap(
        Endpoint.create({
          location: FORT_LAUDERDALE,
          address: 'dropoff',
          placeName: null,
          directions: null,
        }),
      ),
      createdAt: T_CREATED,
      schedulePickupAt: new Date(T_CREATED.getTime() + 60 * 60_000),
    }),
  );
}

describe('AcceptScheduledRide', () => {
  it('flips a scheduled ride to scheduled_driver_accepted and stores the driver', async () => {
    const repo = new InMemoryRideRepository();
    const ride = makeScheduled('schedRide12345678901');
    await repo.create(ride);
    const sut = new AcceptScheduledRide(repo);
    const r = await sut.execute({ rideId: ride.id, driver: DRIVER });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.status).toBe('scheduled_driver_accepted');
      expect(r.value.driver?.stripeAccountId).toBe('acct_abc');
    }
  });

  it('returns NotFoundError for an unknown ride', async () => {
    const repo = new InMemoryRideRepository();
    const sut = new AcceptScheduledRide(repo);
    const r = await sut.execute({
      rideId: unwrap(RideId.create('nonexistent1234567890ab')),
      driver: DRIVER,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('not_found');
  });

  it('refuses to accept a ride that is not scheduled', async () => {
    const repo = new InMemoryRideRepository();
    const ride = makeScheduled('schedRideTwice123456');
    await repo.create(ride);
    const sut = new AcceptScheduledRide(repo);
    await sut.execute({ rideId: ride.id, driver: DRIVER });
    const r2 = await sut.execute({ rideId: ride.id, driver: DRIVER });
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.error.code).toBe('ride_illegal_transition');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest src/app/usecases/ride/__tests__/AcceptScheduledRide.test.ts`
Expected: FAIL — cannot find module `../AcceptScheduledRide`.

- [ ] **Step 3: Implement the use case**

Create `src/app/usecases/ride/AcceptScheduledRide.ts`:

```ts
import type { DriverSnapshot } from '@domain/entities/DriverSnapshot';
import type { Ride } from '@domain/entities/Ride';
import type { RideId } from '@domain/entities/RideId';
import type {
  AuthorizationError,
  NotFoundError,
  ValidationError,
} from '@domain/errors';
import type { RideRepository } from '@domain/repositories';
import type { Result } from '@domain/shared/Result';

/**
 * Driver accepts a scheduled ride. Reads the current state, runs the
 * entity transition (which enforces the `scheduled` precondition + sets
 * the driver snapshot), and writes back. No pickup directions are attached
 * — that happens at begin time (`BeginScheduledRide`). Mirrors
 * `DispatchRide`'s shape; driver eligibility (active vehicle + Stripe) is
 * gated in the view-model, as it is for immediate dispatch.
 */
export class AcceptScheduledRide {
  constructor(private readonly repo: RideRepository) {}

  async execute(args: {
    rideId: RideId;
    driver: DriverSnapshot;
  }): Promise<
    Result<Ride, NotFoundError | AuthorizationError | ValidationError>
  > {
    const current = await this.repo.getById(args.rideId);
    if (!current.ok) return current;
    const next = current.value.acceptSchedule({ driver: args.driver });
    if (!next.ok) return next;
    return this.repo.update(next.value);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest src/app/usecases/ride/__tests__/AcceptScheduledRide.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/usecases/ride/AcceptScheduledRide.ts src/app/usecases/ride/__tests__/AcceptScheduledRide.test.ts
git commit -m "feat(usecase): add AcceptScheduledRide"
```

---

## Task 5: Use case `BeginScheduledRide`

**Files:**

- Create: `src/app/usecases/ride/BeginScheduledRide.ts`
- Test: `src/app/usecases/ride/__tests__/BeginScheduledRide.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/app/usecases/ride/__tests__/BeginScheduledRide.test.ts`. It reuses the same fixture shapes as Task 4 plus a `Route` and a clock; build an accepted scheduled ride by chaining `createScheduled → acceptSchedule`:

```ts
import { Coordinates } from '@domain/entities/Coordinates';
import {
  DriverSnapshot,
  VehicleSnapshot,
} from '@domain/entities/DriverSnapshot';
import { Email } from '@domain/entities/Email';
import { Endpoint } from '@domain/entities/Endpoint';
import { Money } from '@domain/entities/Money';
import { PassengerSnapshot } from '@domain/entities/PassengerSnapshot';
import { PersonName } from '@domain/entities/PersonName';
import { PhoneNumber } from '@domain/entities/PhoneNumber';
import { Ride } from '@domain/entities/Ride';
import { RideId } from '@domain/entities/RideId';
import { RideServiceId } from '@domain/entities/RideServiceId';
import { RideServiceSnapshot } from '@domain/entities/RideServiceSnapshot';
import { Route } from '@domain/entities/Route';
import { UserId } from '@domain/entities/UserId';
import { InMemoryRideRepository } from '@shared/testing';

import { BeginScheduledRide } from '../BeginScheduledRide';

function unwrap<T>(r: { ok: true; value: T } | { ok: false; error: Error }): T {
  if (!r.ok) throw r.error;
  return r.value;
}
function usd(m: number) {
  return unwrap(Money.fromMajor(m, 'USD'));
}

const T_BEGIN = new Date('2026-04-27T12:50:00Z');
const T_CREATED = new Date('2026-04-27T12:00:00Z');
const MIAMI = unwrap(Coordinates.create(25.7617, -80.1918));
const FORT_LAUDERDALE = unwrap(Coordinates.create(26.1224, -80.1373));

const PASSENGER = unwrap(
  PassengerSnapshot.create({
    id: unwrap(UserId.create('aaaaaaaaaaaaaaaaaaaaaaaaaaaa')),
    name: unwrap(PersonName.create({ first: 'Ada', last: 'Lovelace' })),
    email: unwrap(Email.create('ada@yeapp.tech')),
    phoneNumber: unwrap(PhoneNumber.create('+14155551111')),
    pushToken: null,
    avatarUrl: null,
    stripeCustomerId: null,
    defaultPaymentMethod: null,
  }),
);

const DRIVER = unwrap(
  DriverSnapshot.create({
    id: unwrap(UserId.create('bbbbbbbbbbbbbbbbbbbbbbbbbbbb')),
    name: unwrap(PersonName.create({ first: 'Grace', last: 'Hopper' })),
    email: unwrap(Email.create('grace@yeapp.tech')),
    phoneNumber: unwrap(PhoneNumber.create('+14155552222')),
    stripeAccountId: 'acct_abc',
    pushToken: null,
    avatarUrl: null,
    vehicle: unwrap(
      VehicleSnapshot.create({
        make: 'Toyota',
        model: 'Camry',
        year: 2024,
        color: 'White',
        licensePlate: 'ABC1234',
        stockPhoto: null,
        photos: [],
      }),
    ),
  }),
);

const ECONOMY = unwrap(
  RideServiceSnapshot.create({
    id: unwrap(RideServiceId.create('economy')),
    name: 'Economy',
    baseFare: usd(2.5),
    minimumFare: usd(5),
    cancelationFee: usd(2),
    costPerKm: usd(1.25),
    costPerMinute: usd(0.2),
    seatCapacity: 4,
  }),
);

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
      routeLabels: [],
      tollPrice: null,
      routeToken: 'tk',
      description: '',
    }),
  );
}

function makeAccepted(id: string): Ride {
  const scheduled = unwrap(
    Ride.createScheduled({
      id: unwrap(RideId.create(id)),
      passenger: PASSENGER,
      rideService: ECONOMY,
      pickup: unwrap(
        Endpoint.create({
          location: MIAMI,
          address: 'pickup',
          placeName: null,
          directions: null,
        }),
      ),
      dropoff: unwrap(
        Endpoint.create({
          location: FORT_LAUDERDALE,
          address: 'dropoff',
          placeName: null,
          directions: null,
        }),
      ),
      createdAt: T_CREATED,
      schedulePickupAt: new Date(T_CREATED.getTime() + 60 * 60_000),
    }),
  );
  return unwrap(scheduled.acceptSchedule({ driver: DRIVER }));
}

describe('BeginScheduledRide', () => {
  it('flips an accepted scheduled ride to dispatched with directions + startedAt', async () => {
    const repo = new InMemoryRideRepository();
    const ride = makeAccepted('beginRide12345678901');
    await repo.create(ride);
    const sut = new BeginScheduledRide(repo, () => T_BEGIN);
    const r = await sut.execute({
      rideId: ride.id,
      pickupDirections: makeRoute(),
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.status).toBe('dispatched');
      expect(r.value.pickup.directions?.routeToken).toBe('tk');
      expect(r.value.pickupTiming.startedAt).toEqual(T_BEGIN);
    }
  });

  it('returns NotFoundError for an unknown ride', async () => {
    const repo = new InMemoryRideRepository();
    const sut = new BeginScheduledRide(repo, () => T_BEGIN);
    const r = await sut.execute({
      rideId: unwrap(RideId.create('nonexistent1234567890ab')),
      pickupDirections: makeRoute(),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('not_found');
  });

  it('refuses to begin a ride that is not scheduled_driver_accepted', async () => {
    const repo = new InMemoryRideRepository();
    const ride = makeAccepted('beginRideTwice123456');
    await repo.create(ride);
    const sut = new BeginScheduledRide(repo, () => T_BEGIN);
    await sut.execute({ rideId: ride.id, pickupDirections: makeRoute() });
    const r2 = await sut.execute({
      rideId: ride.id,
      pickupDirections: makeRoute(),
    });
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.error.code).toBe('ride_illegal_transition');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest src/app/usecases/ride/__tests__/BeginScheduledRide.test.ts`
Expected: FAIL — cannot find module `../BeginScheduledRide`.

- [ ] **Step 3: Implement the use case**

Create `src/app/usecases/ride/BeginScheduledRide.ts`:

```ts
import type { Ride } from '@domain/entities/Ride';
import type { RideId } from '@domain/entities/RideId';
import type { Route } from '@domain/entities/Route';
import type {
  AuthorizationError,
  NotFoundError,
  ValidationError,
} from '@domain/errors';
import type { RideRepository } from '@domain/repositories';
import type { Result } from '@domain/shared/Result';

/**
 * Driver begins an accepted scheduled ride. Reads the current state, runs
 * the entity transition (which enforces the `scheduled_driver_accepted`
 * precondition, attaches the driver→pickup directions, and records the
 * start time), and writes back — flipping the ride to `dispatched` so it
 * enters the normal live-trip flow. Mirrors `DispatchRide`'s shape.
 *
 * The driver app computes pickup directions (driver→pickup) via
 * `ComputeRoutes` and passes the resulting `Route` here.
 */
export class BeginScheduledRide {
  constructor(
    private readonly repo: RideRepository,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async execute(args: {
    rideId: RideId;
    pickupDirections: Route;
  }): Promise<
    Result<Ride, NotFoundError | AuthorizationError | ValidationError>
  > {
    const current = await this.repo.getById(args.rideId);
    if (!current.ok) return current;
    const next = current.value.beginScheduledRide({
      pickupDirections: args.pickupDirections,
      at: this.clock(),
    });
    if (!next.ok) return next;
    return this.repo.update(next.value);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest src/app/usecases/ride/__tests__/BeginScheduledRide.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/usecases/ride/BeginScheduledRide.ts src/app/usecases/ride/__tests__/BeginScheduledRide.test.ts
git commit -m "feat(usecase): add BeginScheduledRide"
```

---

## Task 6: Role-generalize the scheduled subscription (use case + hook + callers)

Mirror the in-progress pattern: `ObserveInProgressRides` already takes `{ userId, role }` and `useInProgressRidesSubscription(userId, role)` already exists. Bring `ObserveScheduledRides` + `useScheduledRidesSubscription` to the same shape so the driver can subscribe. This touches the working rider path, so all callers + their tests move together in one green commit.

**Files:**

- Modify: `src/app/usecases/ride/ObserveScheduledRides.ts`
- Modify: `src/app/usecases/ride/__tests__/ObserveScheduledRides.test.ts`
- Modify: `src/presentation/queries/ride.subscriptions.ts` (`useScheduledRidesSubscription`)
- Modify: `src/presentation/queries/__tests__/ride.subscriptions.test.tsx`
- Modify: `src/presentation/features/rider/view-models/useActivityViewModel.ts:161`
- Modify: `src/presentation/features/rider/view-models/useRiderHomeViewModel.ts:89`

- [ ] **Step 1: Update the use-case test to the new signature + add a driver case**

In `src/app/usecases/ride/__tests__/ObserveScheduledRides.test.ts`:

(a) Add imports for the driver snapshot at the top (with the other `@domain/entities` imports):

```ts
import {
  DriverSnapshot,
  VehicleSnapshot,
} from '@domain/entities/DriverSnapshot';
```

(b) Add a `DRIVER` const + a driver-owned accepted builder after the existing `ECONOMY` const (~`:52`):

```ts
const DRIVER = unwrap(
  DriverSnapshot.create({
    id: unwrap(UserId.create('bbbbbbbbbbbbbbbbbbbbbbbbbbbb')),
    name: unwrap(PersonName.create({ first: 'Grace', last: 'Hopper' })),
    email: unwrap(Email.create('grace@yeapp.tech')),
    phoneNumber: unwrap(PhoneNumber.create('+14155552222')),
    stripeAccountId: 'acct_abc',
    pushToken: null,
    avatarUrl: null,
    vehicle: unwrap(
      VehicleSnapshot.create({
        make: 'Toyota',
        model: 'Camry',
        year: 2024,
        color: 'White',
        licensePlate: 'ABC1234',
        stockPhoto: null,
        photos: [],
      }),
    ),
  }),
);

function makeAcceptedByDriver(id: string): Ride {
  return unwrap(makeScheduled(id, 30).acceptSchedule({ driver: DRIVER }));
}
```

(c) In the three existing `it(...)` blocks, change every `sut.execute({ passengerId: PASSENGER.id, callback ... })` to `sut.execute({ userId: PASSENGER.id, role: 'rider', callback ... })`. (Three call sites, ~`:120`, `:137`, `:152`.)

(d) Add a driver test inside the `describe('ObserveScheduledRides', ...)` block:

```ts
it('delivers the driver-scoped accepted scheduled rides for role=driver', async () => {
  const repo = new InMemoryRideRepository();
  await repo.create(makeAcceptedByDriver('FFFFFFFFFFFFFFFFFFFF'));
  await repo.create(makeScheduled('GGGGGGGGGGGGGGGGGGGG', 60)); // no driver

  const sut = new ObserveScheduledRides(repo);
  const seen: Ride[][] = [];
  const unsub = sut.execute({
    userId: DRIVER.id,
    role: 'driver',
    callback: (rs) => seen.push([...rs]),
  });
  expect(seen).toHaveLength(1);
  expect(seen[0]).toHaveLength(1);
  expect(seen[0]?.[0]?.status).toBe('scheduled_driver_accepted');
  unsub();
});
```

- [ ] **Step 2: Run the use-case test to verify it fails**

Run: `npx jest src/app/usecases/ride/__tests__/ObserveScheduledRides.test.ts`
Expected: FAIL — `execute` does not accept `{ userId, role }` (TS error) / driver case undefined.

- [ ] **Step 3: Role-generalize the use case**

Replace the body of `src/app/usecases/ride/ObserveScheduledRides.ts` `execute` (and its doc) with:

```ts
import type { Ride } from '@domain/entities/Ride';
import type { UserId } from '@domain/entities/UserId';
import type { RideRepository } from '@domain/repositories';

/**
 * Live subscription to a user's scheduled rides for the Home/Activity
 * Scheduled section. Role-parameterized (mirrors `ObserveInProgressRides`):
 * riders observe `'scheduled'` + `'scheduled_driver_accepted'`; drivers
 * observe their accepted `'scheduled_driver_accepted'` rides.
 * Subscription-shaped (synchronous unsubscribe). Callers sort by
 * `schedulePickupAt asc` client-side.
 */
export class ObserveScheduledRides {
  constructor(private readonly repo: RideRepository) {}

  execute(args: {
    userId: UserId;
    role: 'rider' | 'driver';
    callback: (rides: readonly Ride[]) => void;
  }): () => void {
    if (args.role === 'driver') {
      return this.repo.observeScheduledRidesByDriver({
        driverId: args.userId,
        callback: args.callback,
      });
    }
    return this.repo.observeScheduledRidesByPassenger({
      passengerId: args.userId,
      callback: args.callback,
    });
  }
}
```

- [ ] **Step 4: Run the use-case test to verify it passes**

Run: `npx jest src/app/usecases/ride/__tests__/ObserveScheduledRides.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Role-generalize the hook**

Replace `useScheduledRidesSubscription` in `src/presentation/queries/ride.subscriptions.ts` (~`:69`) with (mirrors `useInProgressRidesSubscription` directly above it):

```ts
export function useScheduledRidesSubscription(
  userId: UserId | null,
  role: 'rider' | 'driver',
): readonly Ride[] {
  const useCases = useUseCases();
  const canSubscribe = userId !== null;
  const rides = useUseCaseSubscription<
    readonly Ride[],
    { userId: UserId; role: 'rider' | 'driver' }
  >({
    useCase: {
      execute: (
        execArgs: { userId: UserId; role: 'rider' | 'driver' } & {
          callback: (rides: readonly Ride[]) => void;
        },
      ) => {
        if (!canSubscribe) {
          execArgs.callback([]);
          return () => undefined;
        }
        return useCases.observeScheduledRides.execute(execArgs);
      },
    },
    args: { userId: userId as UserId, role },
    deps: [
      useCases,
      canSubscribe,
      userId === null ? null : String(userId),
      role,
    ],
    initialValue: [],
  });
  return useMemo(
    () =>
      [...rides].sort((a, b) => {
        const aT = a.schedulePickupAt?.getTime() ?? Number.POSITIVE_INFINITY;
        const bT = b.schedulePickupAt?.getTime() ?? Number.POSITIVE_INFINITY;
        return aT - bT;
      }),
    [rides],
  );
}
```

Also update its doc comment's leading line from "rider's scheduled rides" to "user's scheduled rides (role-parameterized)".

- [ ] **Step 6: Update the rider callers**

In `src/presentation/features/rider/view-models/useActivityViewModel.ts:161`, change:

```ts
const scheduledRides = useScheduledRidesSubscription(passengerId);
```

to

```ts
const scheduledRides = useScheduledRidesSubscription(passengerId, 'rider');
```

In `src/presentation/features/rider/view-models/useRiderHomeViewModel.ts:89`, change:

```ts
const scheduledRides = useScheduledRidesSubscription(user?.id ?? null);
```

to

```ts
const scheduledRides = useScheduledRidesSubscription(user?.id ?? null, 'rider');
```

- [ ] **Step 7: Update the hook test**

In `src/presentation/queries/__tests__/ride.subscriptions.test.tsx` (~`:200`), replace the `renderHook(...)` call:

```ts
const { result } = renderHook(() => useScheduledRidesSubscription(PID), {
  wrapper: wrapper(rides),
});
```

with:

```ts
const { result } = renderHook(
  () => useScheduledRidesSubscription(PID, 'rider'),
  {
    wrapper: wrapper(rides),
  },
);
```

- [ ] **Step 8: Run the affected tests + typecheck**

Run: `npx jest src/presentation/queries/__tests__/ride.subscriptions.test.tsx src/app/usecases/ride/__tests__/ObserveScheduledRides.test.ts && npm run typecheck`
Expected: PASS + typecheck clean (both rider callers now pass `'rider'`).

- [ ] **Step 9: Commit**

```bash
git add src/app/usecases/ride/ObserveScheduledRides.ts src/app/usecases/ride/__tests__/ObserveScheduledRides.test.ts src/presentation/queries/ride.subscriptions.ts src/presentation/queries/__tests__/ride.subscriptions.test.tsx src/presentation/features/rider/view-models/useActivityViewModel.ts src/presentation/features/rider/view-models/useRiderHomeViewModel.ts
git commit -m "refactor(scheduled): role-parameterize ObserveScheduledRides + useScheduledRidesSubscription"
```

---

## Task 7: DI wiring for the two new use cases

**Files:**

- Modify: `src/presentation/di/container.ts`

- [ ] **Step 1: Add the imports**

In `src/presentation/di/container.ts`, add to the `@app/usecases/ride` import group (alphabetical, before `CancelRideByDriver` at `:32`):

```ts
import { AcceptScheduledRide } from '@app/usecases/ride/AcceptScheduledRide';
import { BeginScheduledRide } from '@app/usecases/ride/BeginScheduledRide';
```

- [ ] **Step 2: Add to the `UseCases` interface**

In the `UseCases` interface, under the `// Ride lifecycle (Phase 2 turn 3)` group (after `dispatchRide: DispatchRide;` at `:180`), add:

```ts
acceptScheduledRide: AcceptScheduledRide;
beginScheduledRide: BeginScheduledRide;
```

- [ ] **Step 3: Wire in `makeUseCases`**

In the `makeUseCases` return object, after `dispatchRide: new DispatchRide(args.rides, clock),` (`:348`), add:

```ts
    acceptScheduledRide: new AcceptScheduledRide(args.rides),
    beginScheduledRide: new BeginScheduledRide(args.rides, clock),
```

- [ ] **Step 4: Verify typecheck**

Run: `npm run typecheck`
Expected: clean (the two new interface members are satisfied; `clock` is already in scope in `makeUseCases`).

- [ ] **Step 5: Commit**

```bash
git add src/presentation/di/container.ts
git commit -m "feat(di): wire AcceptScheduledRide + BeginScheduledRide"
```

---

## Task 8: Mutations `useAcceptScheduledRideMutation` + `useBeginScheduledRideMutation`

**Files:**

- Modify: `src/presentation/queries/ride.queries.ts` (add after `useDispatchRideMutation`, ~`:465`)
- Modify: `src/presentation/queries/index.ts` (export both)

- [ ] **Step 1: Add the mutations**

Append to `src/presentation/queries/ride.queries.ts` (after `useDispatchRideMutation`'s closing `}`, ~`:465`). `Route` and `DriverSnapshot` are already imported at the top of this file:

```ts
/**
 * Mutation: accept a scheduled ride as this driver. Wraps
 * `AcceptScheduledRide` (flips `scheduled → scheduled_driver_accepted`,
 * stores the driver snapshot). Cache: byId set + both parties' lists
 * invalidated so the driver's Scheduled section and the rider's Scheduled
 * card reflect the acceptance immediately.
 */
export interface AcceptScheduledRideInput {
  readonly rideId: RideId;
  readonly driver: DriverSnapshot;
}

export function useAcceptScheduledRideMutation(): UseMutationResult<
  Ride,
  NotFoundError | AuthorizationError | ValidationError,
  AcceptScheduledRideInput
> {
  const useCases = useUseCases();
  const queryClient = useQueryClient();
  return useMutation<
    Ride,
    NotFoundError | AuthorizationError | ValidationError,
    AcceptScheduledRideInput
  >({
    mutationFn: async (input: AcceptScheduledRideInput): Promise<Ride> => {
      const r = await useCases.acceptScheduledRide.execute(input);
      if (!r.ok) throw r.error;
      return r.value;
    },
    onSuccess: (ride: Ride) => {
      queryClient.setQueryData<Ride>(queryKeys.ride.byId(ride.id), ride);
      if (ride.driver) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.ride.listsForDriver(ride.driver.id),
        });
      }
      void queryClient.invalidateQueries({
        queryKey: queryKeys.ride.listsForPassenger(ride.passenger.id),
      });
    },
  });
}

/**
 * Mutation: begin an accepted scheduled ride. Wraps `BeginScheduledRide`
 * (attaches pickup directions + flips `scheduled_driver_accepted →
 * dispatched`). Cache: byId set + both parties' lists invalidated so the
 * ride moves from Scheduled → In-progress on both sides.
 */
export interface BeginScheduledRideInput {
  readonly rideId: RideId;
  readonly pickupDirections: Route;
}

export function useBeginScheduledRideMutation(): UseMutationResult<
  Ride,
  NotFoundError | AuthorizationError | ValidationError,
  BeginScheduledRideInput
> {
  const useCases = useUseCases();
  const queryClient = useQueryClient();
  return useMutation<
    Ride,
    NotFoundError | AuthorizationError | ValidationError,
    BeginScheduledRideInput
  >({
    mutationFn: async (input: BeginScheduledRideInput): Promise<Ride> => {
      const r = await useCases.beginScheduledRide.execute(input);
      if (!r.ok) throw r.error;
      return r.value;
    },
    onSuccess: (ride: Ride) => {
      queryClient.setQueryData<Ride>(queryKeys.ride.byId(ride.id), ride);
      if (ride.driver) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.ride.listsForDriver(ride.driver.id),
        });
      }
      void queryClient.invalidateQueries({
        queryKey: queryKeys.ride.listsForPassenger(ride.passenger.id),
      });
    },
  });
}
```

- [ ] **Step 2: Export from the queries barrel**

In `src/presentation/queries/index.ts`, add to the `./ride.queries` export block (the one listing `useDispatchRideMutation` at `:7`), keeping alphabetical order:

```ts
  useAcceptScheduledRideMutation,
  useBeginScheduledRideMutation,
```

- [ ] **Step 3: Verify typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/presentation/queries/ride.queries.ts src/presentation/queries/index.ts
git commit -m "feat(queries): add accept/begin scheduled-ride mutations"
```

---

## Task 9: DriverDispatch view-model — three-way branch (accept / accept-schedule / begin)

The single biggest change. `DriverDispatch` becomes the "act on this ride" screen for all three driver actions. Two correctness rules:

1. **Pin the action to the first-observed status.** The existing `'gone'` check is hardcoded to `status !== 'awaiting_driver'`, which would instantly mark any scheduled ride "gone." Latch the first status the subscription emits; the action is derived from it; `'gone'` fires when the live status drifts off that pinned status (e.g. another driver accepts a `scheduled` ride, flipping it to `scheduled_driver_accepted`).
2. **Begin reuses the already-computed pickup route** and flips to `dispatched` before navigating to the monitor (which is unchanged).

**Files:**

- Modify: `src/presentation/features/driver/view-models/useDriverDispatchViewModel.ts`
- Test: `src/presentation/features/driver/view-models/__tests__/useDriverDispatchViewModel.test.tsx`

- [ ] **Step 1: Write the failing tests**

In `src/presentation/features/driver/view-models/__tests__/useDriverDispatchViewModel.test.tsx`:

(a) Add `Ride` import is already present. Add two builders after `makeDispatchedRide` (~`:161`):

```ts
function makeScheduledRide(): Ride {
  return unwrap(
    Ride.createScheduled({
      id: RIDE_ID,
      passenger: PASSENGER,
      rideService: ECONOMY_SNAPSHOT,
      pickup: unwrap(
        Endpoint.create({
          location: MIAMI,
          address: 'pickup',
          placeName: null,
          directions: null,
        }),
      ),
      dropoff: unwrap(
        Endpoint.create({
          location: FORT_LAUDERDALE,
          address: 'dropoff',
          placeName: null,
          directions: null,
        }),
      ),
      createdAt: new Date(),
      schedulePickupAt: new Date(Date.now() + 60 * 60_000),
    }),
  );
}

function makeAcceptedScheduledRide(): Ride {
  // status scheduled_driver_accepted (owned by some driver — the begin
  // path doesn't check ownership; the entity only checks status).
  const driver = unwrap(
    DriverSnapshot.create({
      id: unwrap(UserId.create('someDriverxxxxxxxxxxxxxxxxxx')),
      name: unwrap(PersonName.create({ first: 'Grace', last: 'Hopper' })),
      email: unwrap(Email.create('grace@yeapp.tech')),
      phoneNumber: unwrap(PhoneNumber.create('+14155552222')),
      stripeAccountId: 'acct_abc',
      pushToken: null,
      avatarUrl: null,
      vehicle: unwrap(
        VehicleSnapshot.create({
          make: 'Toyota',
          model: 'Camry',
          year: 2024,
          color: 'White',
          licensePlate: 'ABC1234',
          stockPhoto: null,
          photos: [],
        }),
      ),
    }),
  );
  return unwrap(makeScheduledRide().acceptSchedule({ driver }));
}
```

(b) Add these `it(...)` blocks inside `describe('useDriverDispatchViewModel', ...)`:

```ts
it("action is 'accept_schedule' for a scheduled ride; onAccept accepts and goes back (no monitor)", async () => {
  const setup = await setupSeededState({ seedRide: makeScheduledRide() });
  const { result } = renderHook(
    () =>
      useDriverDispatchViewModel({
        rideId: RIDE_ID,
        driverLocation: DRIVER_LOCATION,
      }),
    { wrapper: withTestContainer(setup) },
  );
  await waitFor(() => {
    expect(result.current.status).toBe('ready');
  });
  expect(result.current.action).toBe('accept_schedule');

  act(() => {
    result.current.onAccept();
  });

  await waitFor(() => {
    expect(mockGoBack).toHaveBeenCalled();
  });
  expect(mockReplace).not.toHaveBeenCalled();
  const persisted = await setup.ridesRepo.getById(RIDE_ID);
  expect(persisted.ok).toBe(true);
  if (persisted.ok) {
    expect(persisted.value.status).toBe('scheduled_driver_accepted');
    expect(persisted.value.driver?.id).toBe(setup.uid);
  }
});

it("action is 'begin' for an accepted scheduled ride; onAccept begins and replaces with DriverMonitor", async () => {
  const setup = await setupSeededState({
    seedRide: makeAcceptedScheduledRide(),
  });
  const { result } = renderHook(
    () =>
      useDriverDispatchViewModel({
        rideId: RIDE_ID,
        driverLocation: DRIVER_LOCATION,
      }),
    { wrapper: withTestContainer(setup) },
  );
  await waitFor(() => {
    expect(result.current.status).toBe('ready');
  });
  expect(result.current.action).toBe('begin');

  act(() => {
    result.current.onAccept();
  });

  await waitFor(() => {
    expect(mockReplace).toHaveBeenCalledWith('DriverMonitor', {
      rideId: String(RIDE_ID),
    });
  });
  expect(useDriverStatusStore.getState().mode).toBe('dispatched');
  const persisted = await setup.ridesRepo.getById(RIDE_ID);
  if (persisted.ok) expect(persisted.value.status).toBe('dispatched');
});

it("flips to 'gone' when a scheduled ride is taken by another driver mid-decision", async () => {
  const setup = await setupSeededState({ seedRide: makeScheduledRide() });
  const { result } = renderHook(
    () =>
      useDriverDispatchViewModel({
        rideId: RIDE_ID,
        driverLocation: DRIVER_LOCATION,
      }),
    { wrapper: withTestContainer(setup) },
  );
  await waitFor(() => {
    expect(result.current.status).toBe('ready');
  });

  // Another driver accepts: scheduled → scheduled_driver_accepted.
  const taken = unwrap(
    makeScheduledRide().acceptSchedule({
      driver: unwrap(
        DriverSnapshot.create({
          id: unwrap(UserId.create('rivalDriverxxxxxxxxxxxxxxxxx')),
          name: unwrap(PersonName.create({ first: 'Rival', last: 'D' })),
          email: unwrap(Email.create('rival@yeapp.tech')),
          phoneNumber: unwrap(PhoneNumber.create('+14155558888')),
          stripeAccountId: 'acct_rival',
          pushToken: null,
          avatarUrl: null,
          vehicle: null,
        }),
      ),
    }),
  );
  await act(async () => {
    await setup.ridesRepo.update(taken);
  });

  await waitFor(() => {
    expect(result.current.status).toBe('gone');
  });
});
```

(c) `UserId`, `PersonName`, `Email`, `PhoneNumber`, `DriverSnapshot`, `VehicleSnapshot`, `Endpoint`, `RideId` are all already imported at the top of this test file.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest src/presentation/features/driver/view-models/__tests__/useDriverDispatchViewModel.test.tsx -t "scheduled|begin|taken by another"`
Expected: FAIL — `result.current.action` is undefined; scheduled ride currently reports `'gone'` (hardcoded check) so the accept-schedule test fails.

- [ ] **Step 3: Add the action type + helper (module scope)**

In `src/presentation/features/driver/view-models/useDriverDispatchViewModel.ts`, add a `RideStatus` type import and `useRef`:

```ts
import { useCallback, useMemo, useRef } from 'react';
```

```ts
import type { RideStatus } from '@domain/entities/RideStatus';
```

Add near the top (after the existing `CannotAcceptReason` type, ~`:64`):

```ts
/**
 * Which driver action this dispatch-screen visit performs, derived from the
 * ride's status when the screen first painted (pinned — see the VM body).
 */
export type DispatchAction = 'accept' | 'accept_schedule' | 'begin';

function actionForStatus(status: RideStatus): DispatchAction | null {
  switch (status) {
    case 'awaiting_driver':
      return 'accept';
    case 'scheduled':
      return 'accept_schedule';
    case 'scheduled_driver_accepted':
      return 'begin';
    default:
      return null;
  }
}
```

Add `action` to the VM output interface (`UseDriverDispatchViewModel`, after `cannotAcceptReason`):

```ts
  /** Which action the Accept button performs (null until the ride loads). */
  readonly action: DispatchAction | null;
```

- [ ] **Step 4: Add the two mutations + pinned intent**

In `useDriverDispatchViewModel`, import + instantiate the new mutations alongside `dispatchMutation` (~`:92`):

```ts
import {
  useAcceptScheduledRideMutation,
  useBeginScheduledRideMutation,
  useCurrentUserQuery,
  useDispatchRideMutation,
} from '@presentation/queries';
```

```ts
const dispatchMutation = useDispatchRideMutation();
const acceptScheduleMutation = useAcceptScheduledRideMutation();
const beginMutation = useBeginScheduledRideMutation();
```

After `const user = userQuery.data ?? null;` (~`:103`), add the pinned-intent latch + action:

```ts
// Pin the action to the FIRST status the subscription emits. Anchoring to
// the initial status (rather than the live one) is what makes 'gone'
// correct: if a 'scheduled' ride we're looking at flips to
// 'scheduled_driver_accepted' because another driver accepted it, the
// live status no longer matches our pinned intent → 'gone' (we must NOT
// re-derive the action to 'begin' and let this driver hijack it).
const intentStatusRef = useRef<RideStatus | null>(null);
if (intentStatusRef.current === null && subscribedRide !== null) {
  intentStatusRef.current = subscribedRide.status;
}
const intentStatus = intentStatusRef.current;
const action = intentStatus !== null ? actionForStatus(intentStatus) : null;

const anyPending =
  dispatchMutation.isPending ||
  acceptScheduleMutation.isPending ||
  beginMutation.isPending;
const anySuccess =
  dispatchMutation.isSuccess ||
  acceptScheduleMutation.isSuccess ||
  beginMutation.isSuccess;
```

- [ ] **Step 5: Replace the status derivation**

Replace the `status` `useMemo` (~`:148`-`:181`) with:

```ts
const status = useMemo<DriverDispatchStatus>(() => {
  // 'gone' takes priority once we've pinned an intent: either the ride
  // started in a non-actionable status, or it drifted off the pinned
  // status (taken by another driver / cancelled). Guarded by
  // !anySuccess/!anyPending so our own successful transition (which
  // changes the status) doesn't read as 'gone' before we navigate.
  if (
    subscribedRide !== null &&
    intentStatus !== null &&
    !anySuccess &&
    !anyPending &&
    (action === null || subscribedRide.status !== intentStatus)
  ) {
    return 'gone';
  }
  if (anyPending) return 'accepting';
  if (cannotAcceptReason !== null) return 'cannot_accept';
  if (
    userQuery.isLoading ||
    subscribedRide === null ||
    driverLocation === null ||
    pickupRouteQuery.isLoading ||
    pickupRoute === null
  ) {
    return 'loading';
  }
  return 'ready';
}, [
  subscribedRide,
  intentStatus,
  action,
  anyPending,
  anySuccess,
  cannotAcceptReason,
  userQuery.isLoading,
  driverLocation,
  pickupRouteQuery.isLoading,
  pickupRoute,
]);
```

- [ ] **Step 6: Branch `onAccept` on the action**

Replace the `onAccept` `useCallback` (~`:183`-`:252`) with:

```ts
const onAccept = useCallback(() => {
  if (!user || user.role !== 'driver') return;
  if (!subscribedRide) return;
  if (cannotAcceptReason !== null) return;
  if (action === null) return;

  // Begin: the ride is already this driver's (reached from their own
  // Scheduled section). Attach the freshly-computed pickup route and
  // flip to dispatched, then drop into the existing monitor flow.
  if (action === 'begin') {
    if (!pickupRoute) return;
    beginMutation.mutate(
      { rideId, pickupDirections: pickupRoute },
      {
        onSuccess: () => {
          setMode('dispatched');
          navigation.replace('DriverMonitor', { rideId: String(rideId) });
        },
        onError: (e: unknown) => {
          logger.warn('beginScheduledRide failed', e);
        },
      },
    );
    return;
  }

  // accept / accept_schedule both need a DriverSnapshot.
  if (!user.phone) {
    logger.warn('driver doc missing phone; cannot build DriverSnapshot');
    return;
  }
  if (!user.stripeAccountId) {
    // Covered by cannotAcceptReason above, but TS doesn't narrow through
    // useMemo — re-check for the factory.
    return;
  }
  const snapshotR = DriverSnapshot.create({
    id: user.id,
    name: user.name,
    email: user.email,
    phoneNumber: user.phone,
    stripeAccountId: String(user.stripeAccountId),
    pushToken: user.pushToken !== null ? String(user.pushToken) : null,
    avatarUrl: user.avatarUrl,
    vehicle: null,
  });
  if (!snapshotR.ok) {
    logger.warn('DriverSnapshot.create rejected', snapshotR.error);
    return;
  }

  if (action === 'accept_schedule') {
    // No monitor — the accepted scheduled ride lands in the driver's
    // Home Scheduled section. Pop back to Home.
    acceptScheduleMutation.mutate(
      { rideId, driver: snapshotR.value },
      {
        onSuccess: () => {
          navigation.goBack();
        },
        onError: (e: unknown) => {
          logger.warn('acceptScheduledRide failed', e);
        },
      },
    );
    return;
  }

  // action === 'accept' (awaiting_driver) — immediate dispatch.
  if (!pickupRoute) return;
  dispatchMutation.mutate(
    {
      rideId,
      driver: snapshotR.value,
      pickupDirections: pickupRoute,
    },
    {
      onSuccess: () => {
        setMode('dispatched');
        navigation.replace('DriverMonitor', { rideId: String(rideId) });
      },
      onError: (e: unknown) => {
        logger.warn('dispatchRide failed', e);
      },
    },
  );
}, [
  user,
  subscribedRide,
  action,
  pickupRoute,
  cannotAcceptReason,
  rideId,
  dispatchMutation,
  acceptScheduleMutation,
  beginMutation,
  setMode,
  navigation,
]);
```

- [ ] **Step 7: Expose `action` in the return**

In the returned object (~`:258`), add `action,` (after `cannotAcceptReason,`).

- [ ] **Step 8: Run the VM tests to verify they pass**

Run: `npx jest src/presentation/features/driver/view-models/__tests__/useDriverDispatchViewModel.test.tsx`
Expected: PASS — the new scheduled/begin/gone tests AND all pre-existing tests (awaiting_driver accept, the original 'gone', cannot_accept, decline, loading) stay green.

- [ ] **Step 9: Commit**

```bash
git add src/presentation/features/driver/view-models/useDriverDispatchViewModel.ts src/presentation/features/driver/view-models/__tests__/useDriverDispatchViewModel.test.tsx
git commit -m "feat(driver): branch DriverDispatch on ride status (accept / accept-schedule / begin)"
```

---

## Task 10: DriverDispatch screen — CTA label per action

The VM now owns all branching; the screen only needs the Accept button to read "Accept" / "Accept scheduled ride" / "Begin trip". No render test exists for this screen (convention: VM-tested), so verification is typecheck/lint + the VM tests + manual.

**Files:**

- Modify: `src/presentation/features/driver/screens/DriverDispatchScreen.tsx`

- [ ] **Step 1: Thread `action` into the panel**

In `src/presentation/features/driver/screens/DriverDispatchScreen.tsx`:

(a) Extend the imported VM types (`:16`-`:19`) to include `DispatchAction`:

```ts
import type {
  CannotAcceptReason,
  DispatchAction,
  DriverDispatchStatus,
} from '../view-models/useDriverDispatchViewModel';
```

(b) Pass `action` to `<DispatchPanel>` (in `DriverDispatchInner`, ~`:119`), adding the prop:

```tsx
<DispatchPanel
  status={vm.status}
  action={vm.action}
  ride={vm.ride}
  cannotAcceptReason={vm.cannotAcceptReason}
  driverLocation={currentLocation.coordinates}
  pickupEtaText={vm.pickupRoute?.durationText ?? null}
  onAccept={vm.onAccept}
  onDecline={vm.onDecline}
/>
```

(c) Add `action` to `DispatchPanelProps` (~`:134`):

```ts
  readonly action: DispatchAction | null;
```

(d) Destructure `action` in `DispatchPanel` (~`:144`) and add a label helper at the bottom of the file (next to `messageForReason`):

```ts
function acceptLabel(action: DispatchAction | null): string {
  switch (action) {
    case 'accept_schedule':
      return 'Accept scheduled ride';
    case 'begin':
      return 'Begin trip';
    default:
      return 'Accept';
  }
}
```

(e) In the `'ready' | 'accepting'` branch's Accept `<Pressable>` (~`:259`-`:277`), replace the hard-coded label + accessibilityLabel:

```tsx
<Pressable
  onPress={onAccept}
  disabled={accepting || driverLocation === null}
  accessibilityRole="button"
  accessibilityLabel={acceptLabel(action)}
  accessibilityState={{ disabled: accepting }}
  className={`flex-1 items-center rounded-xl px-4 py-4 ${
    accepting ? 'bg-primary/60' : 'bg-primary'
  }`}
  testID="driver-dispatch-accept"
>
  {accepting ? (
    <ActivityIndicator size="small" color="white" />
  ) : (
    <Text className="text-base font-semibold text-primary-foreground">
      {acceptLabel(action)}
    </Text>
  )}
</Pressable>
```

- [ ] **Step 2: Verify typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/presentation/features/driver/screens/DriverDispatchScreen.tsx
git commit -m "feat(driver): DriverDispatch CTA label per action (accept / schedule / begin)"
```

---

## Task 11: Driver Home — wire the Scheduled section + status-branched select

**Files:**

- Modify: `src/presentation/features/driver/view-models/useDriverHomeViewModel.ts`
- Modify: `src/presentation/features/driver/screens/DriverHomeScreen.tsx`
- Modify: `src/presentation/components/trip/HomeRideSections.tsx` (stale doc comment only)
- Test: `src/presentation/features/driver/view-models/__tests__/useDriverHomeViewModel.test.tsx`

- [ ] **Step 1: Write the failing tests**

In `src/presentation/features/driver/view-models/__tests__/useDriverHomeViewModel.test.tsx`:

(a) The file already has `makeDispatchedToDriver(driverId, id)` (~`:446`). Add a sibling builder right after it for an accepted scheduled ride owned by the driver:

```ts
function makeAcceptedScheduledToDriver(driverId: UserId, id: string): Ride {
  const driverSnap = unwrap(
    DriverSnapshot.create({
      id: driverId,
      name: unwrap(PersonName.create({ first: 'Grace', last: 'Hopper' })),
      email: unwrap(Email.create('driver@yeapp.tech')),
      phoneNumber: unwrap(PhoneNumber.create('+14155552222')),
      stripeAccountId: 'acct_test',
      pushToken: null,
      avatarUrl: null,
      vehicle: unwrap(
        VehicleSnapshot.create({
          make: 'Toyota',
          model: 'Camry',
          year: 2024,
          color: 'White',
          licensePlate: 'ABC1234',
          stockPhoto: null,
          photos: [],
        }),
      ),
    }),
  );
  const scheduled = unwrap(
    Ride.createScheduled({
      id: unwrap(RideId.create(id)),
      passenger: PASSENGER,
      rideService: ECONOMY_SNAPSHOT,
      pickup: unwrap(
        Endpoint.create({
          location: MIAMI,
          address: 'pickup',
          placeName: null,
          directions: null,
        }),
      ),
      dropoff: unwrap(
        Endpoint.create({
          location: FORT_LAUDERDALE,
          address: 'dropoff',
          placeName: null,
          directions: null,
        }),
      ),
      createdAt: new Date(),
      schedulePickupAt: new Date(Date.now() + 60 * 60_000),
    }),
  );
  return unwrap(scheduled.acceptSchedule({ driver: driverSnap }));
}
```

(b) Add these tests inside `describe('useDriverHomeViewModel', ...)`:

```ts
it('exposes the driver accepted scheduled rides in scheduledRides', async () => {
  const setup = await setupSeededState();
  setup.ridesRepo.seed(
    makeAcceptedScheduledToDriver(setup.uid, 'drvHomeSched12345678'),
  );
  const { result } = renderHook(() => useDriverHomeViewModel(), {
    wrapper: withTestContainer(setup),
  });
  await waitFor(() => {
    expect(result.current.status).toBe('ready');
  });
  await waitFor(() => {
    expect(result.current.scheduledRides).toHaveLength(1);
  });
  expect(result.current.scheduledRides[0]?.status).toBe(
    'scheduled_driver_accepted',
  );
});

it('onSelectHomeRide routes an accepted scheduled ride to DriverDispatch', async () => {
  const setup = await setupSeededState();
  const accepted = makeAcceptedScheduledToDriver(
    setup.uid,
    'drvHomeSchedSel12345',
  );
  const { result } = renderHook(() => useDriverHomeViewModel(), {
    wrapper: withTestContainer(setup),
  });
  await waitFor(() => {
    expect(result.current.status).toBe('ready');
  });
  act(() => {
    result.current.onSelectHomeRide(accepted);
  });
  expect(mockNavigate).toHaveBeenCalledWith('DriverDispatch', {
    rideId: 'drvHomeSchedSel12345',
  });
});

it('onSelectHomeRide routes an in-progress ride to DriverMonitor', async () => {
  const setup = await setupSeededState();
  const dispatched = makeDispatchedToDriver(setup.uid, 'drvHomeInProg1234567');
  const { result } = renderHook(() => useDriverHomeViewModel(), {
    wrapper: withTestContainer(setup),
  });
  await waitFor(() => {
    expect(result.current.status).toBe('ready');
  });
  act(() => {
    result.current.onSelectHomeRide(dispatched);
  });
  expect(mockNavigate).toHaveBeenCalledWith('DriverMonitor', {
    rideId: 'drvHomeInProg1234567',
  });
});
```

(`Ride`, `RideId`, `DriverSnapshot`, `VehicleSnapshot`, `PersonName`, `Email`, `PhoneNumber`, `Endpoint`, `UserId` are already imported in this test file.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest src/presentation/features/driver/view-models/__tests__/useDriverHomeViewModel.test.tsx -t "scheduled|onSelectHomeRide"`
Expected: FAIL — `scheduledRides` / `onSelectHomeRide` are undefined on the VM.

- [ ] **Step 3: Add the scheduled subscription + select handler to the VM**

In `src/presentation/features/driver/view-models/useDriverHomeViewModel.ts`:

(a) `Ride` is already imported as a type in this file (used by `onSelectHomeRide(ride: Ride)`, type-only — no value import needed). Add `useScheduledRidesSubscription` to the existing `@presentation/queries` import block (~`:22`):

```ts
  useScheduledRidesSubscription,
```

(b) Add to `UseDriverHomeViewModel` interface (after `inProgressRides`, ~`:89`):

```ts
  readonly scheduledRides: readonly Ride[];
```

and after `onResumeInProgress` (~`:113`):

```ts
  /**
   * Tap a Home ride row. Routes an accepted scheduled ride
   * (`scheduled_driver_accepted`) to DriverDispatch to begin it; any
   * in-progress ride to DriverMonitor.
   */
  onSelectHomeRide: (ride: Ride) => void;
```

(c) Add the subscription after `inProgressRides` (~`:152`):

```ts
const scheduledRides = useScheduledRidesSubscription(
  user?.id ?? null,
  'driver',
);
```

(d) Add the handler after `onResumeInProgress` (~`:252`):

```ts
const onSelectHomeRide = useCallback(
  (ride: Ride) => {
    if (ride.status === 'scheduled_driver_accepted') {
      navigation.navigate('DriverDispatch', { rideId: String(ride.id) });
    } else {
      navigation.navigate('DriverMonitor', { rideId: String(ride.id) });
    }
  },
  [navigation],
);
```

(e) Add `scheduledRides,` and `onSelectHomeRide,` to the returned object (~`:293`, alongside `inProgressRides,` and `onResumeInProgress,`).

- [ ] **Step 4: Run the VM tests to verify they pass**

Run: `npx jest src/presentation/features/driver/view-models/__tests__/useDriverHomeViewModel.test.tsx`
Expected: PASS (new tests + all pre-existing tests).

- [ ] **Step 5: Wire the screen + fix the stale comment**

In `src/presentation/features/driver/screens/DriverHomeScreen.tsx`, replace the `<HomeRideSections>` block (~`:129`-`:136`):

```tsx
<HomeRideSections
  inProgressRides={vm.inProgressRides}
  scheduledRides={vm.scheduledRides}
  viewerRole="driver"
  onSelectRide={vm.onSelectHomeRide}
/>
```

In `src/presentation/components/trip/HomeRideSections.tsx`, update the now-stale doc lines (`:14`-`:15`):

```ts
 * Both roles supply real `scheduledRides`: riders see their pending +
 * driver-accepted scheduled rides; drivers see scheduled rides they've
 * accepted. The section renders only when the list is non-empty.
```

- [ ] **Step 6: Verify typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/presentation/features/driver/view-models/useDriverHomeViewModel.ts src/presentation/features/driver/screens/DriverHomeScreen.tsx src/presentation/components/trip/HomeRideSections.tsx src/presentation/features/driver/view-models/__tests__/useDriverHomeViewModel.test.tsx
git commit -m "feat(driver): fill Home Scheduled section + status-branched row tap"
```

---

## Task 12: Full verify + manual/Maestro check + doc note

**Files:**

- Modify (if referenced): `e2e/maestro/README.md` and/or the driver Maestro flow

- [ ] **Step 1: Run the full verify gate**

Run: `npm run verify`
Expected: typecheck, lint, format:check, and the full Jest suite all green. Fix any fallout before continuing (e.g. a `format:check` miss → `npx prettier --write` the touched files and amend the relevant commit).

- [ ] **Step 2: Update e2e docs if they assert the empty Scheduled section**

Run: `grep -rn "Scheduled" e2e/maestro/ || true`
If the driver README/flow states the driver Scheduled section is empty / drivers can't accept scheduled rides, update that copy to reflect the new behavior (accept from the available list → appears in the driver Home Scheduled section → Begin → DriverMonitor). If nothing references it, skip (note in the commit that no e2e doc change was needed).

- [ ] **Step 3: Commit any doc change**

```bash
git add e2e/maestro
git commit -m "docs(e2e): note driver accept-scheduled in Maestro flows"
```

(Skip this commit if Step 2 found nothing to change.)

- [ ] **Step 4: Manual verification checklist (driver = Android, against a booted dev client)**

Per `e2e/README.md`, with a stage test account:

1. As a rider, create a **scheduled** ride (future pickup) in an area a test driver covers.
2. As the driver, go **online** → the scheduled ride appears in the available list (shows "Scheduled for …").
3. Tap it → DriverDispatch shows **"Accept scheduled ride"** → accept → lands back on Home; the ride now shows in the **Scheduled** section. Confirm the rider's Scheduled card now shows the driver accepted.
4. Tap the Scheduled row → DriverDispatch shows **"Begin trip"** → begin → lands in **DriverMonitor** (en-route view); the ride leaves Scheduled and appears in **In progress** on both sides.
5. Drive through start → request payment → complete as normal (unchanged flow).

Record the outcome. This is the end-to-end acceptance check the unit tests can't cover (cross-device status propagation + the monitor hand-off).

---

## Self-review notes (author)

- **Spec coverage:** acceptSchedule (T1), beginScheduledRide (T2), observeScheduledRidesByDriver fake+Firestore (T3), AcceptScheduledRide (T4), BeginScheduledRide (T5), role-generalized scheduled subscription (T6), DI wiring (T7), mutations (T8), DriverDispatch three-way branch + pinned-intent gone fix (T9), CTA label (T10), driver Home Scheduled section + status-branched tap (T11), verify + Maestro/doc (T12). The spec's "reuse the existing available feed" needs no code (already queries `scheduled`); `TripCard`'s "Scheduled for …" line already exists — both confirmed, no task required.
- **Deviation from spec signature:** `Ride.acceptSchedule` takes `{ driver }` only (no `at`) — there is no field to store an accept time and legacy `scheduleDriver` records none; `AcceptScheduledRide` therefore needs no clock. `beginScheduledRide` keeps `{ pickupDirections, at }`.
- **Type consistency:** `DispatchAction` is defined once (T9) and consumed by the screen (T10); `AcceptScheduledRideInput`/`BeginScheduledRideInput` (T8) match the use-case `execute` args (T4/T5); `observeScheduledRidesByDriver` arg shape is identical across interface (T3), fake (T3), Firestore (T3), and use case (T6).
- **No screen render tests** added for DriverDispatch/DriverHome — neither screen has an existing test file; behavior is covered by the VM tests + the Task 12 manual run, matching the established convention.
