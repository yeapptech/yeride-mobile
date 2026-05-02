import { PushToken } from '@domain/entities/PushToken';
import { NetworkError, ValidationError } from '@domain/errors';
import type { NotificationResponse } from '@domain/services';

import { FakePushNotificationService } from '../FakePushNotificationService';

function token(value = 'ExponentPushToken[abc]') {
  const r = PushToken.create(value);
  if (!r.ok) throw r.error;
  return r.value;
}

function makeResponse(
  data: Record<string, unknown> = { type: 'driver_dispatched', tripId: 'r_1' },
): NotificationResponse {
  return {
    title: 'YeRide Update!',
    body: 'Your driver is on the way',
    data,
    receivedAt: new Date('2026-05-01T12:00:00Z'),
  };
}

describe('FakePushNotificationService — defaults', () => {
  it('starts with undetermined permission and null token', async () => {
    const svc = new FakePushNotificationService();
    const status = await svc.getPermissionStatus();
    expect(status.ok).toBe(true);
    if (status.ok) expect(status.value).toBe('undetermined');
    const tok = await svc.getCurrentToken();
    if (tok.ok) expect(tok.value).toBeNull();
  });

  it('starts with no last response and Android channel unconfigured', async () => {
    const svc = new FakePushNotificationService();
    const r = await svc.getLastNotificationResponse();
    if (r.ok) expect(r.value).toBeNull();
    expect(svc.isAndroidChannelConfigured()).toBe(false);
  });
});

describe('FakePushNotificationService — seed helpers', () => {
  it('seedPermission flips both getPermissionStatus and requestPermissions', async () => {
    const svc = new FakePushNotificationService();
    svc.seedPermission('granted');
    const get = await svc.getPermissionStatus();
    const req = await svc.requestPermissions();
    if (get.ok) expect(get.value).toBe('granted');
    if (req.ok) expect(req.value).toBe('granted');
  });

  it('seedToken makes getCurrentToken return the seeded value', async () => {
    const svc = new FakePushNotificationService();
    svc.seedToken(token());
    const r = await svc.getCurrentToken();
    if (r.ok) expect(String(r.value)).toBe('ExponentPushToken[abc]');
  });

  it('setupAndroidChannel flips the configured flag', async () => {
    const svc = new FakePushNotificationService();
    const r = await svc.setupAndroidChannel();
    expect(r.ok).toBe(true);
    expect(svc.isAndroidChannelConfigured()).toBe(true);
  });
});

describe('FakePushNotificationService — emit + subscribe', () => {
  it('emitTokenChange notifies every subscriber and updates current token', async () => {
    const svc = new FakePushNotificationService();
    const seen: Array<PushToken | null> = [];
    const unsub = svc.subscribeToTokenChanges((t) => seen.push(t));
    svc.emitTokenChange(token('ExponentPushToken[fresh]'));
    expect(seen).toHaveLength(1);
    expect(String(seen[0])).toBe('ExponentPushToken[fresh]');
    const r = await svc.getCurrentToken();
    if (r.ok) expect(String(r.value)).toBe('ExponentPushToken[fresh]');
    unsub();
  });

  it('emitNotificationResponse notifies subscribers and seeds lastResponse', async () => {
    const svc = new FakePushNotificationService();
    const seen: NotificationResponse[] = [];
    svc.subscribeToNotificationResponse((r) => seen.push(r));
    const resp = makeResponse();
    svc.emitNotificationResponse(resp);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBe(resp);
    const last = await svc.getLastNotificationResponse();
    if (last.ok) expect(last.value).toBe(resp);
  });

  it('unsubscribe stops further deliveries (synchronous identity)', () => {
    const svc = new FakePushNotificationService();
    const seen: Array<PushToken | null> = [];
    const unsub = svc.subscribeToTokenChanges((t) => seen.push(t));
    svc.emitTokenChange(token('ExponentPushToken[a]'));
    unsub();
    svc.emitTokenChange(token('ExponentPushToken[b]'));
    expect(seen).toHaveLength(1);
    expect(String(seen[0])).toBe('ExponentPushToken[a]');
  });

  it('unsubscribe is a no-op on the second call', () => {
    const svc = new FakePushNotificationService();
    const unsub = svc.subscribeToTokenChanges(() => {});
    unsub();
    unsub();
    expect(svc.spies.tokenUnsubscribeCalls).toBe(1);
  });

  it('multiple subscribers all get the event (broadcast)', () => {
    const svc = new FakePushNotificationService();
    const a: NotificationResponse[] = [];
    const b: NotificationResponse[] = [];
    svc.subscribeToNotificationResponse((r) => a.push(r));
    svc.subscribeToNotificationResponse((r) => b.push(r));
    svc.emitNotificationResponse(makeResponse());
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(svc.getResponseSubscriberCount()).toBe(2);
  });
});

describe('FakePushNotificationService — failNext', () => {
  it('priming a failure makes the next call return Result.err', async () => {
    const svc = new FakePushNotificationService();
    svc.failNext({
      method: 'getCurrentToken',
      error: new NetworkError({
        code: 'push_get_token_failed',
        message: 'simulated transport failure',
      }),
    });
    const r = await svc.getCurrentToken();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('push_get_token_failed');
  });

  it('failNext is one-shot — the second call succeeds', async () => {
    const svc = new FakePushNotificationService();
    svc.seedToken(token());
    svc.failNext({
      method: 'getCurrentToken',
      error: new ValidationError({
        code: 'push_token_invalid_format',
        message: 'bad shape',
      }),
    });
    const first = await svc.getCurrentToken();
    expect(first.ok).toBe(false);
    const second = await svc.getCurrentToken();
    expect(second.ok).toBe(true);
    if (second.ok) expect(String(second.value)).toBe('ExponentPushToken[abc]');
  });
});

describe('FakePushNotificationService — spies', () => {
  it('counts every method invocation', async () => {
    const svc = new FakePushNotificationService();
    await svc.getPermissionStatus();
    await svc.requestPermissions();
    await svc.getCurrentToken();
    await svc.setupAndroidChannel();
    await svc.getLastNotificationResponse();
    expect(svc.spies.getPermissionStatusCalls).toBe(1);
    expect(svc.spies.requestPermissionsCalls).toBe(1);
    expect(svc.spies.getCurrentTokenCalls).toBe(1);
    expect(svc.spies.setupAndroidChannelCalls).toBe(1);
    expect(svc.spies.getLastNotificationResponseCalls).toBe(1);
  });

  it('reset() wipes seed + spy + failure state', async () => {
    const svc = new FakePushNotificationService();
    svc.seedPermission('granted');
    svc.seedToken(token());
    svc.subscribeToTokenChanges(() => {});
    await svc.getPermissionStatus();
    svc.reset();
    expect(svc.spies.getPermissionStatusCalls).toBe(0);
    expect(svc.getTokenSubscriberCount()).toBe(0);
    const status = await svc.getPermissionStatus();
    if (status.ok) expect(status.value).toBe('undetermined');
    const tok = await svc.getCurrentToken();
    if (tok.ok) expect(tok.value).toBeNull();
  });
});
