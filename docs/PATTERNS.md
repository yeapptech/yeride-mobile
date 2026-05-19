# Feature-area patterns

Patterns that are specific to a single feature area and would bloat
`../CLAUDE.md` if kept there. Anything cross-cutting belongs in the
guide; these decay if the area is refactored and should be revisited
during the refactor that breaks them.

## Driver-side specifics

Read before touching `useDriverHomeViewModel`,
`useDriverDispatchViewModel`, `useDriverMonitorViewModel`, or any
driver status view.

- **Driver mode mirror.** `useDriverStatusStore` carries a
  `mode: 'offline' | 'online_idle' | 'dispatched' | 'on_trip'` flag.
  `useDriverMonitorViewModel` mirrors `Ride.status` into this flag
  so DriverHome / the tabs / a future Earnings surface don't have
  to re-derive from the in-progress ride query at every read.
  `cancelled` always maps to `'online_idle'` (driver re-joins the
  queue); `started` / `payment_requested` / `payment_failed` /
  `completed` all map to `'on_trip'`.
- **Client-side `arrivedAtPickup` derivation.** Server status
  `'dispatched'` is split into UI states `'en_route_to_pickup'` and
  `'at_pickup'` via a derived value:
  `useGpsIsInsidePickupGeofence() || manualOverride`. The geofence
  half is event-driven by `useGpsLifecycle`'s pickup-geofence
  registration. The manual override (`onArriveAtPickup` /
  `onBackToEnRoute`) remains as resilience for GPS drift /
  cellular dead zones; once tapped, sticks across a subsequent
  EXIT so a transient drift mid-pickup doesn't bounce the UI back
  to en-route. The override resets when the ride leaves
  `'dispatched'`. There's no server-side `at_pickup` state — UI
  only. Don't reintroduce a stored `useState<boolean>` for
  `arrivedAtPickup` — the OR-derivation is the canonical pattern.
- **Real odometer at start / request-payment.** The VM reads
  `useGpsCurrentOdometer()` (a cheap `useGpsStore` selector hook)
  and passes the value to both `useStartRideMutation` and
  `useRequestPaymentMutation`. Pre-first-delivery default is `0`;
  `Ride.start({odometerMeters: 0})` accepts that. The monotonicity
  check on `Ride.requestPayment` requires
  `odometerMeters >= pickupTiming.odometerMeters`. Don't call
  `bgGeolocation.getOdometer()` at click time — the staleness of
  the store value (≤200m / ~30s old per the SDK's
  `distanceFilter`) is preferred over an `await` on the
  user-facing tap.
- **Terminal-redirect rule.** `useDriverMonitorViewModel` resets
  the stack to `DriverTabs` on `'cancelled'` and `'completed'`.
  `'payment_failed'` intentionally does NOT redirect — the driver
  stays on the failure card and taps "Close trip" themselves. The
  `redirectedRef` ref guards against re-firing across re-renders.
  If you add a new terminal status, decide deliberately whether it
  auto-redirects.
- **Two cancel-sheet variants.** `CancelReasonSheet` is rider-side
  (gated on `isRiderCode`); `DriverCancelReasonSheet` is
  driver-side (gated on `isDriverCode`). They diverge on the
  available code list (`driver_no_show` rider-only;
  `passenger_no_show` driver-only) and on copy.
- **DriverMonitor map polyline rules.** The map keeps a fixed pool
  of always-mounted children (the `<Map/>` component's invariant).
  Drive visibility via props:
  - Green driver→pickup polyline: visible during server status
    `'dispatched'`. Hidden in every other state.
  - Gold pickup→dropoff polyline: visible during `'started'` /
    `'payment_requested'` / `'payment_failed'` / `'completed'`.
    Both pickup and dropoff markers stay mounted across
    late-status transitions so the map doesn't visibly redraw.
- **Navigation SDK init lives in DriverMonitor, not
  DriverNavigation.** The legacy `getCurrentActivity()` returns
  null inside `<NavigationView/>`, so init must run in the parent
  screen before navigating. `useDriverMonitorViewModel.onLaunchNavigation`
  runs the `init → terms-dialog → navigate` chain.
- **Live `tripTracking` write path (Phase 10 turn 5).**
  `useDriverMonitorViewModel` owns the
  `users/{driverId}.location.tripTracking` write while
  `ride.status ∈ {dispatched, started}` — NOT `useGpsLifecycle`,
  which intentionally writes `tripTracking: null` on every GPS
  event. The mapper OMITS `tripTracking` from the doc when the
  entity value is `null`, so `setDoc({merge: true})` from
  `useGpsLifecycle` does not clobber the VM's throttled writes.
  Throttle constants (30s min interval / 50m min movement / 60s
  NavSdk staleness) are copied verbatim from legacy
  `distanceTrackingService.js` — tuning is a post-cutover concern.
  - **One-shot bypass on the nav-less → live edge.** When a
    NavSdk fire arrives AND the last write was nav-less (the
    initial `useGpsLifecycle` write at mount, or a tunnel
    recovery), the 30s gate is skipped so the rider sees a live
    ETA on the first NavSdk callback. Subsequent NavSdk fires
    respect the gate normally — bypass is one-shot per nav-less →
    live edge.
  - **Bypass refire on dispatched → started.** The active-window
    status flip changes the destination (pickup → dropoff) but
    not `isActiveTripStatus`, so neither effect re-runs. A
    separate `activeRideStatus`-keyed effect resets
    `lastWriteAtMsRef` + `lastWriteHadTelemetryRef` (NOT
    `lastWriteCoordsRef`, so a stationary driver doesn't trigger
    a write the instant the status flips) which unblocks the
    existing bypass for the dropoff leg.
  - **Effect deps stay minimal.** The GPS effect reads
    `driverUserId`, `updateLocationMutation`, and `ride` through
    refs — depending on them directly causes the effect to
    re-fire on every render because TanStack's `useMutation`
    returns a fresh wrapper on every state transition. Only
    `[isActiveTripStatus, gpsLocation, gpsSpeed]` belong in the
    dep array.

## Rider-side specifics

Read before touching `useRideMonitorViewModel` or the rider's
status views (`DispatchedView`, `StartedView`).

- **Live ETA reads gate on tripId (Phase 10 turn 5).** Nothing in
  the write path clears
  `users/{driverId}.location.tripTracking` at trip end, so a
  driver's doc can carry the previous ride's tripTracking when
  they're dispatched for a new one. `useRideMonitorViewModel`
  gates `liveDurationSeconds` / `liveDistanceMeters` on
  `String(tripTracking.tripId) === String(ride.id)` so a stale
  tripTracking surfaces as `null` (→ static
  `ride.pickup.directions` fallback). Don't drop the gate even
  after a future "clear tripTracking on trip end" write lands —
  in-flight clear writes can race with the new ride's first
  driver-side write and the rider VM is the simpler place to
  enforce this invariant.
- **Live ETA hooks into existing `SubscribeToUserLocation`.** No
  `ObserveDriverLocation(rideId)` wrapper — the generic use case
  keyed off `ride.driver?.id` is enough because the VM effect's
  cleanup handles the driver-switch race. If you find yourself
  reaching for a wrapper, check whether you actually need a
  domain-level invariant or just a different memoization.

## Vehicle-side specifics

Read before touching `useVehicleListViewModel`,
`useVehicleRegistrationViewModel`, `useVehiclePhotosViewModel`,
`useVehicleDetailsViewModel`, or the DriverHome empty-state branch.

- **Active-vehicle source-of-truth is `useCurrentUserQuery`.** The
  driver's active VIN lives on `user.activeVehicleId`, not on a
  Zustand store. `useDriverStatusStore.activeVehicleId` is a UI
  mirror set by `goOnline(seedId)` and only valid while online —
  do not reach for it to derive list highlights or detail-screen
  `isActive`. After `setActive` / `delete` mutations succeed, the
  queries layer invalidates `user.current` so the next render sees
  the updated pointer.
- **List card tap pushes details, not activate.**
  `DriverVehicleCard` takes `onSelect`. Set-active is reachable
  from `VehicleDetailsScreen` via
  `useVehicleDetailsViewModel.onSetActive`, which gates on
  `vehicle.status === 'approved' && !isActive`.
- **VehiclePhotos per-tile state is split across two stores.**
  Server state (URLs already attached) lives in
  `vehicle.photos[type]` from `useVehicleQuery`; local UI state
  (which tiles are uploading or errored) lives in a
  `useState`-driven `PerTileFlags` map keyed on
  `VehiclePhotoType`. Don't mirror photo URLs into local state —
  the byVin invalidation after a successful upload is the
  canonical mechanism for the idle/uploading → attached
  transition.
- **Per-tile mutation isolation, single hook.**
  `useVehiclePhotosViewModel` fires a single
  `useUploadVehiclePhotosMutation` via `mutateAsync` per tile.
  Five concurrent uploads use the same hook instance; the
  per-tile `inFlight` / `errors` flags carry the lifecycle. Don't
  refactor to one hook per `VehiclePhotoType`.
- **`expo-image-picker` permission gate.**
  `requestMediaLibraryPermissionsAsync` runs before
  `launchImageLibraryAsync` on every tap. Permission denial → tile
  error rather than a silent no-op so the user sees what
  happened. `app.config.ts` carries the iOS permission strings.
- **No active vehicle → no online toggle.**
  `useDriverHomeViewModel` exposes `noActiveVehicle: boolean`
  derived from `user.activeVehicleId === null` (driver-role only).
  `DriverHomeScreen` renders an empty-state prompt with a
  "Register a vehicle" CTA in that branch; the online toggle is
  hidden entirely.
