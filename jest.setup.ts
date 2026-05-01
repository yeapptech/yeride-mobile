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
  geofence: Array<(geo: unknown) => void>;
  geofencesChange: Array<(event: unknown) => void>;
  motionChange: Array<(event: unknown) => void>;
  providerChange: Array<(event: unknown) => void>;
  authorization: Array<(event: unknown) => void>;
}

const mockBgListeners: MockBgListeners = {
  location: [],
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
    (cb: (loc: unknown) => void, _onError?: (code: number) => void) =>
      mockMakeSubscription('location', cb),
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
  __emitGeofence: (geo: unknown): void => {
    for (const cb of [...mockBgListeners.geofence]) cb(geo);
  },
  __reset: (): void => {
    mockBgListeners.location.length = 0;
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
}

const mockNavListeners: MockNavListeners = {
  arrival: [],
  routeChanged: [],
  trafficUpdated: [],
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
  setOnRemainingTimeOrDistanceChanged: jest.fn(),
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
      resetMockSharedNavigation();
    },
  };
});

export {};
