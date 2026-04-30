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

export {};
