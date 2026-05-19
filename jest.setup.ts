// Global Jest setup. Mocks for native-only modules (Reanimated, GestureHandler,
// Firebase, Stripe, etc.) live here.
//
// Stripe (Phase 6 turn 3): the SDK ships its own jest mock that returns
// stub implementations for every hook + every `useStripe()` method. Tests
// that need specific behavior override per-test via:
//
//   import { useStripe } from '@stripe/stripe-react-native';
//   (useStripe as jest.Mock).mockReturnValueOnce({
//     confirmSetupIntent: jest.fn().mockResolvedValueOnce({ setupIntent: {...} }),
//   });
//
// Without this global mock, importing `@stripe/stripe-react-native` in a
// view-model test would pull in the SDK's TurboModule registration which
// fails outside a real RN runtime.

jest.mock('@stripe/stripe-react-native', () =>
  require('@stripe/stripe-react-native/jest/mock'),
);

// react-native-maps (Phase 9 turn 1): manual mock lives at
// `<rootDir>/__mocks__/react-native-maps.tsx`. Jest auto-resolves it.
//
// Why a separate file: the package's exports are native view-managers
// (`AIRMap`, `AIRGoogleMap`) that fail to load outside a real RN runtime,
// so we mock unconditionally. But the mock has to render real `<View>`s
// (so `getByTestId` queries against the rendered tree work), and inline
// `jest.mock` factories collide with NativeWind's babel plugin: the
// plugin injects a `_ReactNativeCSSInterop` reference into transformed
// components, and since `jest.mock` factories are hoisted above the
// file-scope binding for that helper, the factory body fails with
// "module factory ... not allowed to reference any out-of-scope variables".
// A manual mock at `__mocks__/react-native-maps.tsx` is a regular module
// (not a hoisted factory), so NativeWind's transform binds correctly.
//
// The mock encodes the relevant props into `testID`s so consumer tests
// can assert on them: `getByTestId('map-view-provider-google')`,
// `getAllByTestId('map-polyline-len-0')`,
// `getAllByTestId('map-marker-opacity-0')`.

// react-native-background-geolocation (Phase 7 turn 1): the SDK's default
// export is the `BackgroundGeolocation` namespace whose methods are
// TurboModule-backed and crash outside a real RN runtime. We provide a
// JS-only stub with three properties:
//
//   1. Every method as a `jest.fn()` — `ready`, `start`, `stop`,
//      `getState`, `addGeofence`, `removeGeofence`, `removeGeofences`,
//      `getOdometer`, `resetOdometer`, `requestPermission`,
//      `removeAllListeners`, plus the on* listener registrars.
//   2. Constants the adapter reads at module-load — `DESIRED_ACCURACY_HIGH`,
//      `LOG_LEVEL_VERBOSE`, `LOG_LEVEL_ERROR`, `AUTHORIZATION_STATUS_*`.
//   3. A `__listeners` registry exposed for tests: `__listeners.location[]`
//      etc. Each `on*()` registration appends a callback to the matching
//      array and returns a `{ remove }` Subscription. Tests fire events
//      with the helpers below.
//
// Per-test usage:
//
//   import BackgroundGeolocation from 'react-native-background-geolocation';
//   const sdk = BackgroundGeolocation as unknown as typeof mockBg;
//   sdk.__emitLocation({ coords: {...}, ... });
//   sdk.__emitGeofence({ identifier: 'pickup', action: 'ENTER', ... });
//
// Tests that need a different `getState` / `getOdometer` return prime via
// `(BackgroundGeolocation.getState as jest.Mock).mockResolvedValueOnce(...)`.

interface MockBgListeners {
  location: Array<(loc: unknown) => void>;
  /**
   * Phase 9 turn 9: the SDK adapter passes a SECOND callback to
   * `onLocation()` to receive numeric error codes (e.g. `1` for
   * permission-denied, `408` for timeout). Adapter L348's flipped
   * `LOG.error` constructs an Error from `errorCode` so the rawMeta
   * channel can fan it out to Crashlytics. To drive that path in
   * tests we capture the error callback here alongside the
   * location callback and expose `__emitLocationError(code)` to fire it.
   */
  locationError: Array<(code: number) => void>;
  geofence: Array<(geo: unknown) => void>;
  geofencesChange: Array<(event: unknown) => void>;
  motionChange: Array<(event: unknown) => void>;
  providerChange: Array<(event: unknown) => void>;
  authorization: Array<(event: unknown) => void>;
}

const mockBgListeners: MockBgListeners = {
  location: [],
  locationError: [],
  geofence: [],
  geofencesChange: [],
  motionChange: [],
  providerChange: [],
  authorization: [],
};

const mockMakeSubscription = (
  bucket: keyof MockBgListeners,
  cb: (e: unknown) => void,
): { remove: () => void } => {
  mockBgListeners[bucket].push(cb);
  return {
    remove: () => {
      const arr = mockBgListeners[bucket];
      const idx = arr.indexOf(cb);
      if (idx >= 0) arr.splice(idx, 1);
    },
  };
};

const mockBg = {
  // Constants
  DESIRED_ACCURACY_HIGH: 0,
  DESIRED_ACCURACY_MEDIUM: 10,
  DESIRED_ACCURACY_LOW: 100,
  LOG_LEVEL_OFF: 0,
  LOG_LEVEL_ERROR: 1,
  LOG_LEVEL_WARNING: 2,
  LOG_LEVEL_INFO: 3,
  LOG_LEVEL_DEBUG: 4,
  LOG_LEVEL_VERBOSE: 5,
  AUTHORIZATION_STATUS_NOT_DETERMINED: 0,
  AUTHORIZATION_STATUS_RESTRICTED: 1,
  AUTHORIZATION_STATUS_DENIED: 2,
  AUTHORIZATION_STATUS_ALWAYS: 3,
  AUTHORIZATION_STATUS_WHEN_IN_USE: 4,

  // Methods. Most return Promises; the listener registrars return Subscription.
  ready: jest.fn().mockResolvedValue({ enabled: false, odometer: 0 }),
  start: jest.fn().mockResolvedValue({ enabled: true }),
  stop: jest.fn().mockResolvedValue({ enabled: false }),
  setConfig: jest.fn().mockResolvedValue({ enabled: false }),
  getState: jest.fn().mockResolvedValue({
    enabled: false,
    odometer: 0,
    didLaunchInBackground: false,
  }),
  getCurrentPosition: jest.fn().mockResolvedValue({}),
  addGeofence: jest.fn().mockResolvedValue(true),
  addGeofences: jest.fn().mockResolvedValue(true),
  removeGeofence: jest.fn().mockResolvedValue(true),
  removeGeofences: jest.fn().mockResolvedValue(true),
  getGeofences: jest.fn().mockResolvedValue([]),
  getOdometer: jest.fn().mockResolvedValue(0),
  resetOdometer: jest.fn().mockResolvedValue({ odometer: 0 }),
  requestPermission: jest
    .fn()
    .mockResolvedValue(3 /* AUTHORIZATION_STATUS_ALWAYS */),
  getProviderState: jest
    .fn()
    .mockResolvedValue({ enabled: true, status: 3, gps: true, network: true }),
  removeListeners: jest.fn().mockResolvedValue(undefined),
  removeAllListeners: jest.fn().mockResolvedValue(undefined),

  // Listener registrars
  onLocation: jest.fn(
    (cb: (loc: unknown) => void, onError?: (code: number) => void) => {
      // Phase 9 turn 9: capture the optional error callback into its
      // own bucket so `__emitLocationError(code)` can drive the SDK
      // error path. The returned `{ remove }` Subscription tears
      // BOTH callbacks out of their respective buckets so a `.remove()`
      // on the location stream doesn't leak the error callback.
      const locationSub = mockMakeSubscription('location', cb);
      if (onError) {
        mockBgListeners.locationError.push(onError);
        return {
          remove: (): void => {
            locationSub.remove();
            const idx = mockBgListeners.locationError.indexOf(onError);
            if (idx >= 0) mockBgListeners.locationError.splice(idx, 1);
          },
        };
      }
      return locationSub;
    },
  ),
  onGeofence: jest.fn((cb: (geo: unknown) => void) =>
    mockMakeSubscription('geofence', cb),
  ),
  onGeofencesChange: jest.fn((cb: (event: unknown) => void) =>
    mockMakeSubscription('geofencesChange', cb),
  ),
  onMotionChange: jest.fn((cb: (event: unknown) => void) =>
    mockMakeSubscription('motionChange', cb),
  ),
  onProviderChange: jest.fn((cb: (event: unknown) => void) =>
    mockMakeSubscription('providerChange', cb),
  ),
  onAuthorization: jest.fn((cb: (event: unknown) => void) =>
    mockMakeSubscription('authorization', cb),
  ),

  // Test-only helpers — namespaced under `__` so they're loud at the call site.
  __listeners: mockBgListeners,
  __emitLocation: (loc: unknown): void => {
    for (const cb of [...mockBgListeners.location]) cb(loc);
  },
  /**
   * Phase 9 turn 9: drive the SDK's `onLocation` error callback. The
   * adapter's L348 site logs at error with a constructed Error
   * carrying the numeric code, so `recordError` fan-out groups by
   * code in Firebase Console.
   */
  __emitLocationError: (code: number): void => {
    for (const cb of [...mockBgListeners.locationError]) cb(code);
  },
  __emitGeofence: (geo: unknown): void => {
    for (const cb of [...mockBgListeners.geofence]) cb(geo);
  },
  __reset: (): void => {
    mockBgListeners.location.length = 0;
    mockBgListeners.locationError.length = 0;
    mockBgListeners.geofence.length = 0;
    mockBgListeners.geofencesChange.length = 0;
    mockBgListeners.motionChange.length = 0;
    mockBgListeners.providerChange.length = 0;
    mockBgListeners.authorization.length = 0;
  },
};

jest.mock('react-native-background-geolocation', () => ({
  __esModule: true,
  default: mockBg,
}));
// Note: `@transistorsoft/background-geolocation-types` (the runtime
// home of `DesiredAccuracy` / `LogLevel` / `AuthorizationStatus` —
// the SDK's `index.d.ts` claims to re-export them but `src/index.js`
// doesn't actually emit them, so the adapter imports from the types
// package directly) is intentionally NOT mocked. Its `dist/index.js`
// is plain CommonJS that loads cleanly in jest's node env, and the
// real enum values match what the runtime delivers — closer-to-prod
// than a hand-rolled mock would be.

// @googlemaps/react-native-navigation-sdk (Phase 8 turn 1): the SDK's
// React-tied surface (`useNavigationController` + `<NavigationView/>` +
// `<NavigationProvider/>`) is TurboModule-backed and crashes outside a
// real RN runtime. We provide a JS-only stub with:
//
//   1. The string-enum constants the adapter reads at module-load:
//      `RouteStatus.*`, `NavigationSessionStatus.*`, `TravelMode.*`,
//      `TaskRemovedBehavior.*`. Match the SDK's actual values exactly
//      (RouteStatus + NavigationSessionStatus are string literals;
//      TravelMode + TaskRemovedBehavior are numeric).
//
//   2. A factory `mockMakeNavigationController()` that returns an object
//      shaped like `NavigationController`. Every method is a `jest.fn()`
//      with a default no-throw resolved value matching the SDK's docs.
//      Tests prime per-call behaviour with `.mockResolvedValueOnce(...)`
//      / `.mockRejectedValueOnce(...)`.
//
//   3. Per-bucket listener registries (arrival + forward-compat
//      routeChanged / trafficUpdated; per Phase 8 turn 1 kickoff
//      decision 5) and `__emitArrival` / `__reset` helpers under the
//      module's named exports. Adapter tests register listeners via the
//      controller's `setOnArrival` (passed in alongside the controller),
//      then drive deliveries with the helpers.
//
//   4. Stubs for the React surfaces (`NavigationProvider`,
//      `NavigationView`, `useNavigationController`) — the rewrite
//      doesn't render any of these in tests this turn (Turn 2 will), but
//      mocking them keeps the module-load surface clean for any future
//      VM test that imports the SDK indirectly.

interface MockNavListeners {
  arrival: Array<(event: unknown) => void>;
  routeChanged: Array<() => void>;
  trafficUpdated: Array<() => void>;
  /**
   * Phase 10 turn 5 — registered `setOnRemainingTimeOrDistanceChanged`
   * callbacks. `__emitTimeAndDistance(event)` fans an event into all
   * registered listeners; setting the SDK slot to `null` clears the
   * list (mirrors how the SDK behaves on listener removal).
   */
  timeAndDistance: Array<(event: unknown) => void>;
}

const mockNavListeners: MockNavListeners = {
  arrival: [],
  routeChanged: [],
  trafficUpdated: [],
  timeAndDistance: [],
};

const mockMakeNavigationController = () => ({
  areTermsAccepted: jest.fn().mockResolvedValue(true),
  showTermsAndConditionsDialog: jest.fn().mockResolvedValue(true),
  resetTermsAccepted: jest.fn().mockResolvedValue(undefined),
  init: jest.fn().mockResolvedValue('ok' /* NavigationSessionStatus.OK */),
  cleanup: jest.fn().mockResolvedValue(undefined),
  getCurrentRouteSegment: jest.fn().mockResolvedValue({}),
  getRouteSegments: jest.fn().mockResolvedValue([]),
  getCurrentTimeAndDistance: jest
    .fn()
    .mockResolvedValue({ meters: 0, seconds: 0, delaySeverity: 0 }),
  getTraveledPath: jest.fn().mockResolvedValue([]),
  getNavSDKVersion: jest.fn().mockResolvedValue('0.14.1-mock'),
  setDestination: jest.fn().mockResolvedValue('OK' /* RouteStatus.OK */),
  setDestinations: jest.fn().mockResolvedValue('OK' /* RouteStatus.OK */),
  continueToNextDestination: jest.fn().mockResolvedValue(undefined),
  clearDestinations: jest.fn().mockResolvedValue(undefined),
  startGuidance: jest.fn().mockResolvedValue(undefined),
  stopGuidance: jest.fn().mockResolvedValue(undefined),
  setAbnormalTerminatingReportingEnabled: jest.fn(),
  setSpeedAlertOptions: jest.fn(),
  setAudioGuidanceType: jest.fn(),
  stopUpdatingLocation: jest.fn(),
  startUpdatingLocation: jest.fn(),
  setBackgroundLocationUpdatesEnabled: jest.fn(),
  setTurnByTurnLoggingEnabled: jest.fn(),
  simulator: {
    simulateLocationsAlongExistingRoute: jest.fn(),
    stopLocationSimulation: jest.fn(),
    resumeLocationSimulation: jest.fn(),
    pauseLocationSimulation: jest.fn(),
    simulateLocation: jest.fn(),
  },
});

const mockMakeListenerSetters = () => ({
  setOnStartGuidance: jest.fn(),
  setOnArrival: jest.fn((cb: ((event: unknown) => void) | null | undefined) => {
    if (cb) {
      mockNavListeners.arrival.push(cb);
    } else {
      mockNavListeners.arrival.length = 0;
    }
  }),
  setOnLocationChanged: jest.fn(),
  setOnRawLocationChanged: jest.fn(),
  setOnNavigationReady: jest.fn(),
  setOnRouteChanged: jest.fn(),
  setOnReroutingRequestedByOffRoute: jest.fn(),
  setOnTrafficUpdated: jest.fn(),
  /**
   * Phase 10 turn 5 — register/clear callbacks the same way
   * `setOnArrival` does so `__emitTimeAndDistance` can fan events
   * into the adapter's internal handler.
   */
  setOnRemainingTimeOrDistanceChanged: jest.fn(
    (cb: ((event: unknown) => void) | null | undefined) => {
      if (cb) {
        mockNavListeners.timeAndDistance.push(cb);
      } else {
        mockNavListeners.timeAndDistance.length = 0;
      }
    },
  ),
  setOnTurnByTurn: jest.fn(),
  setLogDebugInfo: jest.fn(),
});

/**
 * Phase 8 turn 2: the connector hook (`useNavigationSdkConnector`)
 * calls the SDK's `useNavigation()` context hook to read the shared
 * controller minted by `<NavigationProvider/>` at App root. We mock
 * `useNavigation` here so connector / view-model tests don't have to
 * mount a real `<NavigationProvider/>` — they get the same controller
 * + listeners across every render via this module-scope cache.
 *
 * Tests that need a fresh controller (e.g. simulating a re-mount after
 * sign-out) call `sdk.__resetSharedNavigation()` between renders.
 */
let mockSharedNavigation: {
  navigationController: ReturnType<typeof mockMakeNavigationController>;
  removeAllListeners: jest.Mock;
} & ReturnType<typeof mockMakeListenerSetters> = (() => {
  const controller = mockMakeNavigationController();
  const listeners = mockMakeListenerSetters();
  return {
    navigationController: controller,
    removeAllListeners: jest.fn(() => {
      mockNavListeners.arrival.length = 0;
      mockNavListeners.routeChanged.length = 0;
      mockNavListeners.trafficUpdated.length = 0;
      mockNavListeners.timeAndDistance.length = 0;
    }),
    ...listeners,
  };
})();

const resetMockSharedNavigation = (): void => {
  const controller = mockMakeNavigationController();
  const listeners = mockMakeListenerSetters();
  mockSharedNavigation = {
    navigationController: controller,
    removeAllListeners: jest.fn(() => {
      mockNavListeners.arrival.length = 0;
      mockNavListeners.routeChanged.length = 0;
      mockNavListeners.trafficUpdated.length = 0;
      mockNavListeners.timeAndDistance.length = 0;
    }),
    ...listeners,
  };
};

jest.mock('@googlemaps/react-native-navigation-sdk', () => {
  // SDK enum values — kept verbatim because the real adapter compares
  // via `RouteStatus.OK` etc. and would never match if these drifted.
  const RouteStatus = {
    OK: 'OK',
    NO_ROUTE_FOUND: 'NO_ROUTE_FOUND',
    NETWORK_ERROR: 'NETWORK_ERROR',
    QUOTA_CHECK_FAILED: 'QUOTA_CHECK_FAILED',
    ROUTE_CANCELED: 'ROUTE_CANCELED',
    LOCATION_DISABLED: 'LOCATION_DISABLED',
    LOCATION_UNKNOWN: 'LOCATION_UNKNOWN',
    WAYPOINT_ERROR: 'WAYPOINT_ERROR',
    INVALID_PLACE_ID: 'INVALID_PLACE_ID',
    DUPLICATE_WAYPOINTS_ERROR: 'DUPLICATE_WAYPOINTS_ERROR',
    UNKNOWN: 'UNKNOWN',
  };

  const NavigationSessionStatus = {
    OK: 'ok',
    NOT_AUTHORIZED: 'notAuthorized',
    TERMS_NOT_ACCEPTED: 'termsNotAccepted',
    NETWORK_ERROR: 'networkError',
    LOCATION_PERMISSION_MISSING: 'locationPermissionMissing',
    UNKNOWN_ERROR: 'unknownError',
  };

  const TravelMode = {
    DRIVING: 0,
    CYCLING: 1,
    WALKING: 2,
    TWO_WHEELER: 3,
    TAXI: 4,
  };

  const TaskRemovedBehavior = {
    CONTINUE_SERVICE: 0,
    QUIT_SERVICE: 1,
  };

  return {
    __esModule: true,

    // Enums consumed at module-load.
    RouteStatus,
    NavigationSessionStatus,
    TravelMode,
    TaskRemovedBehavior,

    // React surfaces — stubbed so any future test that pulls them in
    // doesn't fail at import time.
    NavigationProvider: ({ children }: { children: unknown }): unknown =>
      children,
    NavigationView: () => null,
    useNavigationController: jest.fn(() => ({
      navigationController: mockMakeNavigationController(),
      ...mockMakeListenerSetters(),
      removeAllListeners: jest.fn(() => {
        mockNavListeners.arrival.length = 0;
        mockNavListeners.routeChanged.length = 0;
        mockNavListeners.trafficUpdated.length = 0;
      }),
    })),

    /**
     * Context-hook stand-in for `<NavigationProvider/>`. Returns the
     * shared mock instance so consumers across the same render tree
     * see the same controller. Phase 8 turn 2 — consumed by
     * `useNavigationSdkConnector`.
     */
    useNavigation: jest.fn(() => mockSharedNavigation),

    // Test-only constructors / helpers — namespaced under `__` so
    // they're loud at the call site. Tests get a fresh controller +
    // listeners pair via:
    //
    //   const sdk = require('@googlemaps/react-native-navigation-sdk');
    //   const controller = sdk.__makeController();
    //   const listeners = sdk.__makeListeners();
    //   client.setController({controller, listeners});
    //   sdk.__emitArrival({waypoint: {...}, isFinalDestination: true});
    __makeController: mockMakeNavigationController,
    __makeListeners: mockMakeListenerSetters,
    __listeners: mockNavListeners,
    __emitArrival: (event: unknown): void => {
      for (const cb of [...mockNavListeners.arrival]) cb(event);
    },
    /**
     * Phase 10 turn 5 — fan an SDK-shaped `TimeAndDistance` event
     * into every registered `setOnRemainingTimeOrDistanceChanged`
     * callback. Tests pass the SDK shape (`{meters, seconds,
     * delaySeverity?}`); the adapter's internal handler does the
     * domain translation.
     */
    __emitTimeAndDistance: (event: unknown): void => {
      for (const cb of [...mockNavListeners.timeAndDistance]) cb(event);
    },
    /**
     * Read the shared `useNavigation()` return value — the same
     * controller + listeners pair the connector hook will see. Tests
     * use this to assert reference identity across re-renders, OR to
     * spy on per-method invocations on the controller.
     */
    __getSharedNavigation: (): unknown => mockSharedNavigation,
    /**
     * Construct a fresh shared controller + listeners pair. Use
     * between tests when the connector's mount-push / unmount-clear
     * lifecycle needs a clean slate.
     */
    __resetSharedNavigation: resetMockSharedNavigation,
    __reset: (): void => {
      mockNavListeners.arrival.length = 0;
      mockNavListeners.routeChanged.length = 0;
      mockNavListeners.trafficUpdated.length = 0;
      mockNavListeners.timeAndDistance.length = 0;
      resetMockSharedNavigation();
    },
  };
});

// expo-notifications (Phase 9 turn 2 sub-turn 2b): the SDK's native
// methods (`getExpoPushTokenAsync`, `requestPermissionsAsync`,
// `addNotificationResponseReceivedListener`, etc.) are TurboModule-backed
// and crash outside a real RN runtime. We provide a JS-only stub with:
//
//   1. The constants the adapter reads at module-load:
//      `AndroidImportance.MAX`, `PermissionStatus.GRANTED`, etc.
//
//   2. Async methods (`getPermissionsAsync`, `requestPermissionsAsync`,
//      `getExpoPushTokenAsync`, `getLastNotificationResponseAsync`,
//      `setNotificationChannelAsync`) as `jest.fn()`s with happy-path
//      defaults. Tests prime per-call behaviour with
//      `.mockResolvedValueOnce(...)` / `.mockRejectedValueOnce(...)`.
//
//   3. Listener registrars (`addPushTokenListener`,
//      `addNotificationResponseReceivedListener`) that store the callback
//      in a per-bucket registry and return a `{ remove }` Subscription.
//      `__emitTokenChange` / `__emitResponse` test helpers fan events to
//      every registered callback.
//
// Per-test usage (loud-namespaced helpers):
//
//   import * as Notifications from 'expo-notifications';
//   const sdk = Notifications as unknown as typeof mockNotifications;
//   sdk.__emitResponse({ notification: { request: { content: { ... } } } });
//   sdk.__reset();

interface MockNotificationsListeners {
  pushToken: Array<(event: { data: string; type: string }) => void>;
  notificationResponse: Array<(event: unknown) => void>;
  notification: Array<(event: unknown) => void>;
}

const mockNotificationsListeners: MockNotificationsListeners = {
  pushToken: [],
  notificationResponse: [],
  notification: [],
};

const mockMakeNotificationsSubscription = (
  bucket: keyof MockNotificationsListeners,
  cb: unknown,
): { remove: () => void } => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (mockNotificationsListeners[bucket] as Array<any>).push(cb as never);
  return {
    remove: () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const arr = mockNotificationsListeners[bucket] as Array<any>;
      const idx = arr.indexOf(cb);
      if (idx >= 0) arr.splice(idx, 1);
    },
  };
};

const mockNotifications = {
  // Permission + Android-channel constants the adapter reads at module-load.
  AndroidImportance: {
    UNKNOWN: 0,
    NONE: 1,
    MIN: 2,
    LOW: 3,
    DEFAULT: 4,
    HIGH: 5,
    MAX: 5,
  },
  PermissionStatus: {
    GRANTED: 'granted',
    DENIED: 'denied',
    UNDETERMINED: 'undetermined',
  },
  AndroidNotificationVisibility: {
    UNKNOWN: 0,
    PUBLIC: 1,
    PRIVATE: 0,
    SECRET: -1,
  },

  // Async methods. Defaults are happy-path; tests override per-call.
  getPermissionsAsync: jest.fn().mockResolvedValue({
    status: 'undetermined',
    granted: false,
    canAskAgain: true,
    expires: 'never',
  }),
  requestPermissionsAsync: jest.fn().mockResolvedValue({
    status: 'granted',
    granted: true,
    canAskAgain: false,
    expires: 'never',
  }),
  getExpoPushTokenAsync: jest.fn().mockResolvedValue({
    data: 'ExponentPushToken[mockTok123]',
    type: 'expo',
  }),
  getDevicePushTokenAsync: jest.fn().mockResolvedValue({
    data: 'mockDeviceTok',
    type: 'fcm',
  }),
  setNotificationChannelAsync: jest.fn().mockResolvedValue({
    id: 'default',
    name: 'default',
  }),
  getLastNotificationResponseAsync: jest.fn().mockResolvedValue(null),
  setNotificationHandler: jest.fn(),

  // Listener registrars. Return Subscription with .remove().
  addPushTokenListener: jest.fn(
    (cb: (event: { data: string; type: string }) => void) =>
      mockMakeNotificationsSubscription('pushToken', cb),
  ),
  addNotificationResponseReceivedListener: jest.fn(
    (cb: (event: unknown) => void) =>
      mockMakeNotificationsSubscription('notificationResponse', cb),
  ),
  addNotificationReceivedListener: jest.fn((cb: (event: unknown) => void) =>
    mockMakeNotificationsSubscription('notification', cb),
  ),
  removeNotificationSubscription: jest.fn(),

  // Test-only helpers — namespaced under `__` so they're loud at the call site.
  __listeners: mockNotificationsListeners,
  __emitTokenChange: (event: { data: string; type: string }): void => {
    for (const cb of [...mockNotificationsListeners.pushToken]) cb(event);
  },
  __emitResponse: (event: unknown): void => {
    for (const cb of [...mockNotificationsListeners.notificationResponse])
      cb(event);
  },
  __emitNotification: (event: unknown): void => {
    for (const cb of [...mockNotificationsListeners.notification]) cb(event);
  },
  __reset: (): void => {
    mockNotificationsListeners.pushToken.length = 0;
    mockNotificationsListeners.notificationResponse.length = 0;
    mockNotificationsListeners.notification.length = 0;
  },
};

jest.mock('expo-notifications', () => mockNotifications);

// @react-native-firebase/crashlytics (Phase 9 turn 3 / migrated to modular
// API in Phase 9 turn 14): the SDK ships both shapes in v24, but the
// namespaced default export (`crashlytics()`) fires runtime deprecation
// warnings on every call and is slated for removal in v25. The rewrite
// uses the modular API exclusively — `getCrashlytics()` returns a
// `Crashlytics` instance, and per-method functions
// (`setCrashlyticsCollectionEnabled(c, enabled)`,
// `setUserId(c, uid)`, `setAttributes(c, attrs)`,
// `recordError(c, err, name?)`, `log(c, msg)`, `crash(c)`) take that
// instance as the first argument.
//
// The mock memoizes a single `mockCrashlyticsInstance` and exposes BOTH
// surfaces: the modular named functions (each delegating to a per-method
// jest.fn() on the singleton, so the existing `c.setUserId.mock` assertion
// shape still works) AND the legacy default export (kept for any
// downstream consumer that hasn't migrated). The methods are
// TurboModule-backed in real builds and crash outside an RN runtime, so
// every export here is a `jest.fn()` — including `crash()`, which is a
// no-op in tests so the dev "Force crash" suite can assert it fired
// without taking the Jest worker down.
//
// Per-test usage (modular):
//
//   import { getCrashlytics } from '@react-native-firebase/crashlytics';
//   const c = getCrashlytics();
//   (c.recordError as jest.Mock).mockClear();
//   // ...exercise code...
//   expect(c.recordError).toHaveBeenCalledWith(expect.any(Error), 'Foo');
//
// To simulate `getCrashlytics()` itself throwing (native module missing,
// app not configured), per-test override:
//
//   import { getCrashlytics } from '@react-native-firebase/crashlytics';
//   (getCrashlytics as jest.Mock).mockImplementationOnce(() => {
//     throw new Error('native module not found');
//   });

interface MockCrashlyticsModule {
  isCrashlyticsCollectionEnabled: boolean;
  log: jest.Mock;
  recordError: jest.Mock;
  setUserId: jest.Mock;
  setAttribute: jest.Mock;
  setAttributes: jest.Mock;
  setCrashlyticsCollectionEnabled: jest.Mock;
  crash: jest.Mock;
  checkForUnsentReports: jest.Mock;
  deleteUnsentReports: jest.Mock;
  didCrashOnPreviousExecution: jest.Mock;
  sendUnsentReports: jest.Mock;
}

const mockCrashlyticsInstance: MockCrashlyticsModule = {
  isCrashlyticsCollectionEnabled: true,
  log: jest.fn(),
  recordError: jest.fn(),
  setUserId: jest.fn().mockResolvedValue(null),
  setAttribute: jest.fn().mockResolvedValue(null),
  setAttributes: jest.fn().mockResolvedValue(null),
  setCrashlyticsCollectionEnabled: jest.fn().mockResolvedValue(null),
  crash: jest.fn(),
  checkForUnsentReports: jest.fn().mockResolvedValue(false),
  deleteUnsentReports: jest.fn().mockResolvedValue(undefined),
  didCrashOnPreviousExecution: jest.fn().mockResolvedValue(false),
  sendUnsentReports: jest.fn(),
};

jest.mock('@react-native-firebase/crashlytics', () => ({
  __esModule: true,
  // Legacy namespaced default export — preserved for backward compat.
  default: jest.fn(() => mockCrashlyticsInstance),
  // Modular API (Phase 9 turn 14). Each function delegates to the
  // singleton's per-method jest.fn() so `expect(sdk.setUserId)
  // .toHaveBeenCalledWith(...)` keeps working in adapter tests.
  getCrashlytics: jest.fn(() => mockCrashlyticsInstance),
  setCrashlyticsCollectionEnabled: jest.fn(
    (c: MockCrashlyticsModule, enabled: boolean) =>
      c.setCrashlyticsCollectionEnabled(enabled),
  ),
  setUserId: jest.fn((c: MockCrashlyticsModule, uid: string) =>
    c.setUserId(uid),
  ),
  setAttribute: jest.fn(
    (c: MockCrashlyticsModule, name: string, value: string) =>
      c.setAttribute(name, value),
  ),
  setAttributes: jest.fn(
    (c: MockCrashlyticsModule, attrs: Record<string, string>) =>
      c.setAttributes(attrs),
  ),
  recordError: jest.fn(
    (c: MockCrashlyticsModule, error: Error, name?: string) =>
      c.recordError(error, name),
  ),
  log: jest.fn((c: MockCrashlyticsModule, message: string) => c.log(message)),
  crash: jest.fn((c: MockCrashlyticsModule) => c.crash()),
  checkForUnsentReports: jest.fn((c: MockCrashlyticsModule) =>
    c.checkForUnsentReports(),
  ),
  deleteUnsentReports: jest.fn((c: MockCrashlyticsModule) =>
    c.deleteUnsentReports(),
  ),
  didCrashOnPreviousExecution: jest.fn((c: MockCrashlyticsModule) =>
    c.didCrashOnPreviousExecution(),
  ),
  sendUnsentReports: jest.fn((c: MockCrashlyticsModule) =>
    c.sendUnsentReports(),
  ),
}));

// expo-print + expo-sharing + expo-file-system (Phase 9 turn 16):
// the SDKs' native methods (`printToFileAsync`, `shareAsync`,
// `new File(uri).delete()`) are TurboModule-backed and crash outside
// a real RN runtime. We mock all three at the module boundary so the
// receipt-PDF VM tests can prime per-call behaviour with the canonical
// Jest patterns.
//
// Per-test usage:
//
//   import * as Print from 'expo-print';
//   (Print.printToFileAsync as jest.Mock).mockResolvedValueOnce({
//     uri: 'file:///tmp/receipt.pdf',
//   });
//   import * as Sharing from 'expo-sharing';
//   (Sharing.isAvailableAsync as jest.Mock).mockResolvedValueOnce(false);
//
// `expo-file-system` exports a `File` class whose constructor is
// invoked with the PDF uri and whose `.delete()` method is called for
// best-effort cleanup. The mock holds a per-instance `delete()` jest.fn
// so tests can assert via:
//
//   import { File } from 'expo-file-system';
//   const f = new File('file:///tmp/receipt.pdf');
//   expect(f.delete).toHaveBeenCalled();
//
// Or assert against the constructor itself with `(File as jest.Mock)`.

jest.mock('expo-print', () => ({
  __esModule: true,
  printAsync: jest.fn().mockResolvedValue(undefined),
  printToFileAsync: jest.fn().mockResolvedValue({
    uri: 'file:///tmp/mock-receipt.pdf',
    numberOfPages: 1,
  }),
  selectPrinterAsync: jest
    .fn()
    .mockResolvedValue({ name: 'Mock Printer', url: 'mock://printer' }),
  Orientation: { portrait: 'portrait', landscape: 'landscape' },
}));

jest.mock('expo-sharing', () => ({
  __esModule: true,
  isAvailableAsync: jest.fn().mockResolvedValue(true),
  shareAsync: jest.fn().mockResolvedValue(undefined),
  getSharedPayloads: jest.fn(() => []),
  getResolvedSharedPayloads: jest.fn().mockResolvedValue([]),
  clearSharedPayloads: jest.fn(),
  useIncomingShare: jest.fn(() => null),
}));

jest.mock('expo-file-system', () => {
  // Per-File instance jest.fn() for `.delete()` so individual tests
  // can assert "the temp PDF was cleaned up". A module-level jest.fn
  // wouldn't work because each new File() should yield an independent
  // delete spy.
  const File = jest.fn().mockImplementation(function (
    this: { uri: string; delete: jest.Mock },
    ...uris: unknown[]
  ) {
    this.uri = String(uris[uris.length - 1] ?? '');
    this.delete = jest.fn();
  });
  const Directory = jest.fn();
  const Paths = {
    cache: { uri: 'file:///mock-cache/' },
    document: { uri: 'file:///mock-document/' },
    bundle: { uri: 'file:///mock-bundle/' },
  };
  return {
    __esModule: true,
    File,
    Directory,
    Paths,
  };
});

// react-native-svg (Phase 9 turn 13): manual mock lives at
// `<rootDir>/__mocks__/react-native-svg.tsx`. Jest auto-resolves it.
//
// Why a separate file: same NativeWind / babel hoisting issue as the
// react-native-maps mock — `jest.mock` factories are hoisted above
// all file-scope bindings, including NativeWind's auto-injected
// `_ReactNativeCSSInterop` helper, so the factory body fails with
// "module factory ... not allowed to reference any out-of-scope
// variables" the moment it touches `View` from `react-native`. A
// manual mock at `__mocks__/react-native-svg.tsx` is a regular module
// (not a hoisted factory), so NativeWind's transform binds correctly.
//
// Every SVG primitive (Svg / Path / Rect / Circle / G / etc.) is
// exported as a `jest.fn()` passthrough that renders its `children`
// inside a `<View/>`. Tests can assert on reference identity:
// `expect(Svg).toHaveBeenCalled()` etc.

export {};
