import crashlytics from '@react-native-firebase/crashlytics';

import { UserId } from '@domain/entities/UserId';

import {
  FirebaseCrashlyticsAdapter,
  __resetCrashlyticsInstanceForTests,
} from '../FirebaseCrashlyticsAdapter';

const TEST_UID = 'XnCnxmBPICRK0hfyn557FzodOyt1';

function uid(value = TEST_UID): UserId {
  const r = UserId.create(value);
  if (!r.ok) throw r.error;
  return r.value;
}

/**
 * The global jest.setup mock memoizes a single singleton; calling
 * `crashlytics()` returns the same object every time. We grab it once
 * here and re-use across tests.
 */
const crashlyticsMock = crashlytics as unknown as jest.Mock;
const sdk = crashlytics() as unknown as {
  log: jest.Mock;
  recordError: jest.Mock;
  setUserId: jest.Mock;
  setAttributes: jest.Mock;
  setCrashlyticsCollectionEnabled: jest.Mock;
  crash: jest.Mock;
};

describe('FirebaseCrashlyticsAdapter — happy path', () => {
  beforeEach(() => {
    __resetCrashlyticsInstanceForTests();
    crashlyticsMock.mockClear();
    sdk.log.mockReset();
    sdk.recordError.mockReset();
    sdk.setUserId.mockReset().mockResolvedValue(null);
    sdk.setAttributes.mockReset().mockResolvedValue(null);
    sdk.setCrashlyticsCollectionEnabled.mockReset().mockResolvedValue(null);
    sdk.crash.mockReset();
  });

  it('setCollectionEnabled(true) routes to setCrashlyticsCollectionEnabled', async () => {
    const adapter = new FirebaseCrashlyticsAdapter();
    const r = await adapter.setCollectionEnabled(true);
    expect(r.ok).toBe(true);
    expect(sdk.setCrashlyticsCollectionEnabled).toHaveBeenCalledTimes(1);
    expect(sdk.setCrashlyticsCollectionEnabled).toHaveBeenCalledWith(true);
  });

  it('setCollectionEnabled(false) forwards the boolean', async () => {
    const adapter = new FirebaseCrashlyticsAdapter();
    const r = await adapter.setCollectionEnabled(false);
    expect(r.ok).toBe(true);
    expect(sdk.setCrashlyticsCollectionEnabled).toHaveBeenCalledWith(false);
  });

  it('setUserId(UserId) stringifies the brand and forwards to the SDK', async () => {
    const adapter = new FirebaseCrashlyticsAdapter();
    const r = await adapter.setUserId(uid());
    expect(r.ok).toBe(true);
    expect(sdk.setUserId).toHaveBeenCalledWith(TEST_UID);
  });

  it('setUserId(null) sends an empty string to clear identity (legacy parity)', async () => {
    const adapter = new FirebaseCrashlyticsAdapter();
    const r = await adapter.setUserId(null);
    expect(r.ok).toBe(true);
    expect(sdk.setUserId).toHaveBeenCalledWith('');
  });

  it('setAttributes forwards the record verbatim', async () => {
    const adapter = new FirebaseCrashlyticsAdapter();
    const r = await adapter.setAttributes({ role: 'rider', env: 'stage' });
    expect(r.ok).toBe(true);
    expect(sdk.setAttributes).toHaveBeenCalledWith({
      role: 'rider',
      env: 'stage',
    });
  });

  it('recordError with a name forwards both args', async () => {
    const adapter = new FirebaseCrashlyticsAdapter();
    const e = new Error('boom');
    const r = await adapter.recordError(e, 'GlobalErrorHandler');
    expect(r.ok).toBe(true);
    expect(sdk.recordError).toHaveBeenCalledWith(e, 'GlobalErrorHandler');
  });

  it('recordError without a name forwards just the error', async () => {
    const adapter = new FirebaseCrashlyticsAdapter();
    const e = new Error('boom');
    const r = await adapter.recordError(e);
    expect(r.ok).toBe(true);
    expect(sdk.recordError).toHaveBeenCalledWith(e, undefined);
  });

  it('log forwards the message', async () => {
    const adapter = new FirebaseCrashlyticsAdapter();
    const r = await adapter.log('breadcrumb');
    expect(r.ok).toBe(true);
    expect(sdk.log).toHaveBeenCalledWith('breadcrumb');
  });

  it('crash invokes the SDK synchronously', () => {
    const adapter = new FirebaseCrashlyticsAdapter();
    adapter.crash();
    expect(sdk.crash).toHaveBeenCalledTimes(1);
  });
});

describe('FirebaseCrashlyticsAdapter — failure mapping', () => {
  beforeEach(() => {
    __resetCrashlyticsInstanceForTests();
    crashlyticsMock.mockClear();
    sdk.log.mockReset();
    sdk.recordError.mockReset();
    sdk.setUserId.mockReset().mockResolvedValue(null);
    sdk.setAttributes.mockReset().mockResolvedValue(null);
    sdk.setCrashlyticsCollectionEnabled.mockReset().mockResolvedValue(null);
    sdk.crash.mockReset();
  });

  it('setCollectionEnabled rejection becomes Result.err with mapped code', async () => {
    sdk.setCrashlyticsCollectionEnabled.mockRejectedValueOnce(
      new Error('native boom'),
    );
    const adapter = new FirebaseCrashlyticsAdapter();
    const r = await adapter.setCollectionEnabled(true);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('crashlytics_set_collection_enabled_failed');
      expect(r.error.message).toBe('native boom');
    }
  });

  it('setUserId rejection becomes Result.err with mapped code', async () => {
    sdk.setUserId.mockRejectedValueOnce(new Error('uid rejected'));
    const adapter = new FirebaseCrashlyticsAdapter();
    const r = await adapter.setUserId(uid());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('crashlytics_set_user_id_failed');
  });

  it('setAttributes rejection becomes Result.err with mapped code', async () => {
    sdk.setAttributes.mockRejectedValueOnce(new Error('attrs rejected'));
    const adapter = new FirebaseCrashlyticsAdapter();
    const r = await adapter.setAttributes({ k: 'v' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('crashlytics_set_attributes_failed');
  });

  it('recordError sync throw becomes Result.err with mapped code', async () => {
    sdk.recordError.mockImplementationOnce(() => {
      throw new Error('record threw');
    });
    const adapter = new FirebaseCrashlyticsAdapter();
    const r = await adapter.recordError(new Error('original'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('crashlytics_record_error_failed');
  });

  it('log sync throw becomes Result.err with mapped code', async () => {
    sdk.log.mockImplementationOnce(() => {
      throw new Error('log threw');
    });
    const adapter = new FirebaseCrashlyticsAdapter();
    const r = await adapter.log('x');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('crashlytics_log_failed');
  });
});

describe('FirebaseCrashlyticsAdapter — native unavailable', () => {
  /**
   * Simulate the case where `crashlytics()` itself throws on the first
   * call (native module missing, app not initialized). The adapter
   * caches `null` and every subsequent method on the same adapter
   * instance returns Result.err with `crashlytics_native_unavailable`.
   */
  beforeEach(() => {
    __resetCrashlyticsInstanceForTests();
    crashlyticsMock.mockImplementationOnce(() => {
      throw new Error('native module not found');
    });
  });

  it('setCollectionEnabled returns native_unavailable when crashlytics() throws', async () => {
    const adapter = new FirebaseCrashlyticsAdapter();
    const r = await adapter.setCollectionEnabled(true);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('crashlytics_native_unavailable');
  });

  it('subsequent calls on same adapter ALSO return native_unavailable (cache sticks)', async () => {
    const adapter = new FirebaseCrashlyticsAdapter();
    const r1 = await adapter.setUserId(uid());
    const r2 = await adapter.log('x');
    expect(r1.ok).toBe(false);
    expect(r2.ok).toBe(false);
    if (!r1.ok) expect(r1.error.code).toBe('crashlytics_native_unavailable');
    if (!r2.ok) expect(r2.error.code).toBe('crashlytics_native_unavailable');
  });

  it('crash() throws when the SDK is unavailable (synchronous fallback)', () => {
    const adapter = new FirebaseCrashlyticsAdapter();
    expect(() => adapter.crash()).toThrow(
      /crashlytics_native_unavailable.*forced crash/,
    );
  });
});
