# Home Ride List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the persistent active-ride banner with a legacy-style list of in-progress + scheduled rides on both Home screens, so users freely roam every tab during an active ride and tap a row to open the live monitor.

**Architecture:** Add a live "in-progress rides" repository subscription mirroring the existing scheduled one, surface both through two small presentation hooks, render them as `TripCard` sections inside each Home screen's bottom panel, and delete the banner + the cold-start auto-route. Geofencing and the post-action pushes (create→RideMonitor, accept→DriverMonitor) are untouched. Driver-accept-scheduled is explicitly out of scope (a later Phase 2 plan).

**Tech Stack:** React Native 0.83, React Navigation 7, TanStack Query v5 (history) + hand-rolled live subscriptions (rides), Zustand v5, NativeWind 4, Firebase Firestore `onSnapshot`, Jest + @testing-library/react-native.

**Spec:** `docs/superpowers/specs/2026-06-08-home-ride-list-design.md`.

**Commit convention:** every commit message ends with the trailer
`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
(omitted from the `-m` snippets below for brevity — append it to each).

---

## Background facts (verified against the codebase)

- **Status sets** (from `@domain/entities/RideStatus`). The Home In-progress section is the LIVE set (excludes `scheduled` + `scheduled_driver_accepted`, which belong to the Scheduled section, and the terminals `completed`/`cancelled`):
  - **Passenger LIVE:** `awaiting_driver`, `dispatched`, `started`, `payment_requested`, `payment_failed`.
  - **Driver LIVE:** `dispatched`, `started`, `payment_requested`, `payment_failed` (a driver is never `awaiting_driver`).
  - **Scheduled (existing):** `scheduled`, `scheduled_driver_accepted` — already served by `observeScheduledRidesByPassenger`.
- **Existing mirror to copy:** `ObserveScheduledRides` use case (`src/app/usecases/ride/ObserveScheduledRides.ts`), `RideRepository.observeScheduledRidesByPassenger` (interface `src/domain/repositories/RideRepository.ts:160`), its `InMemoryRideRepository` impl (`src/shared/testing/InMemoryRideRepository.ts:221`, with `notifyScheduled`/`computeScheduled` + `scheduledObservers`), and its `FirestoreRideRepository` impl (`src/data/repositories/FirestoreRideRepository.ts:410`). The in-memory repo calls `notifyScheduled()` from `create`/`update`/`requestPayment`/`cancel`.
- **Container wiring pattern:** `UseCases` interface line `observeScheduledRides: ObserveScheduledRides;` (`container.ts:199`), wired `observeScheduledRides: new ObserveScheduledRides(args.rides),` (`container.ts:360`), imported near `container.ts:44`. `TestContainerProvider` auto-wires any new use case through `makeUseCases` when a `rides` fake is supplied — no provider change needed.
- **Activity VM** (`useActivityViewModel.ts:160-186`) currently hand-rolls the scheduled subscription (`useState` + `useEffect` + sort by `schedulePickupAt asc`) and exposes `scheduledRides`. Task 4 factors that into a shared hook the Home VMs reuse.
- **Home VMs** today consume `useInProgressRideQuery` (rider) / `useInProgressDriverRideQuery` (driver) ONLY to drive the cold-start auto-route. Those two queries also back `useActiveRideForGeofence` (`src/presentation/hooks/useActiveRideForGeofence.ts:64-67`) — they STAY for geofencing; the Home VMs stop using them.
- **Post-action navigation is independent of the auto-route:** `useRouteSelectViewModel.ts:435+` navigates to RideMonitor / RideScheduledConfirmation after create; `useDriverDispatchViewModel.ts:236` does `navigation.replace('DriverMonitor', …)` on accept. Safe to delete the focus-guards.
- **Reusable UI:** `TripCard` (`src/presentation/components/trip/TripCard.tsx`, `testID="trip-card-{id}"`, `onPress: (ride) => void`, `viewerRole: 'rider'|'driver'`) and `TripList`. `Ride` exposes `ride.schedulePickupAt: Date | null` and `ride.createdAt: Date`.
- **Test harness (both Home VM tests):** `jest.mock('@react-navigation/native', …)` exposing `mockNavigate`/`mockReplace`/`mockReset` + a `focusCallbacks: (() => void)[]` whose `useFocusEffect` mock pushes AND runs each cb; `expo-location` mocked; `setupSeededState()` seeds auth/users/serviceAreas (driver also `ridesRepo`/`vehiclesRepo`) and `useSessionStore.getState().setSignedIn(uid)`; `withTestContainer(...)`.
- **Test config:** Jest `testMatch` = `src/**/__tests__/**/*.test.ts(x)`. Single file: `npx jest <path>`. Full gate: `npm run verify` (typecheck + lint + format:check + test). `src/domain/repositories/**`, `**/__tests__/**`, and `**/index.ts` are excluded from coverage.

---

## File Structure

**Created:**

- `src/app/usecases/ride/ObserveInProgressRides.ts` — role-parameterized live in-progress subscription use case.
- `src/app/usecases/ride/__tests__/ObserveInProgressRides.test.ts`.
- `src/presentation/queries/ride.subscriptions.ts` — `useInProgressRidesSubscription`, `useScheduledRidesSubscription` hooks.
- `src/presentation/queries/__tests__/ride.subscriptions.test.tsx`.
- `src/presentation/components/trip/HomeRideSections.tsx` — In-progress + Scheduled section blocks (shared by both Home screens).
- `src/presentation/components/trip/__tests__/HomeRideSections.test.tsx`.
- `src/presentation/components/trip/__tests__/TripCard.scheduled.test.tsx` — schedule-time line.

**Modified:**

- `src/domain/repositories/RideRepository.ts` — add `observeInProgressRidesBy{Passenger,Driver}` to the interface.
- `src/shared/testing/InMemoryRideRepository.ts` — implement both + observers/notify/compute + reset.
- `src/shared/testing/__tests__/InMemoryRideRepository.test.ts` — add describe blocks.
- `src/data/repositories/FirestoreRideRepository.ts` — implement both.
- `src/presentation/di/container.ts` — wire `observeInProgressRides`.
- `src/presentation/queries/index.ts` — export the two hooks.
- `src/presentation/features/rider/view-models/useActivityViewModel.ts` — consume `useScheduledRidesSubscription`.
- `src/presentation/components/trip/TripCard.tsx` — show `schedulePickupAt`.
- `src/presentation/features/rider/view-models/useRiderHomeViewModel.ts` — remove auto-route; expose lists.
- `src/presentation/features/rider/view-models/__tests__/useRiderHomeViewModel.test.tsx`.
- `src/presentation/features/driver/view-models/useDriverHomeViewModel.ts` — remove auto-route; expose list.
- `src/presentation/features/driver/view-models/__tests__/useDriverHomeViewModel.test.tsx`.
- `src/presentation/features/rider/screens/RiderHomeScreen.tsx` — scrollable sheet + sections.
- `src/presentation/features/driver/screens/DriverHomeScreen.tsx` — in-progress section.
- `e2e/maestro/README.md`, `e2e/maestro/auth/sign-out.yaml` — update banner/trap notes.

**Deleted:**

- `src/presentation/components/trip/ActiveRideBanner.tsx` (+ `__tests__/ActiveRideBanner.test.tsx`).
- `src/presentation/features/rider/view-models/useRiderActiveRideBannerViewModel.ts` (+ test).
- `src/presentation/features/driver/view-models/useDriverActiveRideBannerViewModel.ts` (+ test).
- (revert) `src/presentation/navigation/RiderTabsNavigator.tsx`, `DriverTabsNavigator.tsx`.

**Testing strategy note:** the section-rendering logic lives in `HomeRideSections` (fully unit-tested) and the data wiring lives in the Home VMs (fully unit-tested). The two map-heavy Home _screens_ are verified by `typecheck` + the component/VM tests + the manual Maestro pass in Task 12 — no new screen-render tests (they'd require mocking `<Map>`/location for marginal coverage of pure glue).

---

## Task 1: In-progress subscription — interface + in-memory fake

**Files:**

- Modify: `src/domain/repositories/RideRepository.ts`
- Modify: `src/shared/testing/InMemoryRideRepository.ts`
- Test: `src/shared/testing/__tests__/InMemoryRideRepository.test.ts`

- [ ] **Step 1: Write the failing tests**

Append these two describe blocks at the end of `src/shared/testing/__tests__/InMemoryRideRepository.test.ts` (the file already has `makeRide`, `makeRoute`, `DRIVER`, `PASSENGER`, `ECONOMY`, `MIAMI`, `unwrap`):

```typescript
describe('InMemoryRideRepository — observeInProgressRidesByPassenger', () => {
  it('delivers LIVE passenger rides and excludes scheduled/terminal', async () => {
    const repo = new InMemoryRideRepository();
    await repo.create(makeRide({ id: 'liveAwaiting123456789', pickup: MIAMI }));

    const seen: Ride[][] = [];
    const unsub = repo.observeInProgressRidesByPassenger({
      passengerId: PASSENGER.id,
      callback: (rs) => seen.push([...rs]),
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toHaveLength(1);
    expect(seen[0]?.[0]?.status).toBe('awaiting_driver');
    unsub();
  });

  it('re-emits when a ride is created, and drops it on terminal', async () => {
    const repo = new InMemoryRideRepository();
    const seen: Ride[][] = [];
    const unsub = repo.observeInProgressRidesByPassenger({
      passengerId: PASSENGER.id,
      callback: (rs) => seen.push([...rs]),
    });
    expect(seen[0]).toEqual([]);

    const ride = makeRide({ id: 'liveCreate12345678901', pickup: MIAMI });
    await repo.create(ride);
    expect(seen[seen.length - 1]).toHaveLength(1);

    const cancelled = await repo.cancel({
      rideId: ride.id,
      by: 'rider',
      reason: unwrap(
        CancellationReason.create({ code: 'changed_mind', reasonText: null }),
      ),
    });
    expect(cancelled.ok).toBe(true);
    expect(seen[seen.length - 1]).toEqual([]);
    unsub();
  });

  it('stops emitting after unsubscribe', async () => {
    const repo = new InMemoryRideRepository();
    const seen: Ride[][] = [];
    const unsub = repo.observeInProgressRidesByPassenger({
      passengerId: PASSENGER.id,
      callback: (rs) => seen.push([...rs]),
    });
    unsub();
    await repo.create(makeRide({ id: 'liveAfterUnsub1234567', pickup: MIAMI }));
    expect(seen).toHaveLength(1);
  });
});

describe('InMemoryRideRepository — observeInProgressRidesByDriver', () => {
  it('delivers dispatched rides for the driver, excludes awaiting/other driver', async () => {
    const repo = new InMemoryRideRepository();
    // awaiting (no driver) — must NOT appear
    await repo.create(makeRide({ id: 'drvAwaiting1234567890', pickup: MIAMI }));
    // dispatched to DRIVER — must appear
    const toDispatch = makeRide({ id: 'drvDispatched123456ab', pickup: MIAMI });
    await repo.create(toDispatch);
    await repo.update(
      unwrap(
        toDispatch.dispatch({
          driver: DRIVER,
          pickupDirections: makeRoute(),
          at: new Date(),
        }),
      ),
    );

    const seen: Ride[][] = [];
    const unsub = repo.observeInProgressRidesByDriver({
      driverId: DRIVER.id,
      callback: (rs) => seen.push([...rs]),
    });
    const latest = seen[seen.length - 1] ?? [];
    expect(latest).toHaveLength(1);
    expect(String(latest[0]?.id)).toBe('drvDispatched123456ab');
    expect(latest[0]?.status).toBe('dispatched');
    unsub();
  });

  it('stops emitting after unsubscribe', async () => {
    const repo = new InMemoryRideRepository();
    const seen: Ride[][] = [];
    const unsub = repo.observeInProgressRidesByDriver({
      driverId: DRIVER.id,
      callback: (rs) => seen.push([...rs]),
    });
    unsub();
    const ride = makeRide({ id: 'drvAfterUnsub12345678', pickup: MIAMI });
    await repo.create(ride);
    await repo.update(
      unwrap(
        ride.dispatch({
          driver: DRIVER,
          pickupDirections: makeRoute(),
          at: new Date(),
        }),
      ),
    );
    expect(seen).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/shared/testing/__tests__/InMemoryRideRepository.test.ts -t "observeInProgress"`
Expected: FAIL — `repo.observeInProgressRidesByPassenger is not a function`.

- [ ] **Step 3a: Add the interface methods**

In `src/domain/repositories/RideRepository.ts`, immediately AFTER the `observeScheduledRidesByPassenger(...)` method (ends at line 163), add:

```typescript
  /**
   * Live "user's in-progress rides" subscription for the Home In-progress
   * section. Passenger LIVE statuses: awaiting_driver, dispatched, started,
   * payment_requested, payment_failed (scheduled* belong to
   * observeScheduledRidesByPassenger; terminals are excluded). Synchronous
   * unsubscribe. Ordering NOT specified server-side; callers sort by
   * createdAt desc.
   */
  observeInProgressRidesByPassenger(args: {
    passengerId: UserId;
    callback: (rides: readonly Ride[]) => void;
  }): () => void;

  /**
   * Driver-side equivalent. Driver LIVE statuses: dispatched, started,
   * payment_requested, payment_failed (no awaiting_driver — no driver yet;
   * no scheduled_driver_accepted — that's the Scheduled section).
   */
  observeInProgressRidesByDriver(args: {
    driverId: UserId;
    callback: (rides: readonly Ride[]) => void;
  }): () => void;
```

- [ ] **Step 3b: Implement in the in-memory fake**

In `src/shared/testing/InMemoryRideRepository.ts`:

(i) After the `scheduledObservers` field declaration (ends line 52), add:

```typescript
  private inProgressPassengerObservers = new Set<{
    passengerId: string;
    callback: (rides: readonly Ride[]) => void;
  }>();
  private inProgressDriverObservers = new Set<{
    driverId: string;
    callback: (rides: readonly Ride[]) => void;
  }>();
```

(ii) Add `this.notifyInProgress();` immediately after EACH existing `this.notifyScheduled();` call — there are four, in `create`, `update`, `requestPayment`, and `cancel`.

(iii) After the `observeScheduledRidesByPassenger` method (ends line 236), add:

```typescript
  observeInProgressRidesByPassenger(args: {
    passengerId: UserId;
    callback: (rides: readonly Ride[]) => void;
  }): () => void {
    const entry = {
      passengerId: String(args.passengerId),
      callback: args.callback,
    };
    this.inProgressPassengerObservers.add(entry);
    args.callback(this.computeInProgressByPassenger(entry.passengerId));
    return () => {
      this.inProgressPassengerObservers.delete(entry);
    };
  }

  observeInProgressRidesByDriver(args: {
    driverId: UserId;
    callback: (rides: readonly Ride[]) => void;
  }): () => void {
    const entry = {
      driverId: String(args.driverId),
      callback: args.callback,
    };
    this.inProgressDriverObservers.add(entry);
    args.callback(this.computeInProgressByDriver(entry.driverId));
    return () => {
      this.inProgressDriverObservers.delete(entry);
    };
  }
```

(iv) After the `computeScheduled` private method (ends line 430), add:

```typescript
  private notifyInProgress(): void {
    for (const obs of this.inProgressPassengerObservers) {
      obs.callback(this.computeInProgressByPassenger(obs.passengerId));
    }
    for (const obs of this.inProgressDriverObservers) {
      obs.callback(this.computeInProgressByDriver(obs.driverId));
    }
  }

  private computeInProgressByPassenger(passengerId: string): readonly Ride[] {
    const matching: Ride[] = [];
    for (const r of this.rides.values()) {
      if (String(r.passenger.id) !== passengerId) continue;
      if (!RIDER_LIVE_STATUSES.has(r.status)) continue;
      matching.push(r);
    }
    return matching;
  }

  private computeInProgressByDriver(driverId: string): readonly Ride[] {
    const matching: Ride[] = [];
    for (const r of this.rides.values()) {
      if (!r.driver || String(r.driver.id) !== driverId) continue;
      if (!DRIVER_LIVE_STATUSES.has(r.status)) continue;
      matching.push(r);
    }
    return matching;
  }
```

(v) In `reset()`, after `this.scheduledObservers.clear();`, add:

```typescript
this.inProgressPassengerObservers.clear();
this.inProgressDriverObservers.clear();
```

(vi) At the bottom of the file, next to `const DEFAULT_AVAILABLE_RADIUS_METERS = …`, add the status sets:

```typescript
const RIDER_LIVE_STATUSES: ReadonlySet<RideStatus> = new Set([
  'awaiting_driver',
  'dispatched',
  'started',
  'payment_requested',
  'payment_failed',
]);

const DRIVER_LIVE_STATUSES: ReadonlySet<RideStatus> = new Set([
  'dispatched',
  'started',
  'payment_requested',
  'payment_failed',
]);
```

(`RideStatus` is already imported as a type at line 7.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/shared/testing/__tests__/InMemoryRideRepository.test.ts`
Expected: PASS (new + existing).

- [ ] **Step 5: Commit**

```bash
git add src/domain/repositories/RideRepository.ts src/shared/testing/InMemoryRideRepository.ts src/shared/testing/__tests__/InMemoryRideRepository.test.ts
git commit -m "feat(ride): add observeInProgressRidesBy{Passenger,Driver} (interface + fake)"
```

---

## Task 2: In-progress subscription — Firestore adapter

**Files:**

- Modify: `src/data/repositories/FirestoreRideRepository.ts`

No unit test: the Firestore observe methods are integration-tested via Maestro, not Jest (the existing `observeScheduledRidesByPassenger` has no Jest test either). Verification is `typecheck` + the full suite + Task 12's manual pass.

- [ ] **Step 1: Implement both methods**

In `src/data/repositories/FirestoreRideRepository.ts`, immediately after the `observeScheduledRidesByPassenger` method (ends line 450), add (the helpers `query`, `collection`, `where`, `onSnapshot`, `TRIPS`, `this.toDomainOrCorrupt`, `errCode`, `logger` are already imported/used by the surrounding observe methods):

```typescript
  observeInProgressRidesByPassenger(args: {
    passengerId: UserId;
    callback: (rides: readonly Ride[]) => void;
  }): () => void {
    const q = query(
      collection(this.firestore, TRIPS),
      where('passenger.id', '==', String(args.passengerId)),
      where('status', 'in', [
        'awaiting_driver',
        'dispatched',
        'started',
        'payment_requested',
        'payment_failed',
      ]),
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
        logger.warn('observeInProgressRidesByPassenger error', {
          passengerId: String(args.passengerId),
          code: errCode(e),
        });
        args.callback([]);
      },
    );
  }

  observeInProgressRidesByDriver(args: {
    driverId: UserId;
    callback: (rides: readonly Ride[]) => void;
  }): () => void {
    const q = query(
      collection(this.firestore, TRIPS),
      where('driver.id', '==', String(args.driverId)),
      where('status', 'in', [
        'dispatched',
        'started',
        'payment_requested',
        'payment_failed',
      ]),
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
        logger.warn('observeInProgressRidesByDriver error', {
          driverId: String(args.driverId),
          code: errCode(e),
        });
        args.callback([]);
      },
    );
  }
```

- [ ] **Step 2: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS. The class now satisfies the expanded `RideRepository` interface. (If lint flags the literal status arrays, match the surrounding file's style — the scheduled method uses the same inline array shape.)

- [ ] **Step 3: Note the Firestore index check**

Both queries are `where(<owner>.id == …) AND where(status in […])` — the same equality-plus-`in` shape Firestore already serves for `observeScheduledRidesByPassenger` (`passenger.id`) and `listByDriver` (`driver.id`). No `orderBy`, so no new composite index is expected. Confirm in the Firebase console during the Task 12 manual pass; if the SDK logs a "create index" link, add it to `firestore.indexes.json` and note it in the PR.

- [ ] **Step 4: Commit**

```bash
git add src/data/repositories/FirestoreRideRepository.ts
git commit -m "feat(ride): Firestore observeInProgressRidesBy{Passenger,Driver}"
```

---

## Task 3: `ObserveInProgressRides` use case + container wiring

**Files:**

- Create: `src/app/usecases/ride/ObserveInProgressRides.ts`
- Test: `src/app/usecases/ride/__tests__/ObserveInProgressRides.test.ts`
- Modify: `src/presentation/di/container.ts`

- [ ] **Step 1: Write the failing test**

Create `src/app/usecases/ride/__tests__/ObserveInProgressRides.test.ts` (mirrors `ObserveScheduledRides.test.ts`):

```typescript
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

import { ObserveInProgressRides } from '../ObserveInProgressRides';

function unwrap<T>(r: { ok: true; value: T } | { ok: false; error: Error }): T {
  if (!r.ok) throw r.error;
  return r.value;
}
function usd(m: number) {
  return unwrap(Money.fromMajor(m, 'USD'));
}

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

function makeAwaiting(id: string): Ride {
  return unwrap(
    Ride.create({
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
      createdAt: new Date(),
    }),
  );
}
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

describe('ObserveInProgressRides', () => {
  it('rider role delivers the passenger LIVE rides', async () => {
    const repo = new InMemoryRideRepository();
    await repo.create(makeAwaiting('AAAAAAAAAAAAAAAAAAAA'));

    const sut = new ObserveInProgressRides(repo);
    const seen: Ride[][] = [];
    const unsub = sut.execute({
      userId: PASSENGER.id,
      role: 'rider',
      callback: (rs) => seen.push([...rs]),
    });
    expect(seen[0]).toHaveLength(1);
    expect(seen[0]?.[0]?.status).toBe('awaiting_driver');
    unsub();
  });

  it('driver role delivers only dispatched-to-this-driver rides', async () => {
    const repo = new InMemoryRideRepository();
    const ride = makeAwaiting('BBBBBBBBBBBBBBBBBBBB');
    await repo.create(ride);
    await repo.update(
      unwrap(
        ride.dispatch({
          driver: DRIVER,
          pickupDirections: makeRoute(),
          at: new Date(),
        }),
      ),
    );

    const sut = new ObserveInProgressRides(repo);
    const seen: Ride[][] = [];
    const unsub = sut.execute({
      userId: DRIVER.id,
      role: 'driver',
      callback: (rs) => seen.push([...rs]),
    });
    const latest = seen[seen.length - 1] ?? [];
    expect(latest).toHaveLength(1);
    expect(latest[0]?.status).toBe('dispatched');
    unsub();
  });

  it('stops emitting after unsubscribe', async () => {
    const repo = new InMemoryRideRepository();
    const sut = new ObserveInProgressRides(repo);
    const seen: Ride[][] = [];
    const unsub = sut.execute({
      userId: PASSENGER.id,
      role: 'rider',
      callback: (rs) => seen.push([...rs]),
    });
    unsub();
    await repo.create(makeAwaiting('CCCCCCCCCCCCCCCCCCCC'));
    expect(seen).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/app/usecases/ride/__tests__/ObserveInProgressRides.test.ts`
Expected: FAIL — cannot resolve module `../ObserveInProgressRides`.

- [ ] **Step 3: Write the use case**

Create `src/app/usecases/ride/ObserveInProgressRides.ts`:

```typescript
import type { Ride } from '@domain/entities/Ride';
import type { UserId } from '@domain/entities/UserId';
import type { RideRepository } from '@domain/repositories';

/**
 * Live subscription to the user's in-progress rides for the Home screen's
 * In-progress section. Role-parameterized: riders observe their
 * passenger-scoped LIVE rides, drivers their driver-scoped ones. Mirrors
 * `ObserveScheduledRides`; subscription-shaped (synchronous unsubscribe).
 */
export class ObserveInProgressRides {
  constructor(private readonly repo: RideRepository) {}

  execute(args: {
    userId: UserId;
    role: 'rider' | 'driver';
    callback: (rides: readonly Ride[]) => void;
  }): () => void {
    if (args.role === 'driver') {
      return this.repo.observeInProgressRidesByDriver({
        driverId: args.userId,
        callback: args.callback,
      });
    }
    return this.repo.observeInProgressRidesByPassenger({
      passengerId: args.userId,
      callback: args.callback,
    });
  }
}
```

- [ ] **Step 4: Wire the container**

In `src/presentation/di/container.ts`:

(i) Near line 44, after `import { ObserveScheduledRides } from '@app/usecases/ride/ObserveScheduledRides';`, add:

```typescript
import { ObserveInProgressRides } from '@app/usecases/ride/ObserveInProgressRides';
```

(ii) In the `UseCases` interface, after `observeScheduledRides: ObserveScheduledRides;` (line 199), add:

```typescript
observeInProgressRides: ObserveInProgressRides;
```

(iii) In `makeUseCases`, after `observeScheduledRides: new ObserveScheduledRides(args.rides),` (line 360), add:

```typescript
    observeInProgressRides: new ObserveInProgressRides(args.rides),
```

- [ ] **Step 5: Run test + typecheck**

Run: `npx jest src/app/usecases/ride/__tests__/ObserveInProgressRides.test.ts && npm run typecheck`
Expected: PASS (3 tests) and a clean typecheck.

- [ ] **Step 6: Commit**

```bash
git add src/app/usecases/ride/ObserveInProgressRides.ts src/app/usecases/ride/__tests__/ObserveInProgressRides.test.ts src/presentation/di/container.ts
git commit -m "feat(ride): ObserveInProgressRides use case + container wiring"
```

---

## Task 4: Shared subscription hooks + Activity VM refactor

**Files:**

- Create: `src/presentation/queries/ride.subscriptions.ts`
- Test: `src/presentation/queries/__tests__/ride.subscriptions.test.tsx`
- Modify: `src/presentation/queries/index.ts`
- Modify: `src/presentation/features/rider/view-models/useActivityViewModel.ts`

- [ ] **Step 1: Write the failing test**

Create `src/presentation/queries/__tests__/ride.subscriptions.test.tsx`:

```typescript
import { renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { Coordinates } from '@domain/entities/Coordinates';
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
import {
  useInProgressRidesSubscription,
  useScheduledRidesSubscription,
} from '@presentation/queries';
import { InMemoryRideRepository, TestContainerProvider } from '@shared/testing';

function unwrap<T>(r: { ok: true; value: T } | { ok: false; error: Error }): T {
  if (!r.ok) throw r.error;
  return r.value;
}
const usd = (m: number) => unwrap(Money.fromMajor(m, 'USD'));
const PID = unwrap(UserId.create('aaaaaaaaaaaaaaaaaaaaaaaaaaaa'));
const MIAMI = unwrap(Coordinates.create(25.7617, -80.1918));
const LAUD = unwrap(Coordinates.create(26.1224, -80.1373));

const PASSENGER = unwrap(
  PassengerSnapshot.create({
    id: PID,
    name: unwrap(PersonName.create({ first: 'Ada', last: 'Lovelace' })),
    email: unwrap(Email.create('ada@yeapp.tech')),
    phoneNumber: unwrap(PhoneNumber.create('+14155551111')),
    pushToken: null,
    avatarUrl: null,
    stripeCustomerId: null,
    defaultPaymentMethod: null,
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
function endpoints() {
  return {
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
        location: LAUD,
        address: 'dropoff',
        placeName: null,
        directions: null,
      }),
    ),
  };
}
function makeAwaiting(id: string): Ride {
  const { pickup, dropoff } = endpoints();
  return unwrap(
    Ride.create({
      id: unwrap(RideId.create(id)),
      passenger: PASSENGER,
      rideService: ECONOMY,
      pickup,
      dropoff,
      createdAt: new Date(),
    }),
  );
}
function makeScheduled(id: string, minutesAhead: number): Ride {
  const { pickup, dropoff } = endpoints();
  const createdAt = new Date('2026-04-27T12:00:00Z');
  return unwrap(
    Ride.createScheduled({
      id: unwrap(RideId.create(id)),
      passenger: PASSENGER,
      rideService: ECONOMY,
      pickup,
      dropoff,
      createdAt,
      schedulePickupAt: new Date(createdAt.getTime() + minutesAhead * 60_000),
    }),
  );
}
function wrapper(rides: InMemoryRideRepository) {
  return ({ children }: { children: ReactNode }) => (
    <TestContainerProvider rides={rides}>{children}</TestContainerProvider>
  );
}

describe('useInProgressRidesSubscription', () => {
  it('returns the rider LIVE rides; empty for a null user', async () => {
    const rides = new InMemoryRideRepository();
    rides.seed(makeAwaiting('subLive1234567890ab12'));

    const { result } = renderHook(
      () => useInProgressRidesSubscription(PID, 'rider'),
      { wrapper: wrapper(rides) },
    );
    await waitFor(() => expect(result.current).toHaveLength(1));

    const { result: nullResult } = renderHook(
      () => useInProgressRidesSubscription(null, 'rider'),
      { wrapper: wrapper(rides) },
    );
    expect(nullResult.current).toEqual([]);
  });
});

describe('useScheduledRidesSubscription', () => {
  it('returns scheduled rides sorted next-soonest-first', async () => {
    const rides = new InMemoryRideRepository();
    await rides.create(makeScheduled('subSchedLater12345ab', 120));
    await rides.create(makeScheduled('subSchedSooner1234ab', 30));

    const { result } = renderHook(() => useScheduledRidesSubscription(PID), {
      wrapper: wrapper(rides),
    });
    await waitFor(() => expect(result.current).toHaveLength(2));
    expect(String(result.current[0]?.id)).toBe('subSchedSooner1234ab');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/presentation/queries/__tests__/ride.subscriptions.test.tsx`
Expected: FAIL — `useInProgressRidesSubscription` is not exported.

- [ ] **Step 3: Write the hooks**

Create `src/presentation/queries/ride.subscriptions.ts`:

```typescript
import { useEffect, useMemo, useState } from 'react';

import type { Ride } from '@domain/entities/Ride';
import type { UserId } from '@domain/entities/UserId';
import { useUseCases } from '@presentation/di';

/**
 * Live list of the user's in-progress rides for the Home In-progress
 * section, sorted newest-first. Subscription-shaped (hand-rolled
 * useState/useEffect, mirroring the scheduled subscription) — these push
 * continuously, so they live outside TanStack Query. Empty while `userId`
 * is null or the subscription is initializing.
 */
export function useInProgressRidesSubscription(
  userId: UserId | null,
  role: 'rider' | 'driver',
): readonly Ride[] {
  const useCases = useUseCases();
  const [rides, setRides] = useState<readonly Ride[]>([]);
  useEffect(() => {
    if (!userId) {
      setRides([]);
      return;
    }
    const unsubscribe = useCases.observeInProgressRides.execute({
      userId,
      role,
      callback: setRides,
    });
    return () => unsubscribe();
  }, [userId, role, useCases.observeInProgressRides]);
  return useMemo(
    () =>
      [...rides].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
    [rides],
  );
}

/**
 * Live list of the rider's scheduled rides, sorted next-soonest-first.
 * Factored out of the Activity VM so the rider Home + Activity tab share
 * one implementation.
 */
export function useScheduledRidesSubscription(
  passengerId: UserId | null,
): readonly Ride[] {
  const useCases = useUseCases();
  const [rides, setRides] = useState<readonly Ride[]>([]);
  useEffect(() => {
    if (!passengerId) {
      setRides([]);
      return;
    }
    const unsubscribe = useCases.observeScheduledRides.execute({
      passengerId,
      callback: setRides,
    });
    return () => unsubscribe();
  }, [passengerId, useCases.observeScheduledRides]);
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

- [ ] **Step 4: Export from the queries barrel**

In `src/presentation/queries/index.ts`, add:

```typescript
export {
  useInProgressRidesSubscription,
  useScheduledRidesSubscription,
} from './ride.subscriptions';
```

- [ ] **Step 5: Refactor the Activity VM to use the shared scheduled hook**

In `src/presentation/features/rider/view-models/useActivityViewModel.ts`:

(i) Change the React import (line 6) from:

```typescript
import { useCallback, useEffect, useMemo, useState } from 'react';
```

to:

```typescript
import { useCallback, useMemo } from 'react';
```

(ii) Add after the `queryKeys` import (line 13):

```typescript
import { useScheduledRidesSubscription } from '@presentation/queries';
```

(iii) Replace the entire inline scheduled subscription block (the `const [scheduledRides, setScheduledRides] = useState…` through the closing `}, [passengerId, useCases.observeScheduledRides]);`, lines 165-186) with:

```typescript
const scheduledRides = useScheduledRidesSubscription(passengerId);
```

(The `return { … scheduledRides }` object at the bottom is unchanged.)

- [ ] **Step 6: Run tests + typecheck**

Run: `npx jest src/presentation/queries/__tests__/ride.subscriptions.test.tsx src/presentation/features/rider/view-models/__tests__/useActivityViewModel.test.tsx && npm run typecheck`
Expected: PASS — new hook tests green AND the existing Activity VM test still green (behavior unchanged).

- [ ] **Step 7: Commit**

```bash
git add src/presentation/queries/ride.subscriptions.ts src/presentation/queries/__tests__/ride.subscriptions.test.tsx src/presentation/queries/index.ts src/presentation/features/rider/view-models/useActivityViewModel.ts
git commit -m "feat(ride): shared in-progress/scheduled subscription hooks; reuse in Activity VM"
```

---

## Task 5: `HomeRideSections` presentational component

**Files:**

- Create: `src/presentation/components/trip/HomeRideSections.tsx`
- Test: `src/presentation/components/trip/__tests__/HomeRideSections.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/presentation/components/trip/__tests__/HomeRideSections.test.tsx`:

```typescript
import { fireEvent, render } from '@testing-library/react-native';

import { Coordinates } from '@domain/entities/Coordinates';
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
import { HomeRideSections } from '@presentation/components/trip/HomeRideSections';

function unwrap<T>(r: { ok: true; value: T } | { ok: false; error: Error }): T {
  if (!r.ok) throw r.error;
  return r.value;
}
const usd = (m: number) => unwrap(Money.fromMajor(m, 'USD'));
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
function makeRide(id: string): Ride {
  return unwrap(
    Ride.create({
      id: unwrap(RideId.create(id)),
      passenger: PASSENGER,
      rideService: ECONOMY,
      pickup: unwrap(
        Endpoint.create({
          location: unwrap(Coordinates.create(25.7617, -80.1918)),
          address: 'pickup',
          placeName: null,
          directions: null,
        }),
      ),
      dropoff: unwrap(
        Endpoint.create({
          location: unwrap(Coordinates.create(26.1224, -80.1373)),
          address: 'dropoff',
          placeName: null,
          directions: null,
        }),
      ),
      createdAt: new Date(),
    }),
  );
}

describe('HomeRideSections', () => {
  it('renders nothing when both lists are empty', () => {
    const { queryByTestId } = render(
      <HomeRideSections
        inProgressRides={[]}
        scheduledRides={[]}
        viewerRole="rider"
        onSelectRide={() => {}}
      />,
    );
    expect(queryByTestId('home-ride-sections')).toBeNull();
  });

  it('renders an In progress section and fires onSelectRide on tap', () => {
    const ride = makeRide('homeSecInProg12345ab');
    const onSelectRide = jest.fn();
    const { getByTestId, queryByTestId } = render(
      <HomeRideSections
        inProgressRides={[ride]}
        scheduledRides={[]}
        viewerRole="rider"
        onSelectRide={onSelectRide}
      />,
    );
    expect(getByTestId('home-in-progress-section')).toBeTruthy();
    expect(queryByTestId('home-scheduled-section')).toBeNull();
    fireEvent.press(getByTestId('trip-card-homeSecInProg12345ab'));
    expect(onSelectRide).toHaveBeenCalledWith(ride);
  });

  it('renders a Scheduled section when scheduled rides exist', () => {
    const ride = makeRide('homeSecSched123456ab');
    const { getByTestId } = render(
      <HomeRideSections
        inProgressRides={[]}
        scheduledRides={[ride]}
        viewerRole="rider"
        onSelectRide={() => {}}
      />,
    );
    expect(getByTestId('home-scheduled-section')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/presentation/components/trip/__tests__/HomeRideSections.test.tsx`
Expected: FAIL — cannot resolve module `HomeRideSections`.

- [ ] **Step 3: Write the component**

Create `src/presentation/components/trip/HomeRideSections.tsx`:

```tsx
import { Text, View } from 'react-native';

import type { Ride } from '@domain/entities/Ride';

import { TripCard } from './TripCard';

/**
 * The In-progress + Scheduled ride sections shown inside the rider/driver
 * Home bottom sheet. Pure/presentational: the Home view-models supply the
 * lists + the tap handler. Renders nothing when both lists are empty so
 * Home stays clean when there's nothing active (matches legacy
 * `InProgressTrips` / `ScheduledTrips` returning null on empty).
 *
 * The driver passes `scheduledRides={[]}` in Phase 1 (drivers can't accept
 * scheduled rides yet), so the Scheduled section never renders for drivers.
 */
export interface HomeRideSectionsProps {
  readonly inProgressRides: readonly Ride[];
  readonly scheduledRides: readonly Ride[];
  readonly viewerRole: 'rider' | 'driver';
  readonly onSelectRide: (ride: Ride) => void;
}

export function HomeRideSections({
  inProgressRides,
  scheduledRides,
  viewerRole,
  onSelectRide,
}: HomeRideSectionsProps) {
  if (inProgressRides.length === 0 && scheduledRides.length === 0) {
    return null;
  }
  return (
    <View testID="home-ride-sections">
      {inProgressRides.length > 0 && (
        <View testID="home-in-progress-section" className="mt-3">
          <Text className="mb-2 text-sm font-semibold text-foreground">
            In progress
          </Text>
          {inProgressRides.map((ride) => (
            <TripCard
              key={String(ride.id)}
              ride={ride}
              viewerRole={viewerRole}
              onPress={onSelectRide}
            />
          ))}
        </View>
      )}
      {scheduledRides.length > 0 && (
        <View testID="home-scheduled-section" className="mt-3">
          <Text className="mb-2 text-sm font-semibold text-foreground">
            Scheduled
          </Text>
          {scheduledRides.map((ride) => (
            <TripCard
              key={String(ride.id)}
              ride={ride}
              viewerRole={viewerRole}
              onPress={onSelectRide}
            />
          ))}
        </View>
      )}
    </View>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/presentation/components/trip/__tests__/HomeRideSections.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/presentation/components/trip/HomeRideSections.tsx src/presentation/components/trip/__tests__/HomeRideSections.test.tsx
git commit -m "feat(trip): add HomeRideSections (in-progress + scheduled) component"
```

---

## Task 6: `TripCard` — show the scheduled pickup time

**Files:**

- Modify: `src/presentation/components/trip/TripCard.tsx`
- Test: `src/presentation/components/trip/__tests__/TripCard.scheduled.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/presentation/components/trip/__tests__/TripCard.scheduled.test.tsx`:

```typescript
import { render } from '@testing-library/react-native';

import { Coordinates } from '@domain/entities/Coordinates';
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
import { TripCard } from '@presentation/components/trip/TripCard';

function unwrap<T>(r: { ok: true; value: T } | { ok: false; error: Error }): T {
  if (!r.ok) throw r.error;
  return r.value;
}
const usd = (m: number) => unwrap(Money.fromMajor(m, 'USD'));
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
function ends() {
  return {
    pickup: unwrap(
      Endpoint.create({
        location: unwrap(Coordinates.create(25.7617, -80.1918)),
        address: 'pickup',
        placeName: null,
        directions: null,
      }),
    ),
    dropoff: unwrap(
      Endpoint.create({
        location: unwrap(Coordinates.create(26.1224, -80.1373)),
        address: 'dropoff',
        placeName: null,
        directions: null,
      }),
    ),
  };
}

describe('TripCard scheduled-time line', () => {
  it('renders "Scheduled for …" for a scheduled ride', () => {
    const { pickup, dropoff } = ends();
    const ride = unwrap(
      Ride.createScheduled({
        id: unwrap(RideId.create('tripCardSched12345ab')),
        passenger: PASSENGER,
        rideService: ECONOMY,
        pickup,
        dropoff,
        createdAt: new Date('2026-06-01T12:00:00Z'),
        schedulePickupAt: new Date('2026-06-02T15:45:00Z'),
      }),
    );
    const { getByText } = render(
      <TripCard ride={ride} viewerRole="rider" onPress={() => {}} />,
    );
    expect(getByText(/^Scheduled for /)).toBeTruthy();
  });

  it('renders the created-at line (no "Scheduled for") for a normal ride', () => {
    const { pickup, dropoff } = ends();
    const ride = unwrap(
      Ride.create({
        id: unwrap(RideId.create('tripCardNormal1234ab')),
        passenger: PASSENGER,
        rideService: ECONOMY,
        pickup,
        dropoff,
        createdAt: new Date('2026-06-01T12:00:00Z'),
      }),
    );
    const { queryByText } = render(
      <TripCard ride={ride} viewerRole="rider" onPress={() => {}} />,
    );
    expect(queryByText(/^Scheduled for /)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/presentation/components/trip/__tests__/TripCard.scheduled.test.tsx`
Expected: FAIL — the scheduled ride renders the created-at timestamp, not "Scheduled for …".

- [ ] **Step 3: Implement**

In `src/presentation/components/trip/TripCard.tsx`, inside the `TripCard` component body (just after the `fareText` const, before the `return`), add:

```tsx
const timeText: string = ride.schedulePickupAt
  ? `Scheduled for ${formatTimestamp(ride.schedulePickupAt)}`
  : formatTimestamp(ride.createdAt);
```

Then change the timestamp line in the JSX from:

```tsx
<Text className="mt-0.5 text-xs text-muted-foreground">
  {formatTimestamp(ride.createdAt)}
</Text>
```

to:

```tsx
<Text className="mt-0.5 text-xs text-muted-foreground">{timeText}</Text>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/presentation/components/trip/__tests__/TripCard.scheduled.test.tsx src/presentation/components/trip/__tests__/TripCard.test.tsx`
Expected: PASS (new + any existing TripCard tests).

- [ ] **Step 5: Commit**

```bash
git add src/presentation/components/trip/TripCard.tsx src/presentation/components/trip/__tests__/TripCard.scheduled.test.tsx
git commit -m "feat(trip): TripCard shows scheduled pickup time when present"
```

---

## Task 7: Rider Home VM — remove auto-route, expose lists

**Files:**

- Modify (full replace): `src/presentation/features/rider/view-models/useRiderHomeViewModel.ts`
- Test: `src/presentation/features/rider/view-models/__tests__/useRiderHomeViewModel.test.tsx`

- [ ] **Step 1: Update the test file**

In `src/presentation/features/rider/view-models/__tests__/useRiderHomeViewModel.test.tsx`:

(a) Change the import (lines 31-34) from:

```typescript
import {
  resetRiderAutoRouteGuard,
  useRiderHomeViewModel,
} from '../useRiderHomeViewModel';
```

to:

```typescript
import { useRiderHomeViewModel } from '../useRiderHomeViewModel';
```

(b) In `beforeEach`, delete the line `resetRiderAutoRouteGuard();` (line 226).

(c) DELETE these three now-obsolete tests in full:

- `it('auto-routes to RideMonitor once per ride, not on every focus', …)` (lines 285-309)
- `it('does not re-route after the reset remounts RiderHome (no trap)', …)` (lines 311-344)
- `it('re-routes when a new ride id becomes active', …)` (lines 346-419)

(d) Add a `makeScheduledRiderRide` factory after the existing `makeAwaitingRiderRide` (the file already imports `Ride`; it does NOT yet use `createScheduled`, but `Ride.createScheduled` is on the same imported entity):

```typescript
function makeScheduledRiderRide(uid: UserId, id: string): Ride {
  const base = makeAwaitingRiderRide(uid, id);
  return unwrap(
    Ride.createScheduled({
      id: base.id,
      passenger: base.passenger,
      rideService: base.rideService,
      pickup: base.pickup,
      dropoff: base.dropoff,
      createdAt: base.createdAt,
      schedulePickupAt: new Date(base.createdAt.getTime() + 60 * 60_000),
    }),
  );
}
```

(e) Add these three tests inside the `describe('useRiderHomeViewModel', …)` block:

```typescript
it('exposes in-progress rides from the live subscription', async () => {
  const setup = await setupSeededState();
  const ridesRepo = new InMemoryRideRepository();
  ridesRepo.seed(makeAwaitingRiderRide(setup.uid, 'riderLive000000001ab'));

  const { result } = renderHook(() => useRiderHomeViewModel(), {
    wrapper: withTestContainer({ ...setup, ridesRepo }),
  });

  await waitFor(() => {
    expect(result.current.inProgressRides).toHaveLength(1);
  });
  expect(String(result.current.inProgressRides[0]?.id)).toBe(
    'riderLive000000001ab',
  );
});

it('exposes scheduled rides from the live subscription', async () => {
  const setup = await setupSeededState();
  const ridesRepo = new InMemoryRideRepository();
  ridesRepo.seed(makeScheduledRiderRide(setup.uid, 'riderSched00000001ab'));

  const { result } = renderHook(() => useRiderHomeViewModel(), {
    wrapper: withTestContainer({ ...setup, ridesRepo }),
  });

  await waitFor(() => {
    expect(result.current.scheduledRides).toHaveLength(1);
  });
});

it('does NOT auto-route to RideMonitor when an in-progress ride exists', async () => {
  const setup = await setupSeededState();
  const ridesRepo = new InMemoryRideRepository();
  ridesRepo.seed(makeAwaitingRiderRide(setup.uid, 'riderNoRoute0001ab12'));

  const { result } = renderHook(() => useRiderHomeViewModel(), {
    wrapper: withTestContainer({ ...setup, ridesRepo }),
  });

  await waitFor(() => {
    expect(result.current.inProgressRides).toHaveLength(1);
  });
  expect(mockReset).not.toHaveBeenCalled();
  expect(mockNavigate).not.toHaveBeenCalledWith(
    'RideMonitor',
    expect.anything(),
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/presentation/features/rider/view-models/__tests__/useRiderHomeViewModel.test.tsx`
Expected: FAIL — `resetRiderAutoRouteGuard` import removed but VM still exports the old shape / `inProgressRides` doesn't exist yet.

- [ ] **Step 3: Replace the view-model**

Replace the ENTIRE contents of `src/presentation/features/rider/view-models/useRiderHomeViewModel.ts` with:

```typescript
import { useNavigation } from '@react-navigation/native';
import { useCallback, useEffect, useMemo, useRef } from 'react';

import type { Coordinates } from '@domain/entities/Coordinates';
import type { Ride } from '@domain/entities/Ride';
import type { ServiceArea } from '@domain/entities/ServiceArea';
import type { User } from '@domain/entities/User';
import { UserLocation } from '@domain/entities/UserLocation';
import { useCurrentLocation } from '@presentation/hooks';
import type {
  LocationPermission,
  UseCurrentLocation,
} from '@presentation/hooks';
import type { RiderStackNavigation } from '@presentation/navigation/types';
import {
  useActiveServiceAreaQuery,
  useCurrentUserQuery,
  useInProgressRidesSubscription,
  useScheduledRidesSubscription,
  useUpdateLocationMutation,
} from '@presentation/queries';
import { useServiceAreaStore } from '@presentation/stores';
import { LOG } from '@shared/logger';

const logger = LOG.extend('RiderHomeVM');

/**
 * View-model for `RiderHomeScreen`.
 *
 * Composes:
 *   - `useCurrentUserQuery` — the rider's profile / `userId`.
 *   - `useCurrentLocation` — foreground GPS read for the map camera.
 *   - `useActiveServiceAreaQuery(coords)` — resolves the rider's area;
 *     mirrored into `useServiceAreaStore`.
 *   - `useInProgressRidesSubscription(userId, 'rider')` — live list for the
 *     Home In-progress section.
 *   - `useScheduledRidesSubscription(userId)` — live list for the Home
 *     Scheduled section.
 *   - `useUpdateLocationMutation` — writes the rider's location to Firestore.
 *
 * There is intentionally NO auto-route to RideMonitor: the rider lands on
 * Home, sees their active / scheduled rides in the list, and taps a row to
 * open the monitor (`resumeRide`). Removing the old focus-fired redirect is
 * what frees every tab during an active ride (replaces the active-ride
 * banner experiment).
 */

export type RiderHomeStatus =
  | 'loading'
  | 'permission_denied'
  | 'out_of_coverage'
  | 'ready';

export interface UseRiderHomeViewModel {
  readonly status: RiderHomeStatus;
  readonly user: User | null;
  readonly currentLocation: UseCurrentLocation;
  readonly activeServiceArea: ServiceArea | null;
  /** Live list of the rider's in-progress rides (newest-first). */
  readonly inProgressRides: readonly Ride[];
  /** Live list of the rider's scheduled rides (next-soonest-first). */
  readonly scheduledRides: readonly Ride[];
  readonly permissionStatus: LocationPermission;
  /** Tap handler: push to RouteSearch. */
  goToRouteSearch: () => void;
  /** Tap handler: open a ride's live monitor. */
  resumeRide: (rideId: string) => void;
  /** Re-request location permission and re-read. */
  refreshLocation: () => Promise<void>;
}

export function useRiderHomeViewModel(): UseRiderHomeViewModel {
  const navigation = useNavigation<RiderStackNavigation>();
  const userQuery = useCurrentUserQuery();
  const currentLocation = useCurrentLocation();
  const activeAreaQuery = useActiveServiceAreaQuery(
    currentLocation.coordinates,
  );
  const updateLocationMutation = useUpdateLocationMutation();
  const setReady = useServiceAreaStore((s) => s.setReady);
  const setActiveArea = useServiceAreaStore((s) => s.setActiveArea);

  const user = userQuery.data ?? null;
  const activeServiceArea = activeAreaQuery.data ?? null;
  const inProgressRides = useInProgressRidesSubscription(
    user?.id ?? null,
    'rider',
  );
  const scheduledRides = useScheduledRidesSubscription(user?.id ?? null);

  // Mirror the resolved active area into the global store so RouteSearch
  // and RouteSelect can read it without re-querying.
  useEffect(() => {
    if (!activeServiceArea) return;
    setReady([activeServiceArea]);
    setActiveArea(activeServiceArea.id);
  }, [activeServiceArea, setReady, setActiveArea]);

  // Push the rider's location to Firestore on every fresh coordinate read.
  const lastWrittenCoordsRef = useRef<Coordinates | null>(null);
  useEffect(() => {
    if (!user || !currentLocation.coordinates) return;
    if (
      lastWrittenCoordsRef.current &&
      lastWrittenCoordsRef.current.equals(currentLocation.coordinates)
    ) {
      return;
    }
    const locationR = UserLocation.create({
      userId: user.id,
      location: currentLocation.coordinates,
      speed: null,
      updatedAt: new Date(),
      tripTracking: null,
    });
    if (!locationR.ok) {
      logger.warn('updateLocation: build failed', locationR.error);
      return;
    }
    lastWrittenCoordsRef.current = currentLocation.coordinates;
    updateLocationMutation.mutate(locationR.value, {
      onError: (e: unknown) => {
        logger.warn('updateLocation: mutation failed', e);
      },
    });
  }, [user, currentLocation.coordinates, updateLocationMutation]);

  const goToRouteSearch = useCallback(() => {
    navigation.navigate('RouteSearch');
  }, [navigation]);

  const resumeRide = useCallback(
    (rideId: string) => {
      navigation.navigate('RideMonitor', { rideId });
    },
    [navigation],
  );

  const status = useMemo<RiderHomeStatus>(() => {
    if (currentLocation.permissionStatus === 'denied') {
      return 'permission_denied';
    }
    if (
      currentLocation.permissionStatus === 'undetermined' ||
      currentLocation.permissionStatus === 'requesting' ||
      userQuery.isLoading
    ) {
      return 'loading';
    }
    if (
      activeAreaQuery.data === null &&
      activeAreaQuery.isFetched &&
      currentLocation.coordinates !== null
    ) {
      return 'out_of_coverage';
    }
    return 'ready';
  }, [
    currentLocation.permissionStatus,
    currentLocation.coordinates,
    userQuery.isLoading,
    activeAreaQuery.data,
    activeAreaQuery.isFetched,
  ]);

  return {
    status,
    user,
    currentLocation,
    activeServiceArea,
    inProgressRides,
    scheduledRides,
    permissionStatus: currentLocation.permissionStatus,
    goToRouteSearch,
    resumeRide,
    refreshLocation: currentLocation.refresh,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/presentation/features/rider/view-models/__tests__/useRiderHomeViewModel.test.tsx`
Expected: PASS (remaining + new tests).

- [ ] **Step 5: Commit**

```bash
git add src/presentation/features/rider/view-models/useRiderHomeViewModel.ts src/presentation/features/rider/view-models/__tests__/useRiderHomeViewModel.test.tsx
git commit -m "feat(rider): RiderHome VM exposes in-progress/scheduled lists; drop auto-route"
```

---

## Task 8: Driver Home VM — remove auto-route, expose list

**Files:**

- Modify: `src/presentation/features/driver/view-models/useDriverHomeViewModel.ts`
- Test: `src/presentation/features/driver/view-models/__tests__/useDriverHomeViewModel.test.tsx`

- [ ] **Step 1: Update the test file**

In `src/presentation/features/driver/view-models/__tests__/useDriverHomeViewModel.test.tsx`:

(a) DELETE these three obsolete tests in full:

- `it('redirects to DriverMonitor when the driver has an in-progress ride', …)` (lines 454-512)
- `it('routes to DriverMonitor once per ride, not on every focus', …)` (lines 514-581)
- `it('re-routes when a new ride id becomes active', …)` (lines 583-708)

(b) Add this helper after `makeAwaitingRide` (it reuses the file's existing `DriverSnapshot`/`VehicleSnapshot`/`Route` imports + `MIAMI`/`FORT_LAUDERDALE`):

```typescript
function makeDispatchedToDriver(driverId: UserId, id: string): Ride {
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
  const route = unwrap(
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
  return unwrap(
    makeAwaitingRide({ id }).dispatch({
      driver: driverSnap,
      pickupDirections: route,
      at: new Date(),
    }),
  );
}
```

(c) Add these two tests inside the top-level `describe('useDriverHomeViewModel', …)` block:

```typescript
it('exposes in-progress rides from the live subscription', async () => {
  const setup = await setupSeededState();
  setup.ridesRepo.seed(
    makeDispatchedToDriver(setup.uid, 'drvHomeLive00001ab12'),
  );

  const { result } = renderHook(() => useDriverHomeViewModel(), {
    wrapper: withTestContainer(setup),
  });

  await waitFor(() => {
    expect(result.current.inProgressRides).toHaveLength(1);
  });
  expect(String(result.current.inProgressRides[0]?.id)).toBe(
    'drvHomeLive00001ab12',
  );
});

it('does NOT auto-route to DriverMonitor when an in-progress ride exists', async () => {
  const setup = await setupSeededState();
  setup.ridesRepo.seed(
    makeDispatchedToDriver(setup.uid, 'drvHomeNoRoute001ab1'),
  );

  const { result } = renderHook(() => useDriverHomeViewModel(), {
    wrapper: withTestContainer(setup),
  });

  await waitFor(() => {
    expect(result.current.inProgressRides).toHaveLength(1);
  });
  expect(
    mockNavigate.mock.calls.filter((c) => c[0] === 'DriverMonitor'),
  ).toHaveLength(0);
});

it('onResumeInProgress navigates to DriverMonitor', async () => {
  const setup = await setupSeededState();
  const { result } = renderHook(() => useDriverHomeViewModel(), {
    wrapper: withTestContainer(setup),
  });
  await waitFor(() => {
    expect(result.current.status).toBe('ready');
  });
  act(() => {
    result.current.onResumeInProgress('drvResume123456789ab');
  });
  expect(mockNavigate).toHaveBeenCalledWith('DriverMonitor', {
    rideId: 'drvResume123456789ab',
  });
});
```

(Confirm `DriverSnapshot`, `VehicleSnapshot`, `Route` are imported in this test file — they are, used by the deleted tests; keep the imports.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/presentation/features/driver/view-models/__tests__/useDriverHomeViewModel.test.tsx`
Expected: FAIL — `result.current.inProgressRides` is undefined (VM still exposes `inProgressRide`).

- [ ] **Step 3: Edit the view-model**

In `src/presentation/features/driver/view-models/useDriverHomeViewModel.ts`, apply these edits:

(D1) Imports (lines 1-2) — drop `useFocusEffect`:

```typescript
import { useNavigation } from '@react-navigation/native';
import { useCallback, useEffect, useMemo, useRef } from 'react';
```

(D2) Queries import block — swap `useInProgressDriverRideQuery` for `useInProgressRidesSubscription`:

```typescript
import {
  useActiveServiceAreaQuery,
  useAvailableRidesQuery,
  useCurrentUserQuery,
  useDriverActiveVehicleQuery,
  useInProgressRidesSubscription,
  useRideServicesQuery,
  useUpdateLocationMutation,
} from '@presentation/queries';
```

(D3) In the docstring, change the `useInProgressDriverRideQuery(driverId)` bullet (lines 53-56) to:

```typescript
 *   - `useInProgressRidesSubscription(driverId, 'driver')` — live list of
 *     the driver's currently-happening rides for the Home In-progress
 *     section. No auto-redirect: the driver taps a row to open
 *     DriverMonitor (`onResumeInProgress`).
```

(D4) Interface — change the `inProgressRide` field:

```typescript
  readonly availableRides: readonly Ride[];
  readonly inProgressRides: readonly Ride[];
```

(D5) Remove the query call (lines 135-137). Delete:

```typescript
const inProgressRideQuery = useInProgressDriverRideQuery(
  userQuery.data?.id ?? null,
);
```

(D6) Derivation (around line 152) — replace:

```typescript
const user = userQuery.data ?? null;
const activeServiceArea = activeAreaQuery.data ?? null;
const inProgressRide = inProgressRideQuery.data ?? null;
```

with:

```typescript
const user = userQuery.data ?? null;
const activeServiceArea = activeAreaQuery.data ?? null;
const inProgressRides = useInProgressRidesSubscription(
  user?.id ?? null,
  'driver',
);
```

(D7) Delete the entire auto-route block (lines 209-225, the comment + `routedRideIdRef` + `useFocusEffect(...)`):

```typescript
// Auto-redirect to the active ride, but only ONCE per ride id.
// Without the ref guard every focus event (e.g. returning from the
// Profile tab) would call navigate again, bouncing the driver straight
// back to DriverMonitor and making tabs unreachable.
// The status-router inside DriverMonitor handles every active state
// (en-route, at-pickup, started, payment_requested, payment_failed),
// so the redirect target is unconditional on status.
const routedRideIdRef = useRef<string | null>(null);
useFocusEffect(
  useCallback(() => {
    if (!inProgressRide) return;
    const rideId = String(inProgressRide.id);
    if (routedRideIdRef.current === rideId) return;
    routedRideIdRef.current = rideId;
    navigation.navigate('DriverMonitor', { rideId });
  }, [inProgressRide, navigation]),
);
```

(D8) Return object — change `inProgressRide,` to `inProgressRides,` (it sits between `availableRides,` and `permissionStatus:`).

(`useRef` is still used by `lastWrittenCoordsRef`; `navigation` is still used by the other callbacks; `useCallback` still used — no orphan imports.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/presentation/features/driver/view-models/__tests__/useDriverHomeViewModel.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/presentation/features/driver/view-models/useDriverHomeViewModel.ts src/presentation/features/driver/view-models/__tests__/useDriverHomeViewModel.test.tsx
git commit -m "feat(driver): DriverHome VM exposes in-progress list; drop auto-route"
```

---

## Task 9: Rider Home screen — scrollable sheet + sections

**Files:**

- Modify: `src/presentation/features/rider/screens/RiderHomeScreen.tsx`

No new test (see the Testing-strategy note). Verified by typecheck + the full suite + Task 12 manual.

- [ ] **Step 1: Edit the screen**

(i) Change the React Native import (line 1) to add `ScrollView` + `useWindowDimensions`:

```tsx
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
```

(ii) Add imports after the `Map` import (line 4):

```tsx
import type { Ride } from '@domain/entities/Ride';
import { HomeRideSections } from '@presentation/components/trip/HomeRideSections';
```

(iii) At the top of the component body (after `const vm = useRiderHomeViewModel();`), add:

```tsx
const { height: windowHeight } = useWindowDimensions();
```

(iv) Replace the bottom action-panel block — from `<View className="mx-4 mb-4 rounded-2xl bg-card p-4 shadow-lg">` through its closing `</View>` — with a card wrapping a bounded `ScrollView`:

```tsx
<View className="mx-4 mb-4 rounded-2xl bg-card shadow-lg">
  <ScrollView
    style={{ maxHeight: windowHeight * 0.6 }}
    contentContainerStyle={{ padding: 16 }}
    showsVerticalScrollIndicator={false}
  >
    {vm.user && (
      <Text className="mb-3 text-base text-foreground">
        Hi, {vm.user.name.first} 👋
      </Text>
    )}
    <Pressable
      onPress={vm.goToRouteSearch}
      disabled={vm.status !== 'ready'}
      accessibilityRole="button"
      accessibilityState={{ disabled: vm.status !== 'ready' }}
      className={`items-center rounded-xl px-4 py-4 ${
        vm.status === 'ready' ? 'bg-primary' : 'bg-muted'
      }`}
      testID="rider-home-where-to"
    >
      <Text
        className={`text-base font-semibold ${
          vm.status === 'ready'
            ? 'text-primary-foreground'
            : 'text-muted-foreground'
        }`}
      >
        Where to?
      </Text>
    </Pressable>
    <HomeRideSections
      inProgressRides={vm.inProgressRides}
      scheduledRides={vm.scheduledRides}
      viewerRole="rider"
      onSelectRide={(ride: Ride) => vm.resumeRide(String(ride.id))}
    />
  </ScrollView>
</View>
```

- [ ] **Step 2: Typecheck + lint + full suite**

Run: `npm run typecheck && npm run lint && npm test`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/presentation/features/rider/screens/RiderHomeScreen.tsx
git commit -m "feat(rider): RiderHome shows in-progress + scheduled rides in a scrollable sheet"
```

---

## Task 10: Driver Home screen — in-progress section

**Files:**

- Modify: `src/presentation/features/driver/screens/DriverHomeScreen.tsx`

Rationale for NO ScrollView here: the driver panel hosts the gesture-driven `DriverRideCardStack`, and a driver with an in-progress ride is `on_trip` (the available-rides stack is empty and there is at most one in-progress card), so overflow risk is negligible. Inserting one section is the surgical change.

- [ ] **Step 1: Edit the screen**

(i) Add imports after the `PermissionDeniedBanner` import (line 5):

```tsx
import type { Ride } from '@domain/entities/Ride';
import { HomeRideSections } from '@presentation/components/trip/HomeRideSections';
```

(ii) Inside the bottom-panel card — the `<View className="mx-4 mb-4 rounded-2xl bg-card p-4 shadow-lg">` — insert the section as the FIRST child, immediately after that opening tag and before the `{vm.user && !isOnline && (` greeting block:

```tsx
<HomeRideSections
  inProgressRides={vm.inProgressRides}
  scheduledRides={[]}
  viewerRole="driver"
  onSelectRide={(ride: Ride) => vm.onResumeInProgress(String(ride.id))}
/>
```

(Driver passes `scheduledRides={[]}` — Phase 1 has no driver scheduled rides; `HomeRideSections` then renders nothing when there's also no in-progress ride.)

- [ ] **Step 2: Typecheck + lint + full suite**

Run: `npm run typecheck && npm run lint && npm test`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/presentation/features/driver/screens/DriverHomeScreen.tsx
git commit -m "feat(driver): DriverHome shows an in-progress rides section"
```

---

## Task 11: Remove the active-ride banner

**Files:**

- Delete: `src/presentation/components/trip/ActiveRideBanner.tsx` + `__tests__/ActiveRideBanner.test.tsx`
- Delete: `src/presentation/features/rider/view-models/useRiderActiveRideBannerViewModel.ts` + `__tests__/useRiderActiveRideBannerViewModel.test.tsx`
- Delete: `src/presentation/features/driver/view-models/useDriverActiveRideBannerViewModel.ts` + `__tests__/useDriverActiveRideBannerViewModel.test.tsx`
- Modify (revert to plain tabs): `src/presentation/navigation/RiderTabsNavigator.tsx`, `DriverTabsNavigator.tsx`

- [ ] **Step 1: Delete the banner files**

```bash
git rm \
  src/presentation/components/trip/ActiveRideBanner.tsx \
  src/presentation/components/trip/__tests__/ActiveRideBanner.test.tsx \
  src/presentation/features/rider/view-models/useRiderActiveRideBannerViewModel.ts \
  src/presentation/features/rider/view-models/__tests__/useRiderActiveRideBannerViewModel.test.tsx \
  src/presentation/features/driver/view-models/useDriverActiveRideBannerViewModel.ts \
  src/presentation/features/driver/view-models/__tests__/useDriverActiveRideBannerViewModel.test.tsx
```

- [ ] **Step 2: Revert `RiderTabsNavigator.tsx`**

Replace the ENTIRE contents of `src/presentation/navigation/RiderTabsNavigator.tsx` with:

```tsx
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';

import { UserProfileScreen } from '@presentation/features/auth/screens/UserProfileScreen';
import ActivityScreen from '@presentation/features/rider/screens/ActivityScreen';
import RiderHomeScreen from '@presentation/features/rider/screens/RiderHomeScreen';
import WalletScreen from '@presentation/features/rider/screens/WalletScreen';

import type { RiderTabsParamList } from './types';

/**
 * Bottom tabs for the authenticated rider experience. Active and scheduled
 * rides surface as a list on RiderHome (see `HomeRideSections`), so there
 * is no persistent banner above the tabs.
 *
 * Tab bar styling intentionally minimal — visual design iterates in a
 * later turn.
 */
const Tabs = createBottomTabNavigator<RiderTabsParamList>();

export function RiderTabsNavigator() {
  return (
    <Tabs.Navigator
      initialRouteName="RiderHome"
      screenOptions={{
        headerShown: false,
        tabBarLabelStyle: { fontSize: 12 },
      }}
    >
      <Tabs.Screen
        name="RiderHome"
        component={RiderHomeScreen}
        options={{ tabBarLabel: 'Home' }}
      />
      <Tabs.Screen
        name="Activity"
        component={ActivityScreen}
        options={{ tabBarLabel: 'Activity' }}
      />
      <Tabs.Screen
        name="Wallet"
        component={WalletScreen}
        options={{ tabBarLabel: 'Wallet' }}
      />
      <Tabs.Screen
        name="Profile"
        component={UserProfileScreen}
        options={{ tabBarLabel: 'Profile' }}
      />
    </Tabs.Navigator>
  );
}
```

- [ ] **Step 3: Revert `DriverTabsNavigator.tsx`**

Replace the ENTIRE contents of `src/presentation/navigation/DriverTabsNavigator.tsx` with:

```tsx
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';

import { UserProfileScreen } from '@presentation/features/auth/screens/UserProfileScreen';
import DriverActivityScreen from '@presentation/features/driver/screens/DriverActivityScreen';
import DriverEarningsScreen from '@presentation/features/driver/screens/DriverEarningsScreen';
import DriverHomeScreen from '@presentation/features/driver/screens/DriverHomeScreen';

import type { DriverTabsParamList } from './types';

/**
 * Bottom tabs for the authenticated driver experience. Active rides surface
 * as a list on DriverHome (see `HomeRideSections`), so there is no
 * persistent banner above the tabs.
 *
 * Tab bar styling intentionally minimal — visual design iterates in a
 * later turn.
 */
const Tabs = createBottomTabNavigator<DriverTabsParamList>();

export function DriverTabsNavigator() {
  return (
    <Tabs.Navigator
      initialRouteName="DriverHome"
      screenOptions={{
        headerShown: false,
        tabBarLabelStyle: { fontSize: 12 },
      }}
    >
      <Tabs.Screen
        name="DriverHome"
        component={DriverHomeScreen}
        options={{ tabBarLabel: 'Home' }}
      />
      <Tabs.Screen
        name="Activity"
        component={DriverActivityScreen}
        options={{ tabBarLabel: 'Activity' }}
      />
      <Tabs.Screen
        name="Earnings"
        component={DriverEarningsScreen}
        options={{ tabBarLabel: 'Earnings' }}
      />
      <Tabs.Screen
        name="Profile"
        component={UserProfileScreen}
        options={{ tabBarLabel: 'Profile' }}
      />
    </Tabs.Navigator>
  );
}
```

- [ ] **Step 4: Verify nothing else references the banner**

Run: `grep -rIn "ActiveRideBanner\|ActiveRideBannerViewModel" src --include='*.ts' --include='*.tsx'`
Expected: NO output. If anything prints, remove that reference before continuing.

- [ ] **Step 5: Typecheck + lint + full suite**

Run: `npm run typecheck && npm run lint && npm test`
Expected: PASS (banner tests are gone; nothing imports the deleted modules).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(nav): remove active-ride banner; tabs render plain (list replaces it)"
```

---

## Task 12: e2e docs + full verification

**Files:**

- Modify: `e2e/maestro/README.md`, `e2e/maestro/auth/sign-out.yaml`

- [ ] **Step 1: Update the Maestro README gotcha**

In `e2e/maestro/README.md`, replace the active-ride bullet (lines 74-79) with:

```markdown
- A rider/driver with an active ride is **no longer auto-routed** to the
  monitor and is never trapped: Home shows their in-progress (and, for
  riders, scheduled) rides as a tappable list, and every tab
  (Profile/Sign-out/etc.) stays reachable. Tap the in-progress row to open
  the monitor. (Replaces the short-lived active-ride banner.)
```

- [ ] **Step 2: Update the sign-out flow note**

In `e2e/maestro/auth/sign-out.yaml`, replace the NOTE comment (lines 3-4):

```yaml
# NOTE: a rider with an ACTIVE ride is auto-routed to the ride monitor and has no
# tab bar — cancel or complete the ride first, otherwise Profile is unreachable.
```

with:

```yaml
# NOTE: the tab bar is always present now (no auto-route to the monitor), so
# Profile/Sign-out are reachable even with an active ride.
```

- [ ] **Step 3: Full verify gate**

Run: `npm run verify`
Expected: typecheck, lint, format:check, and test all PASS. If `format:check` fails, run `npx prettier --write` on the touched files and re-run.

- [ ] **Step 4: Manual smoke (simulator)**

Per the Maestro convention (rider=iOS, driver=Android):

- **Rider:** create a ride → it pushes RideMonitor (post-action push intact). Back out → Home shows an "In progress" row; every tab reachable; tap the row → RideMonitor. Schedule a ride → it appears under "Scheduled" with its pickup time. Complete/cancel → the row clears. Toggle location off → the In-progress row still shows (sections are independent of location status).
- **Driver:** accept a dispatch → DriverMonitor (post-action push intact). Back out → DriverHome shows the "In progress" row; tabs reachable; tap → DriverMonitor. Confirm no banner appears anywhere.
- Watch Metro / the Firebase console for any "create index" link from the new in-progress `onSnapshot` queries (Task 2 Step 3). If one appears, add the index and note it in the PR.

- [ ] **Step 5: Commit any doc/format fixups**

```bash
git add -A
git commit -m "docs(e2e): update active-ride notes for the Home ride list"
```

---

## Self-Review Notes

**Spec coverage:**

- Remove banner + revert navigators → Task 11. Remove cold-start auto-route → Tasks 7, 8. Post-action pushes + geofence untouched → verified in Background facts; no task modifies them.
- Live in-progress subscription (interface + fake + Firestore + use case + container + hook) → Tasks 1, 2, 3, 4. Scheduled reuse via shared hook → Task 4.
- Home sections (map backdrop + scrollable sheet rider; inserted section driver) → Tasks 5, 9, 10. Sections independent of location status (rider) → the screen renders `HomeRideSections` unconditionally inside the sheet; the VM lists come from subscriptions keyed on `userId`, not location (Task 7/9). Status split (no double-listing) → LIVE sets exclude `scheduled_driver_accepted` (Tasks 1, 2). 0..N rows / no single-active invariant → list rendering (Task 5).
- TripCard scheduled-time line → Task 6. e2e docs → Task 12.

**Type consistency:** `observeInProgressRidesByPassenger`/`observeInProgressRidesByDriver` are spelled identically in the interface (Task 1 Step 3a), the fake (1 Step 3b), Firestore (2), and the use case (3). `ObserveInProgressRides.execute({ userId, role, callback })` matches its consumer `useInProgressRidesSubscription(userId, role)` (Task 4) which the rider VM calls as `(user?.id ?? null, 'rider')` (Task 7) and the driver VM as `(user?.id ?? null, 'driver')` (Task 8). `HomeRideSections` props (`inProgressRides`, `scheduledRides`, `viewerRole`, `onSelectRide`) match both screen call sites (Tasks 9, 10). Rider taps route through `resumeRide(rideId)` (unchanged) and driver taps through `onResumeInProgress(rideId)` (unchanged) — no handler renames, avoiding the driver's existing `onSelectRide`→DriverDispatch collision.

**Placeholder scan:** every code step contains complete code; every command has an expected result. No "TBD"/"similar to"/"add error handling".

**Known assumptions flagged for execution (not placeholders):**

- Firestore `where('driver.id','==',…)` / `where('passenger.id','==',…)` + `where('status','in',[…])` need no new composite index (same shape as existing scheduled/listByDriver queries) — confirm via the console link in Task 2 Step 3 / Task 12 Step 4.
- An existing `TripCard.test.tsx` may or may not exist; Task 6 Step 4 runs it if present (a missing file is a no-op for `npx jest <path>` only if the path is omitted — the command lists both; if `TripCard.test.tsx` doesn't exist, drop it from the command).
- Line numbers cited (e.g. container `:199/:360`, driver VM `:135/:152/:209-225`) are from the reading at plan-time; if they've drifted, match by the quoted surrounding code, not the number.
