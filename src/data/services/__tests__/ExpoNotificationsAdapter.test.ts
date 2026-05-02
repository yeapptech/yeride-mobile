import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import type { NotificationResponse } from '@domain/services';

import { ExpoNotificationsAdapter } from '../ExpoNotificationsAdapter';

// Re-cast the SDK module to the global mock's __* test helpers.
interface MockNotifications {
  __emitTokenChange: (event: { data: string; type: string }) => void;
  __emitResponse: (event: unknown) => void;
  __reset: () => void;
}

const sdk = Notifications as unknown as typeof Notifications &
  MockNotifications;

// Reset the SDK mock between tests so per-test mockResolvedValueOnce
// priming and listener registries don't leak.
beforeEach(() => {
  jest.clearAllMocks();
  sdk.__reset();
  // Default permission and token return-values; tests override per-call
  // via `.mockResolvedValueOnce(...)`.
  (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({
    status: 'undetermined',
    granted: false,
    canAskAgain: true,
    expires: 'never',
  });
  (Notifications.requestPermissionsAsync as jest.Mock).mockResolvedValue({
    status: 'granted',
    granted: true,
    canAskAgain: false,
    expires: 'never',
  });
  (Notifications.getExpoPushTokenAsync as jest.Mock).mockResolvedValue({
    data: 'ExponentPushToken[mockTok123]',
    type: 'expo',
  });
  (
    Notifications.getLastNotificationResponseAsync as jest.Mock
  ).mockResolvedValue(null);
});

// Seed `Constants.expoConfig.extra.eas.projectId` so `getCurrentToken`
// doesn't bail with `push_no_eas_project_id`. The adapter reads this
// via `require('expo-constants').default.expoConfig.extra.eas.projectId`.
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: {
      extra: {
        eas: { projectId: 'test-project-id' },
      },
    },
  },
}));

describe('ExpoNotificationsAdapter — getPermissionStatus', () => {
  it("maps SDK 'granted' to domain 'granted'", async () => {
    (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValueOnce({
      status: 'granted',
      granted: true,
      canAskAgain: false,
      expires: 'never',
    });
    const adapter = new ExpoNotificationsAdapter();
    const r = await adapter.getPermissionStatus();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe('granted');
  });

  it("maps SDK 'denied' to domain 'denied'", async () => {
    (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValueOnce({
      status: 'denied',
      granted: false,
      canAskAgain: false,
      expires: 'never',
    });
    const adapter = new ExpoNotificationsAdapter();
    const r = await adapter.getPermissionStatus();
    if (r.ok) expect(r.value).toBe('denied');
  });

  it("collapses iOS 'provisional' into domain 'granted'", async () => {
    (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValueOnce({
      status: 'provisional',
      granted: true,
      canAskAgain: false,
      expires: 'never',
    });
    const adapter = new ExpoNotificationsAdapter();
    const r = await adapter.getPermissionStatus();
    if (r.ok) expect(r.value).toBe('granted');
  });

  it('maps SDK throw to AuthorizationError', async () => {
    (Notifications.getPermissionsAsync as jest.Mock).mockRejectedValueOnce(
      new Error('SDK unavailable'),
    );
    const adapter = new ExpoNotificationsAdapter();
    const r = await adapter.getPermissionStatus();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('push_get_permission_failed');
  });
});

describe('ExpoNotificationsAdapter — requestPermissions', () => {
  it('passes through the SDK status', async () => {
    (Notifications.requestPermissionsAsync as jest.Mock).mockResolvedValueOnce({
      status: 'denied',
      granted: false,
      canAskAgain: false,
      expires: 'never',
    });
    const adapter = new ExpoNotificationsAdapter();
    const r = await adapter.requestPermissions();
    if (r.ok) expect(r.value).toBe('denied');
  });

  it('passes iOS permission options to the SDK', async () => {
    const adapter = new ExpoNotificationsAdapter();
    await adapter.requestPermissions();
    expect(Notifications.requestPermissionsAsync).toHaveBeenCalledWith({
      ios: {
        allowAlert: true,
        allowBadge: true,
        allowSound: true,
      },
    });
  });

  it('maps SDK throw to AuthorizationError', async () => {
    (Notifications.requestPermissionsAsync as jest.Mock).mockRejectedValueOnce(
      new Error('user dismissed'),
    );
    const adapter = new ExpoNotificationsAdapter();
    const r = await adapter.requestPermissions();
    if (!r.ok) expect(r.error.code).toBe('push_request_permission_failed');
  });
});

describe('ExpoNotificationsAdapter — getCurrentToken', () => {
  it('returns the wrapped Expo token when SDK resolves', async () => {
    const adapter = new ExpoNotificationsAdapter();
    const r = await adapter.getCurrentToken();
    expect(r.ok).toBe(true);
    if (r.ok && r.value !== null) {
      expect(String(r.value)).toBe('ExponentPushToken[mockTok123]');
    }
  });

  it('forwards the projectId from Constants.expoConfig.extra.eas', async () => {
    const adapter = new ExpoNotificationsAdapter();
    await adapter.getCurrentToken();
    expect(Notifications.getExpoPushTokenAsync).toHaveBeenCalledWith({
      projectId: 'test-project-id',
    });
  });

  it('maps SDK throw to NetworkError (push_get_token_failed)', async () => {
    (Notifications.getExpoPushTokenAsync as jest.Mock).mockRejectedValueOnce(
      new Error('no APNs registration'),
    );
    const adapter = new ExpoNotificationsAdapter();
    const r = await adapter.getCurrentToken();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('push_get_token_failed');
  });

  it('maps malformed token string to ValidationError', async () => {
    (Notifications.getExpoPushTokenAsync as jest.Mock).mockResolvedValueOnce({
      data: 'has space inside',
      type: 'expo',
    });
    const adapter = new ExpoNotificationsAdapter();
    const r = await adapter.getCurrentToken();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('push_token_invalid_format');
  });
});

describe('ExpoNotificationsAdapter — subscribeToTokenChanges', () => {
  it('fires the callback when the SDK emits a token change', () => {
    const adapter = new ExpoNotificationsAdapter();
    const seen: Array<string | null> = [];
    adapter.subscribeToTokenChanges((t) =>
      seen.push(t === null ? null : String(t)),
    );
    sdk.__emitTokenChange({ data: 'ExponentPushToken[fresh]', type: 'expo' });
    expect(seen).toEqual(['ExponentPushToken[fresh]']);
  });

  it('dedups consecutive identical token deliveries', () => {
    const adapter = new ExpoNotificationsAdapter();
    const seen: Array<string | null> = [];
    adapter.subscribeToTokenChanges((t) =>
      seen.push(t === null ? null : String(t)),
    );
    sdk.__emitTokenChange({ data: 'ExponentPushToken[a]', type: 'expo' });
    sdk.__emitTokenChange({ data: 'ExponentPushToken[a]', type: 'expo' });
    sdk.__emitTokenChange({ data: 'ExponentPushToken[b]', type: 'expo' });
    expect(seen).toEqual(['ExponentPushToken[a]', 'ExponentPushToken[b]']);
  });

  it('emits null when the SDK delivers a malformed token', () => {
    const adapter = new ExpoNotificationsAdapter();
    const seen: Array<string | null> = [];
    adapter.subscribeToTokenChanges((t) =>
      seen.push(t === null ? null : String(t)),
    );
    sdk.__emitTokenChange({ data: 'has space inside', type: 'expo' });
    expect(seen).toEqual([null]);
  });

  it('synchronous unsubscribe stops further deliveries', () => {
    const adapter = new ExpoNotificationsAdapter();
    const seen: Array<string | null> = [];
    const unsub = adapter.subscribeToTokenChanges((t) =>
      seen.push(t === null ? null : String(t)),
    );
    sdk.__emitTokenChange({ data: 'ExponentPushToken[a]', type: 'expo' });
    unsub();
    sdk.__emitTokenChange({ data: 'ExponentPushToken[b]', type: 'expo' });
    expect(seen).toEqual(['ExponentPushToken[a]']);
  });

  it('shares one underlying SDK subscription across multiple domain subscribers', () => {
    const adapter = new ExpoNotificationsAdapter();
    adapter.subscribeToTokenChanges(() => {});
    adapter.subscribeToTokenChanges(() => {});
    adapter.subscribeToTokenChanges(() => {});
    // Only one call to the SDK regardless of how many domain subscribers.
    expect(
      (Notifications.addPushTokenListener as jest.Mock).mock.calls.length,
    ).toBe(1);
  });
});

describe('ExpoNotificationsAdapter — subscribeToNotificationResponse', () => {
  it('normalizes the SDK response shape and fans into subscribers', () => {
    const adapter = new ExpoNotificationsAdapter();
    const seen: NotificationResponse[] = [];
    adapter.subscribeToNotificationResponse((r) => seen.push(r));
    const fixedDateMs = 1746115200000;
    sdk.__emitResponse({
      notification: {
        date: fixedDateMs,
        request: {
          content: {
            title: 'YeRide Update!',
            body: 'Your driver is on the way',
            data: { type: 'driver_dispatched', tripId: 'r_1' },
          },
        },
      },
      actionIdentifier: 'expo.modules.notifications.actions.DEFAULT',
    });
    expect(seen).toHaveLength(1);
    const r = seen[0]!;
    expect(r.title).toBe('YeRide Update!');
    expect(r.body).toBe('Your driver is on the way');
    expect(r.data).toEqual({ type: 'driver_dispatched', tripId: 'r_1' });
    expect(r.receivedAt.getTime()).toBe(fixedDateMs);
  });

  it('survives a malformed SDK response (missing nested fields)', () => {
    const adapter = new ExpoNotificationsAdapter();
    const seen: NotificationResponse[] = [];
    adapter.subscribeToNotificationResponse((r) => seen.push(r));
    sdk.__emitResponse({}); // No notification.request.content at all.
    expect(seen).toHaveLength(1);
    expect(seen[0]?.title).toBeNull();
    expect(seen[0]?.body).toBeNull();
    expect(seen[0]?.data).toEqual({});
  });

  it('synchronous unsubscribe stops further deliveries', () => {
    const adapter = new ExpoNotificationsAdapter();
    const seen: NotificationResponse[] = [];
    const unsub = adapter.subscribeToNotificationResponse((r) => seen.push(r));
    sdk.__emitResponse({
      notification: { request: { content: { title: 'first' } } },
    });
    unsub();
    sdk.__emitResponse({
      notification: { request: { content: { title: 'second' } } },
    });
    expect(seen.map((r) => r.title)).toEqual(['first']);
  });
});

describe('ExpoNotificationsAdapter — getLastNotificationResponse', () => {
  it('returns null when SDK has no buffered response', async () => {
    const adapter = new ExpoNotificationsAdapter();
    const r = await adapter.getLastNotificationResponse();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBeNull();
  });

  it('normalizes a buffered response (cold-start tap)', async () => {
    (
      Notifications.getLastNotificationResponseAsync as jest.Mock
    ).mockResolvedValueOnce({
      notification: {
        date: 1746115200000,
        request: {
          content: {
            title: 'You received a tip!',
            body: 'Ada Lovelace left you a $5 tip',
            data: { type: 'tip_succeeded', tripId: 'r_1', tipAmount: '5.00' },
          },
        },
      },
      actionIdentifier: 'expo.modules.notifications.actions.DEFAULT',
    });
    const adapter = new ExpoNotificationsAdapter();
    const r = await adapter.getLastNotificationResponse();
    expect(r.ok).toBe(true);
    if (r.ok && r.value !== null) {
      expect(r.value.title).toBe('You received a tip!');
      expect(r.value.data['type']).toBe('tip_succeeded');
    }
  });

  it('maps SDK throw to NetworkError', async () => {
    (
      Notifications.getLastNotificationResponseAsync as jest.Mock
    ).mockRejectedValueOnce(new Error('whatever'));
    const adapter = new ExpoNotificationsAdapter();
    const r = await adapter.getLastNotificationResponse();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('push_get_last_response_failed');
  });
});

describe('ExpoNotificationsAdapter — setupAndroidChannel', () => {
  const originalOS = Platform.OS;

  afterEach(() => {
    Object.defineProperty(Platform, 'OS', {
      configurable: true,
      get: () => originalOS,
    });
  });

  function setPlatform(os: 'ios' | 'android') {
    Object.defineProperty(Platform, 'OS', {
      configurable: true,
      get: () => os,
    });
  }

  it('no-ops on iOS', async () => {
    setPlatform('ios');
    const adapter = new ExpoNotificationsAdapter();
    const r = await adapter.setupAndroidChannel();
    expect(r.ok).toBe(true);
    expect(Notifications.setNotificationChannelAsync).not.toHaveBeenCalled();
  });

  it("registers a 'default' channel with MAX importance on Android", async () => {
    setPlatform('android');
    const adapter = new ExpoNotificationsAdapter();
    const r = await adapter.setupAndroidChannel();
    expect(r.ok).toBe(true);
    expect(Notifications.setNotificationChannelAsync).toHaveBeenCalledWith(
      'default',
      expect.objectContaining({
        name: 'YeRide Notifications',
        importance: Notifications.AndroidImportance.MAX,
      }),
    );
  });

  it('maps SDK throw to NetworkError on Android', async () => {
    setPlatform('android');
    (
      Notifications.setNotificationChannelAsync as jest.Mock
    ).mockRejectedValueOnce(new Error('channel registration failed'));
    const adapter = new ExpoNotificationsAdapter();
    const r = await adapter.setupAndroidChannel();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('push_channel_setup_failed');
  });
});
