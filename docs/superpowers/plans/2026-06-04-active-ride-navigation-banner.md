# Active-Ride Navigation Banner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop trapping riders and drivers on the ride-monitor screen during an active ride — let them navigate freely (reach Profile/Sign-out/etc.) with a persistent top banner that returns them to the live ride in one tap.

**Architecture:** Two independent changes applied symmetrically to both roles. (1) Convert each home view-model's `useFocusEffect` auto-route from "fire on every focus" to "route once per ride id" via a `useRef` guard — kills the bounce-back trap while preserving the first landing. (2) Add a shared presentational `ActiveRideBanner` mounted once in each tabs navigator, fed by a thin role-specific view-model that reads the existing active-ride query and navigates the parent stack to the monitor.

**Tech Stack:** React Native 0.83, React Navigation 7 (bottom-tabs + native-stack), TanStack Query v5, Zustand v5, NativeWind 4, Jest + @testing-library/react-native, `react-native-safe-area-context`.

---

## Background facts (verified against the codebase)

- **The trap:** `useRiderHomeViewModel.ts:142-157` and `useDriverHomeViewModel.ts:213-221` each run `useFocusEffect(useCallback(() => { if (inProgressRide) navigation.<reset|navigate>(...) }, [...]))`. Because it fires on every focus, backing out of the monitor bounces straight back, leaving Profile (a tab inside the tabs navigator) unreachable.
- **Rider keeps `navigation.reset([RiderTabs, RideMonitor])`** — load-bearing so `RideReceipt`'s `popToTop()` has `RiderTabs` underneath. **Driver keeps `navigation.navigate('DriverMonitor', …)`.** Only the _trigger_ changes.
- **Active-ride queries already exist:** `useInProgressRideQuery(userId)` (rider) and `useInProgressDriverRideQuery(driverId)` (driver) in `src/presentation/queries/ride.queries.ts`. Both return `Ride | null`. Banner reuses them — TanStack dedups by query key, so no extra network cost.
- **Current user id:** `useCurrentUserId()` selector (`src/presentation/stores/useSessionStore.ts:88`) returns `UserId | null` straight from the session store. Tests seed it via `useSessionStore.getState().setSignedIn(uid)`.
- **`Ride` accessors:** `ride.id` (branded `RideId`, `String(ride.id)` for the param) and `ride.status` (`RideStatus`).
- **Navigation types:** `RiderStackNavigation` / `DriverStackNavigation` from `@presentation/navigation/types`. `RideMonitor` / `DriverMonitor` both take `{ rideId: string }`.
- **Theme tokens (`tailwind.config.js`):** `bg-primary`, `text-primary-foreground`, `bg-background`, `text-foreground` all exist. Components use NativeWind `className`.
- **Safe area:** `SafeAreaProvider` wraps the app (`App.tsx:126`); tab screens use `SafeAreaView`. The banner sits above `<Tabs.Navigator>`, so it must (a) pad its own top with the inset and (b) override the inset context to `top: 0` for the tabs below it, so screens don't double-pad. Uses `useSafeAreaInsets` + `SafeAreaInsetsContext` from `react-native-safe-area-context`.
- **Test idioms:** view-model tests use `renderHook` + `TestContainerProvider` + a `jest.mock('@react-navigation/native', …)` that captures focus callbacks in a `focusCallbacks` array and runs each `cb()` immediately. Component tests use `render` + testID assertions. The in-memory ride repo's `listRidesByPassenger` filters `r.passenger.id !== passengerId`, so a seeded rider ride's `PassengerSnapshot.id` MUST equal the seeded rider's uid.

## File Structure

**Modified:**

- `src/presentation/features/rider/view-models/useRiderHomeViewModel.ts` — route-once guard (Task 1).
- `src/presentation/features/driver/view-models/useDriverHomeViewModel.ts` — route-once guard (Task 2).
- `src/presentation/navigation/RiderTabsNavigator.tsx` — mount banner (Task 6).
- `src/presentation/navigation/DriverTabsNavigator.tsx` — mount banner (Task 6).

**Created:**

- `src/presentation/components/trip/ActiveRideBanner.tsx` — shared dumb presentational banner (Task 3).
- `src/presentation/components/trip/__tests__/ActiveRideBanner.test.tsx` (Task 3).
- `src/presentation/features/rider/view-models/useRiderActiveRideBannerViewModel.ts` — rider VM + `riderBannerLabel` (Task 4).
- `src/presentation/features/rider/view-models/__tests__/useRiderActiveRideBannerViewModel.test.tsx` (Task 4).
- `src/presentation/features/driver/view-models/useDriverActiveRideBannerViewModel.ts` — driver VM + `driverBannerLabel` (Task 5).
- `src/presentation/features/driver/view-models/__tests__/useDriverActiveRideBannerViewModel.test.tsx` (Task 5).

**Test commands:** single file → `npx jest <path>`; full gate → `npm run verify` (typecheck + lint + format:check + test).

---

## Task 1: Rider route-once guard (kill the trap)

**Files:**

- Modify: `src/presentation/features/rider/view-models/useRiderHomeViewModel.ts:142-157`
- Test: `src/presentation/features/rider/view-models/__tests__/useRiderHomeViewModel.test.tsx`

`useRef` is already imported in this file (line 2). The current `withTestContainer` in the rider test does NOT wire a rides repo — Step 1 adds one plus a seeded in-progress ride whose passenger id matches the rider's uid.

- [ ] **Step 1: Write the failing test**

Add these imports at the top of the test file (alongside the existing imports):

```typescript
import { InMemoryRideRepository } from '@shared/testing';
import { Ride } from '@domain/entities/Ride';
import { RideId } from '@domain/entities/RideId';
import { Endpoint } from '@domain/entities/Endpoint';
import { PassengerSnapshot } from '@domain/entities/PassengerSnapshot';
import { RideServiceSnapshot } from '@domain/entities/RideServiceSnapshot';
import { RideServiceId } from '@domain/entities/RideServiceId';
import { Money } from '@domain/entities/Money';
import { Coordinates } from '@domain/entities/Coordinates';
```

Add this ride factory near the other module-level helpers (after `makeArea`). It builds an `awaiting_driver` ride (a rider-active status) owned by the given uid:

```typescript
const usd = (major: number) => unwrap(Money.fromMajor(major, 'USD'));

function makeAwaitingRiderRide(uid: UserId, id: string): Ride {
  const passenger = unwrap(
    PassengerSnapshot.create({
      id: uid,
      name: unwrap(PersonName.create({ first: 'Ada', last: 'Lovelace' })),
      email: unwrap(Email.create('rider2@yeapp.tech')),
      phoneNumber: unwrap(PhoneNumber.create('+14155551111')),
      pushToken: null,
      avatarUrl: null,
      stripeCustomerId: null,
      defaultPaymentMethod: null,
    }),
  );
  const service = unwrap(
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
  const miami = unwrap(Coordinates.create(25.7617, -80.1918));
  const lauderdale = unwrap(Coordinates.create(26.1224, -80.1373));
  return unwrap(
    Ride.create({
      id: unwrap(RideId.create(id)),
      passenger,
      rideService: service,
      pickup: unwrap(
        Endpoint.create({
          location: miami,
          address: 'pickup',
          placeName: null,
          directions: null,
        }),
      ),
      dropoff: unwrap(
        Endpoint.create({
          location: lauderdale,
          address: 'dropoff',
          placeName: null,
          directions: null,
        }),
      ),
      createdAt: new Date(),
    }),
  );
}
```

Update `withTestContainer` to accept and pass a rides repo:

```typescript
function withTestContainer(opts: {
  authRepo: InMemoryAuthRepository;
  usersRepo: InMemoryUserRepository;
  serviceAreasRepo: InMemoryServiceAreaRepository;
  ridesRepo?: InMemoryRideRepository;
}) {
  return ({ children }: { children: ReactNode }) => (
    <TestContainerProvider
      auth={opts.authRepo}
      users={opts.usersRepo}
      serviceAreas={opts.serviceAreasRepo}
      rides={opts.ridesRepo}
    >
      {children}
    </TestContainerProvider>
  );
}
```

Add this test inside the `describe('useRiderHomeViewModel', …)` block. Note: the existing `useFocusEffect` mock pushes each callback into `focusCallbacks` AND runs it once — re-invoking the latest captured callback simulates a re-focus:

```typescript
it('auto-routes to RideMonitor once per ride, not on every focus', async () => {
  const setup = await setupSeededState();
  const ridesRepo = new InMemoryRideRepository();
  ridesRepo.seed(makeAwaitingRiderRide(setup.uid, 'rideOnce0000000001ab'));

  renderHook(() => useRiderHomeViewModel(), {
    wrapper: withTestContainer({ ...setup, ridesRepo }),
  });

  await waitFor(() => {
    expect(mockReset).toHaveBeenCalledWith({
      index: 1,
      routes: [
        { name: 'RiderTabs' },
        { name: 'RideMonitor', params: { rideId: 'rideOnce0000000001ab' } },
      ],
    });
  });
  expect(mockReset).toHaveBeenCalledTimes(1);

  // Simulate the rider backing out of RideMonitor → RiderHome regains
  // focus → the captured focus callback fires again. The ref guard must
  // suppress the second reset (no bounce-back trap).
  act(() => {
    focusCallbacks[focusCallbacks.length - 1]?.();
  });
  expect(mockReset).toHaveBeenCalledTimes(1);
});
```

Add `mockReset.mockClear();` and `focusCallbacks.length = 0;` to the `beforeEach` if not already present (the file already declares `mockReset` and `focusCallbacks`).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/presentation/features/rider/view-models/__tests__/useRiderHomeViewModel.test.tsx -t "auto-routes to RideMonitor once"`
Expected: FAIL — `mockReset` is called twice (current code re-routes on the simulated re-focus).

- [ ] **Step 3: Write minimal implementation**

In `useRiderHomeViewModel.ts`, replace the existing `useFocusEffect` block (lines 142-157) with the ref-guarded version. Keep the explanatory comment block above it (lines 127-141) intact; only the effect body changes:

```typescript
const routedRideIdRef = useRef<string | null>(null);
useFocusEffect(
  useCallback(() => {
    if (!inProgressRide) return;
    const rideId = String(inProgressRide.id);
    if (routedRideIdRef.current === rideId) return;
    routedRideIdRef.current = rideId;
    navigation.reset({
      index: 1,
      routes: [
        { name: 'RiderTabs' },
        { name: 'RideMonitor', params: { rideId } },
      ],
    });
  }, [inProgressRide, navigation]),
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/presentation/features/rider/view-models/__tests__/useRiderHomeViewModel.test.tsx`
Expected: PASS (new test + all existing tests in the file).

- [ ] **Step 5: Commit**

```bash
git add src/presentation/features/rider/view-models/useRiderHomeViewModel.ts src/presentation/features/rider/view-models/__tests__/useRiderHomeViewModel.test.tsx
git commit -m "fix(rider): auto-route to RideMonitor once per ride, not on every focus"
```

---

## Task 2: Driver route-once guard (kill the trap)

**Files:**

- Modify: `src/presentation/features/driver/view-models/useDriverHomeViewModel.ts:213-221`
- Test: `src/presentation/features/driver/view-models/__tests__/useDriverHomeViewModel.test.tsx`

`useRef` is already imported (line 2). The driver test already has a passing `redirects to DriverMonitor when the driver has an in-progress ride` test (lines 452-510) that builds a `dispatched` ride and seeds it — we add a sibling test that re-fires the focus callback and asserts a single navigate.

- [ ] **Step 1: Write the failing test**

Add this test immediately after the existing `redirects to DriverMonitor …` test (after line 510). It re-uses the same dispatched-ride construction inline:

```typescript
it('routes to DriverMonitor once per ride, not on every focus', async () => {
  const setup = await setupSeededState();
  const driverSnap = unwrap(
    DriverSnapshot.create({
      id: setup.uid,
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
  const dispatched = unwrap(
    makeAwaitingRide({ id: 'rideOnceDrv12345678ab' }).dispatch({
      driver: driverSnap,
      pickupDirections: route,
      at: new Date(),
    }),
  );
  setup.ridesRepo.seed(dispatched);

  renderHook(() => useDriverHomeViewModel(), {
    wrapper: withTestContainer(setup),
  });

  await waitFor(() => {
    expect(mockNavigate).toHaveBeenCalledWith('DriverMonitor', {
      rideId: 'rideOnceDrv12345678ab',
    });
  });
  expect(
    mockNavigate.mock.calls.filter((c) => c[0] === 'DriverMonitor'),
  ).toHaveLength(1);

  // Simulate the driver backing out → DriverHome refocuses → callback
  // fires again. The ref guard must suppress the second navigate.
  act(() => {
    focusCallbacks[focusCallbacks.length - 1]?.();
  });
  expect(
    mockNavigate.mock.calls.filter((c) => c[0] === 'DriverMonitor'),
  ).toHaveLength(1);
});
```

Confirm `act` is imported in this test file (it is imported from `@testing-library/react-native` in the rider test; add it to the driver test's import from the same package if missing).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/presentation/features/driver/view-models/__tests__/useDriverHomeViewModel.test.tsx -t "routes to DriverMonitor once"`
Expected: FAIL — two `DriverMonitor` navigate calls (re-route on the simulated re-focus).

- [ ] **Step 3: Write minimal implementation**

In `useDriverHomeViewModel.ts`, replace the `useFocusEffect` block (lines 213-221) with the ref-guarded version. Keep the comment block above it (lines 209-212):

```typescript
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

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/presentation/features/driver/view-models/__tests__/useDriverHomeViewModel.test.tsx`
Expected: PASS (new test + existing tests).

- [ ] **Step 5: Commit**

```bash
git add src/presentation/features/driver/view-models/useDriverHomeViewModel.ts src/presentation/features/driver/view-models/__tests__/useDriverHomeViewModel.test.tsx
git commit -m "fix(driver): route to DriverMonitor once per ride, not on every focus"
```

---

## Task 3: Shared `ActiveRideBanner` presentational component

**Files:**

- Create: `src/presentation/components/trip/ActiveRideBanner.tsx`
- Test: `src/presentation/components/trip/__tests__/ActiveRideBanner.test.tsx`

Dumb component: renders nothing when not visible; otherwise a full-width tappable bar with a status dot, the status label, and a "Return" affordance. `topInset` pads the top so the bar clears the notch (the navigator passes the real inset; tests pass `0`).

- [ ] **Step 1: Write the failing test**

```typescript
import { fireEvent, render } from '@testing-library/react-native';

import { ActiveRideBanner } from '@presentation/components/trip/ActiveRideBanner';

describe('ActiveRideBanner', () => {
  it('renders nothing when not visible', () => {
    const { queryByTestId } = render(
      <ActiveRideBanner visible={false} statusLabel="" onReturn={() => {}} topInset={0} />,
    );
    expect(queryByTestId('active-ride-banner')).toBeNull();
  });

  it('renders the status label when visible', () => {
    const { getByTestId, getByText } = render(
      <ActiveRideBanner visible statusLabel="Driver on the way" onReturn={() => {}} topInset={0} />,
    );
    expect(getByTestId('active-ride-banner')).toBeTruthy();
    expect(getByText('Driver on the way')).toBeTruthy();
  });

  it('calls onReturn when pressed', () => {
    const onReturn = jest.fn();
    const { getByTestId } = render(
      <ActiveRideBanner visible statusLabel="On your trip" onReturn={onReturn} topInset={0} />,
    );
    fireEvent.press(getByTestId('active-ride-banner'));
    expect(onReturn).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/presentation/components/trip/__tests__/ActiveRideBanner.test.tsx`
Expected: FAIL — cannot resolve module `ActiveRideBanner`.

- [ ] **Step 3: Write minimal implementation**

```tsx
import { Pressable, Text, View } from 'react-native';

/**
 * Persistent "you have a live ride" bar shown across the rider/driver
 * bottom tabs while a ride is active. Tapping returns to the monitor.
 *
 * Dumb/presentational: all state (visibility, status label, navigation)
 * is owned by the role-specific banner view-models
 * (`useRiderActiveRideBannerViewModel` / `useDriverActiveRideBannerViewModel`).
 * `topInset` is the safe-area top inset supplied by the mounting
 * navigator so the bar clears the notch; the navigator also zeroes the
 * inset context for the tabs below it so screens don't double-pad.
 */
export interface ActiveRideBannerProps {
  readonly visible: boolean;
  readonly statusLabel: string;
  readonly onReturn: () => void;
  readonly topInset: number;
}

export function ActiveRideBanner({
  visible,
  statusLabel,
  onReturn,
  topInset,
}: ActiveRideBannerProps) {
  if (!visible) return null;
  return (
    <Pressable
      testID="active-ride-banner"
      accessibilityRole="button"
      accessibilityLabel={`${statusLabel}. Tap to return to your ride.`}
      onPress={onReturn}
      style={{ paddingTop: topInset }}
      className="bg-primary active:opacity-80"
    >
      <View className="flex-row items-center justify-between px-4 py-2">
        <View className="flex-row items-center">
          <View
            testID="active-ride-banner-dot"
            className="mr-2 h-2 w-2 rounded-full bg-primary-foreground"
          />
          <Text className="text-sm font-semibold text-primary-foreground">
            {statusLabel}
          </Text>
        </View>
        <Text className="text-sm font-medium text-primary-foreground">
          Return ›
        </Text>
      </View>
    </Pressable>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/presentation/components/trip/__tests__/ActiveRideBanner.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/presentation/components/trip/ActiveRideBanner.tsx src/presentation/components/trip/__tests__/ActiveRideBanner.test.tsx
git commit -m "feat(trip): add shared ActiveRideBanner presentational component"
```

---

## Task 4: Rider banner view-model + label map

**Files:**

- Create: `src/presentation/features/rider/view-models/useRiderActiveRideBannerViewModel.ts`
- Test: `src/presentation/features/rider/view-models/__tests__/useRiderActiveRideBannerViewModel.test.tsx`

The VM reads `useCurrentUserId()` → `useInProgressRideQuery(userId)`, maps `ride.status` to a rider-facing label, and exposes `onReturn` that navigates the parent stack to `RideMonitor`. It returns the `ActiveRideBannerProps` shape minus `topInset` (the navigator supplies `topInset`).

- [ ] **Step 1: Write the failing test**

This test reuses the rider test's seeding approach. Build a small awaiting-ride factory inline (passenger id = seeded uid so the query finds it):

```typescript
import { act, renderHook, waitFor } from '@testing-library/react-native';
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
import type { UserId } from '@domain/entities/UserId';
import { useRiderActiveRideBannerViewModel } from '@presentation/features/rider/view-models/useRiderActiveRideBannerViewModel';
import { useSessionStore } from '@presentation/stores';
import {
  InMemoryAuthRepository,
  InMemoryRideRepository,
  TestContainerProvider,
} from '@shared/testing';

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
}));

function unwrap<T>(r: { ok: true; value: T } | { ok: false; error: Error }): T {
  if (!r.ok) throw r.error;
  return r.value;
}

const usd = (major: number) => unwrap(Money.fromMajor(major, 'USD'));

function makeAwaitingRiderRide(uid: UserId, id: string): Ride {
  const passenger = unwrap(
    PassengerSnapshot.create({
      id: uid,
      name: unwrap(PersonName.create({ first: 'Ada', last: 'Lovelace' })),
      email: unwrap(Email.create('rider@yeapp.tech')),
      phoneNumber: unwrap(PhoneNumber.create('+14155551111')),
      pushToken: null,
      avatarUrl: null,
      stripeCustomerId: null,
      defaultPaymentMethod: null,
    }),
  );
  const service = unwrap(
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
  const miami = unwrap(Coordinates.create(25.7617, -80.1918));
  const lauderdale = unwrap(Coordinates.create(26.1224, -80.1373));
  return unwrap(
    Ride.create({
      id: unwrap(RideId.create(id)),
      passenger,
      rideService: service,
      pickup: unwrap(
        Endpoint.create({ location: miami, address: 'pickup', placeName: null, directions: null }),
      ),
      dropoff: unwrap(
        Endpoint.create({ location: lauderdale, address: 'dropoff', placeName: null, directions: null }),
      ),
      createdAt: new Date(),
    }),
  );
}

async function seedRider(): Promise<{ ridesRepo: InMemoryRideRepository; uid: UserId }> {
  const authRepo = new InMemoryAuthRepository();
  const uid = unwrap(
    await authRepo.signUp({ email: unwrap(Email.create('rider@yeapp.tech')), password: 'pw1234' }),
  );
  useSessionStore.getState().setSignedIn(uid);
  return { ridesRepo: new InMemoryRideRepository(), uid };
}

function wrapper(ridesRepo: InMemoryRideRepository) {
  return ({ children }: { children: ReactNode }) => (
    <TestContainerProvider rides={ridesRepo}>{children}</TestContainerProvider>
  );
}

describe('useRiderActiveRideBannerViewModel', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    useSessionStore.getState().setSignedOut();
  });

  it('is hidden when there is no active ride', async () => {
    const { ridesRepo } = await seedRider();
    const { result } = renderHook(() => useRiderActiveRideBannerViewModel(), {
      wrapper: wrapper(ridesRepo),
    });
    await waitFor(() => {
      expect(result.current.visible).toBe(false);
    });
    expect(result.current.statusLabel).toBe('');
  });

  it('shows a status-aware label and navigates to RideMonitor on return', async () => {
    const { ridesRepo, uid } = await seedRider();
    ridesRepo.seed(makeAwaitingRiderRide(uid, 'rideBanner000000001ab'));

    const { result } = renderHook(() => useRiderActiveRideBannerViewModel(), {
      wrapper: wrapper(ridesRepo),
    });

    await waitFor(() => {
      expect(result.current.visible).toBe(true);
    });
    expect(result.current.statusLabel).toBe('Finding your driver');

    act(() => {
      result.current.onReturn();
    });
    expect(mockNavigate).toHaveBeenCalledWith('RideMonitor', {
      rideId: 'rideBanner000000001ab',
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/presentation/features/rider/view-models/__tests__/useRiderActiveRideBannerViewModel.test.tsx`
Expected: FAIL — cannot resolve module `useRiderActiveRideBannerViewModel`.

- [ ] **Step 3: Write minimal implementation**

```typescript
import { useNavigation } from '@react-navigation/native';
import { useCallback } from 'react';

import type { RideStatus } from '@domain/entities/RideStatus';
import type { ActiveRideBannerProps } from '@presentation/components/trip/ActiveRideBanner';
import type { RiderStackNavigation } from '@presentation/navigation/types';
import { useInProgressRideQuery } from '@presentation/queries';
import { useCurrentUserId } from '@presentation/stores';

/** Rider-facing status copy for the active-ride banner. */
export function riderBannerLabel(status: RideStatus): string {
  switch (status) {
    case 'awaiting_driver':
      return 'Finding your driver';
    case 'scheduled_driver_accepted':
      return 'Driver assigned';
    case 'dispatched':
      return 'Driver on the way';
    case 'started':
      return 'On your trip';
    case 'payment_requested':
      return 'Wrapping up';
    case 'payment_failed':
      return 'Payment issue — tap to resolve';
    default:
      return 'Ride in progress';
  }
}

/** Output is the banner's props minus `topInset` (supplied by the navigator). */
export type UseActiveRideBannerViewModel = Omit<
  ActiveRideBannerProps,
  'topInset'
>;

export function useRiderActiveRideBannerViewModel(): UseActiveRideBannerViewModel {
  const navigation = useNavigation<RiderStackNavigation>();
  const userId = useCurrentUserId();
  const { data: ride } = useInProgressRideQuery(userId);

  const onReturn = useCallback(() => {
    if (ride) {
      navigation.navigate('RideMonitor', { rideId: String(ride.id) });
    }
  }, [ride, navigation]);

  return {
    visible: ride != null,
    statusLabel: ride ? riderBannerLabel(ride.status) : '',
    onReturn,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/presentation/features/rider/view-models/__tests__/useRiderActiveRideBannerViewModel.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/presentation/features/rider/view-models/useRiderActiveRideBannerViewModel.ts src/presentation/features/rider/view-models/__tests__/useRiderActiveRideBannerViewModel.test.tsx
git commit -m "feat(rider): add active-ride banner view-model with status-aware labels"
```

---

## Task 5: Driver banner view-model + label map

**Files:**

- Create: `src/presentation/features/driver/view-models/useDriverActiveRideBannerViewModel.ts`
- Test: `src/presentation/features/driver/view-models/__tests__/useDriverActiveRideBannerViewModel.test.tsx`

Mirror of Task 4 with `useInProgressDriverRideQuery`, driver labels, and `DriverMonitor`. A driver-active ride must be in `scheduled_driver_accepted`+ — easiest is to build an awaiting ride and `.dispatch(...)` it to the seeded driver (the in-memory driver query filters by `driver.id`).

- [ ] **Step 1: Write the failing test**

```typescript
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { Coordinates } from '@domain/entities/Coordinates';
import { DriverSnapshot } from '@domain/entities/DriverSnapshot';
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
import { VehicleSnapshot } from '@domain/entities/VehicleSnapshot';
import { useDriverActiveRideBannerViewModel } from '@presentation/features/driver/view-models/useDriverActiveRideBannerViewModel';
import { useSessionStore } from '@presentation/stores';
import {
  InMemoryAuthRepository,
  InMemoryRideRepository,
  TestContainerProvider,
} from '@shared/testing';

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
}));

function unwrap<T>(r: { ok: true; value: T } | { ok: false; error: Error }): T {
  if (!r.ok) throw r.error;
  return r.value;
}

const usd = (major: number) => unwrap(Money.fromMajor(major, 'USD'));
const MIAMI = unwrap(Coordinates.create(25.7617, -80.1918));
const FORT_LAUDERDALE = unwrap(Coordinates.create(26.1224, -80.1373));

function makeDispatchedDriverRide(driverId: UserId, id: string): Ride {
  const passenger = unwrap(
    PassengerSnapshot.create({
      id: unwrap(UserId.create('passengerxxxxxxxxxxxxxxxxxxx')),
      name: unwrap(PersonName.create({ first: 'Ada', last: 'Lovelace' })),
      email: unwrap(Email.create('ada@yeapp.tech')),
      phoneNumber: unwrap(PhoneNumber.create('+14155551111')),
      pushToken: null,
      avatarUrl: null,
      stripeCustomerId: null,
      defaultPaymentMethod: null,
    }),
  );
  const service = unwrap(
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
  const awaiting = unwrap(
    Ride.create({
      id: unwrap(RideId.create(id)),
      passenger,
      rideService: service,
      pickup: unwrap(
        Endpoint.create({ location: MIAMI, address: 'pickup', placeName: null, directions: null }),
      ),
      dropoff: unwrap(
        Endpoint.create({ location: FORT_LAUDERDALE, address: 'dropoff', placeName: null, directions: null }),
      ),
      createdAt: new Date(),
    }),
  );
  const driver = unwrap(
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
  return unwrap(awaiting.dispatch({ driver, pickupDirections: route, at: new Date() }));
}

async function seedDriver(): Promise<{ ridesRepo: InMemoryRideRepository; uid: UserId }> {
  const authRepo = new InMemoryAuthRepository();
  const uid = unwrap(
    await authRepo.signUp({ email: unwrap(Email.create('driver@yeapp.tech')), password: 'pw1234' }),
  );
  useSessionStore.getState().setSignedIn(uid);
  return { ridesRepo: new InMemoryRideRepository(), uid };
}

function wrapper(ridesRepo: InMemoryRideRepository) {
  return ({ children }: { children: ReactNode }) => (
    <TestContainerProvider rides={ridesRepo}>{children}</TestContainerProvider>
  );
}

describe('useDriverActiveRideBannerViewModel', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    useSessionStore.getState().setSignedOut();
  });

  it('is hidden when there is no active ride', async () => {
    const { ridesRepo } = await seedDriver();
    const { result } = renderHook(() => useDriverActiveRideBannerViewModel(), {
      wrapper: wrapper(ridesRepo),
    });
    await waitFor(() => {
      expect(result.current.visible).toBe(false);
    });
  });

  it('shows a status-aware label and navigates to DriverMonitor on return', async () => {
    const { ridesRepo, uid } = await seedDriver();
    ridesRepo.seed(makeDispatchedDriverRide(uid, 'rideDrvBanner00001ab'));

    const { result } = renderHook(() => useDriverActiveRideBannerViewModel(), {
      wrapper: wrapper(ridesRepo),
    });

    await waitFor(() => {
      expect(result.current.visible).toBe(true);
    });
    expect(result.current.statusLabel).toBe('Heading to pickup');

    act(() => {
      result.current.onReturn();
    });
    expect(mockNavigate).toHaveBeenCalledWith('DriverMonitor', {
      rideId: 'rideDrvBanner00001ab',
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/presentation/features/driver/view-models/__tests__/useDriverActiveRideBannerViewModel.test.tsx`
Expected: FAIL — cannot resolve module `useDriverActiveRideBannerViewModel`.

- [ ] **Step 3: Write minimal implementation**

```typescript
import { useNavigation } from '@react-navigation/native';
import { useCallback } from 'react';

import type { RideStatus } from '@domain/entities/RideStatus';
import type { UseActiveRideBannerViewModel } from '@presentation/features/rider/view-models/useRiderActiveRideBannerViewModel';
import type { DriverStackNavigation } from '@presentation/navigation/types';
import { useInProgressDriverRideQuery } from '@presentation/queries';
import { useCurrentUserId } from '@presentation/stores';

/** Driver-facing status copy for the active-ride banner. */
export function driverBannerLabel(status: RideStatus): string {
  switch (status) {
    case 'scheduled_driver_accepted':
      return 'Pickup scheduled';
    case 'dispatched':
      return 'Heading to pickup';
    case 'started':
      return 'Trip in progress';
    case 'payment_requested':
      return 'Awaiting payment';
    case 'payment_failed':
      return 'Payment issue';
    default:
      return 'Active ride';
  }
}

export function useDriverActiveRideBannerViewModel(): UseActiveRideBannerViewModel {
  const navigation = useNavigation<DriverStackNavigation>();
  const driverId = useCurrentUserId();
  const { data: ride } = useInProgressDriverRideQuery(driverId);

  const onReturn = useCallback(() => {
    if (ride) {
      navigation.navigate('DriverMonitor', { rideId: String(ride.id) });
    }
  }, [ride, navigation]);

  return {
    visible: ride != null,
    statusLabel: ride ? driverBannerLabel(ride.status) : '',
    onReturn,
  };
}
```

Note: `UseActiveRideBannerViewModel` is the shared output type exported from the rider VM (Task 4). Importing it here is a within-presentation import (no boundary violation).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/presentation/features/driver/view-models/__tests__/useDriverActiveRideBannerViewModel.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/presentation/features/driver/view-models/useDriverActiveRideBannerViewModel.ts src/presentation/features/driver/view-models/__tests__/useDriverActiveRideBannerViewModel.test.tsx
git commit -m "feat(driver): add active-ride banner view-model with status-aware labels"
```

---

## Task 6: Mount the banner in both tabs navigators

**Files:**

- Modify: `src/presentation/navigation/RiderTabsNavigator.tsx`
- Modify: `src/presentation/navigation/DriverTabsNavigator.tsx`

Wrap each `<Tabs.Navigator>` in a flex column: banner on top (padded with the safe-area top inset), tabs below. When the banner is visible, override the inset context to `top: 0` for the tabs so screens that use `SafeAreaView` don't double-pad under the notch. These navigators have no unit tests; verification is the full suite + manual checks in Task 7.

- [ ] **Step 1: Replace `RiderTabsNavigator.tsx` with:**

```tsx
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { View } from 'react-native';
import {
  SafeAreaInsetsContext,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';

import { ActiveRideBanner } from '@presentation/components/trip/ActiveRideBanner';
import { UserProfileScreen } from '@presentation/features/auth/screens/UserProfileScreen';
import { useRiderActiveRideBannerViewModel } from '@presentation/features/rider/view-models/useRiderActiveRideBannerViewModel';
import ActivityScreen from '@presentation/features/rider/screens/ActivityScreen';
import RiderHomeScreen from '@presentation/features/rider/screens/RiderHomeScreen';
import WalletScreen from '@presentation/features/rider/screens/WalletScreen';

import type { RiderTabsParamList } from './types';

/**
 * Bottom tabs for the authenticated rider experience. A persistent
 * `ActiveRideBanner` sits above the tabs while a ride is active so the
 * rider can roam every tab (Profile/Wallet/Activity) and tap back to the
 * live ride — the auto-route to RideMonitor now fires once per ride
 * (see useRiderHomeViewModel), not on every focus.
 */
const Tabs = createBottomTabNavigator<RiderTabsParamList>();

export function RiderTabsNavigator() {
  const insets = useSafeAreaInsets();
  const banner = useRiderActiveRideBannerViewModel();

  return (
    <View className="flex-1">
      <ActiveRideBanner {...banner} topInset={insets.top} />
      <SafeAreaInsetsContext.Provider
        value={{ ...insets, top: banner.visible ? 0 : insets.top }}
      >
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
      </SafeAreaInsetsContext.Provider>
    </View>
  );
}
```

- [ ] **Step 2: Replace `DriverTabsNavigator.tsx` analogously.**

Read the current file first to preserve its exact `Tabs.Screen` set (DriverHome, Activity, Earnings, Profile) and any screen options, then apply the same wrapper:

```tsx
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { View } from 'react-native';
import {
  SafeAreaInsetsContext,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';

import { ActiveRideBanner } from '@presentation/components/trip/ActiveRideBanner';
import { UserProfileScreen } from '@presentation/features/auth/screens/UserProfileScreen';
import DriverActivityScreen from '@presentation/features/driver/screens/DriverActivityScreen';
import DriverEarningsScreen from '@presentation/features/driver/screens/DriverEarningsScreen';
import DriverHomeScreen from '@presentation/features/driver/screens/DriverHomeScreen';
import { useDriverActiveRideBannerViewModel } from '@presentation/features/driver/view-models/useDriverActiveRideBannerViewModel';

import type { DriverTabsParamList } from './types';

const Tabs = createBottomTabNavigator<DriverTabsParamList>();

export function DriverTabsNavigator() {
  const insets = useSafeAreaInsets();
  const banner = useDriverActiveRideBannerViewModel();

  return (
    <View className="flex-1">
      <ActiveRideBanner {...banner} topInset={insets.top} />
      <SafeAreaInsetsContext.Provider
        value={{ ...insets, top: banner.visible ? 0 : insets.top }}
      >
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
      </SafeAreaInsetsContext.Provider>
    </View>
  );
}
```

**IMPORTANT:** Before writing, run `cat src/presentation/navigation/DriverTabsNavigator.tsx` and reconcile the exact import paths/default-vs-named imports and screen-option values for `DriverActivityScreen` / `DriverEarningsScreen` / `DriverHomeScreen`. Use whatever the current file uses — do not assume default vs named.

- [ ] **Step 3: Typecheck + lint the navigators**

Run: `npm run typecheck && npm run lint`
Expected: PASS. If lint's `boundaries` rule flags the navigator importing the banner VM, that's a same-layer (presentation→presentation) import and should be allowed; no `eslint.config.js` override is needed. If it errors, STOP and re-read — it likely means a wrong import path, not a real boundary crossing.

- [ ] **Step 4: Run the full test suite**

Run: `npm test`
Expected: PASS (no regressions; navigators are exercised by existing render/integration tests if any).

- [ ] **Step 5: Commit**

```bash
git add src/presentation/navigation/RiderTabsNavigator.tsx src/presentation/navigation/DriverTabsNavigator.tsx
git commit -m "feat(nav): mount persistent active-ride banner above rider/driver tabs"
```

---

## Task 7: Full verification + manual checklist

**Files:** none (verification only).

- [ ] **Step 1: Run the full verify gate**

Run: `npm run verify`
Expected: typecheck, lint, format:check, and test all PASS. If `format:check` fails, run `npx prettier --write` on the touched files and re-run.

- [ ] **Step 2: Manual smoke (simulator) — rider**

Per the Maestro convention rider=iOS. With a rider account that has an active ride:

- App opens / ride created → lands on RideMonitor once.
- Back out of RideMonitor → lands on a tab; banner is visible at the top of every tab (Home/Activity/Wallet/Profile).
- Reach Profile → tap Sign-out: it works (no bounce).
- Tap the banner → returns to RideMonitor.
- Confirm no double top-inset gap under the notch on any tab (the inset override handles this).
- Complete/cancel the ride → banner disappears.

- [ ] **Step 3: Manual smoke (simulator) — driver**

Per the Maestro convention driver=Android. Repeat Step 2 with a driver account on an active ride: banner shows across DriverHome/Activity/Earnings/Profile, labels reflect status ("Heading to pickup" / "Trip in progress" / …), tapping returns to DriverMonitor, banner clears on completion. Confirm the banner does NOT appear on `DriverDispatch` (incoming offer) or `DriverNavigation` (full-screen turn-by-turn) — both are stack screens above the tabs.

- [ ] **Step 4: Final commit (only if Step 1 required format fixups)**

```bash
git add -A
git commit -m "chore: prettier formatting for active-ride banner feature"
```

---

## Self-Review Notes

**Spec coverage:** Piece 1 (route-once) → Tasks 1-2. Piece 2 (banner: shared component + two VMs + mounting) → Tasks 3-6. Status-aware labels → Tasks 4-5 (`riderBannerLabel` / `driverBannerLabel`, full status tables from the spec). Top placement + safe-area + no-double-inset → Task 6. Driver parity + scope boundaries (Dispatch/Navigation excluded) → Tasks 2, 5, 6, and Task 7 Step 3. Test plan → each task's TDD steps + Task 7 manual checklist.

**Type consistency:** `UseActiveRideBannerViewModel` defined once (Task 4) and reused (Task 5). `ActiveRideBannerProps` defined in the component (Task 3); VMs return `Omit<…, 'topInset'>`; navigators spread VM output + add `topInset` (Task 6). `riderBannerLabel` / `driverBannerLabel` names are consistent across definition and the implied call sites. `onReturn` is the single callback name everywhere.

**Known assumptions to verify during execution (flagged, not placeholders):**

- Driver test file import of `act` from `@testing-library/react-native` — add if absent (Task 2 Step 1 notes this).
- Exact default-vs-named import style for the driver screen components in `DriverTabsNavigator` — reconcile against the current file before writing (Task 6 Step 2 notes this).
- `Money.fromMajor` / entity factory signatures used in the new test factories mirror the existing driver-home test's `makeAwaitingRide`; if any factory signature differs, copy the exact shape from `useDriverHomeViewModel.test.tsx`.
