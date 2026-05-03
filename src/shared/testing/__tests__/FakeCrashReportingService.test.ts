import { UserId } from '@domain/entities/UserId';
import { NetworkError } from '@domain/errors';

import { FakeCrashReportingService } from '../FakeCrashReportingService';

// Firebase UIDs are exactly 28 chars — the value object enforces that.
function uid(value = 'XnCnxmBPICRK0hfyn557FzodOyt1'): UserId {
  const r = UserId.create(value);
  if (!r.ok) throw r.error;
  return r.value;
}

function netError(code = 'crashlytics_native_unavailable'): NetworkError {
  return new NetworkError({ code, message: 'native module unavailable' });
}

describe('FakeCrashReportingService — defaults', () => {
  it('starts with no recorded state and zero spy counts', () => {
    const svc = new FakeCrashReportingService();
    expect(svc.getCollectionEnabled()).toBeNull();
    expect(svc.getUserId()).toBeNull();
    expect(svc.getAttributes()).toEqual({});
    expect(svc.getRecordedErrors()).toEqual([]);
    expect(svc.getBreadcrumbs()).toEqual([]);
    expect(svc.didCrash()).toBe(false);
    expect(svc.spies.setCollectionEnabledCalls).toBe(0);
    expect(svc.spies.setUserIdCalls).toBe(0);
    expect(svc.spies.setAttributesCalls).toBe(0);
    expect(svc.spies.recordErrorCalls).toBe(0);
    expect(svc.spies.logCalls).toBe(0);
    expect(svc.spies.crashCalls).toBe(0);
  });
});

describe('FakeCrashReportingService — seed helpers', () => {
  it('seedCollectionEnabled sets the initial state', () => {
    const svc = new FakeCrashReportingService();
    svc.seedCollectionEnabled(true);
    expect(svc.getCollectionEnabled()).toBe(true);
  });

  it('seedUserId sets the initial identity', () => {
    const svc = new FakeCrashReportingService();
    const seedUid = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaa'; // 28 a's
    svc.seedUserId(uid(seedUid));
    expect(String(svc.getUserId())).toBe(seedUid);
  });

  it('seedAttributes sets the initial attributes map', () => {
    const svc = new FakeCrashReportingService();
    svc.seedAttributes({ role: 'rider', env: 'stage' });
    expect(svc.getAttributes()).toEqual({ role: 'rider', env: 'stage' });
  });

  it('getAttributes returns a copy — caller mutation does not leak', () => {
    const svc = new FakeCrashReportingService();
    svc.seedAttributes({ role: 'rider' });
    const view = svc.getAttributes() as Record<string, string>;
    view.role = 'driver';
    expect(svc.getAttributes()).toEqual({ role: 'rider' });
  });
});

describe('FakeCrashReportingService — adapter surface', () => {
  it('setCollectionEnabled records the value and bumps the spy', async () => {
    const svc = new FakeCrashReportingService();
    const r = await svc.setCollectionEnabled(true);
    expect(r.ok).toBe(true);
    expect(svc.getCollectionEnabled()).toBe(true);
    expect(svc.spies.setCollectionEnabledCalls).toBe(1);
  });

  it('setUserId records the identity', async () => {
    const svc = new FakeCrashReportingService();
    const r = await svc.setUserId(uid());
    expect(r.ok).toBe(true);
    expect(String(svc.getUserId())).toBe('XnCnxmBPICRK0hfyn557FzodOyt1');
  });

  it('setUserId(null) clears the identity', async () => {
    const svc = new FakeCrashReportingService();
    await svc.setUserId(uid());
    const r = await svc.setUserId(null);
    expect(r.ok).toBe(true);
    expect(svc.getUserId()).toBeNull();
  });

  it('setAttributes merges into the existing map (overwrite semantics)', async () => {
    const svc = new FakeCrashReportingService();
    await svc.setAttributes({ role: 'rider', env: 'dev' });
    await svc.setAttributes({ env: 'stage', region: 'us-east1' });
    expect(svc.getAttributes()).toEqual({
      role: 'rider',
      env: 'stage',
      region: 'us-east1',
    });
  });

  it('recordError appends the error and optional name', async () => {
    const svc = new FakeCrashReportingService();
    const e = new Error('boom');
    await svc.recordError(e, 'GlobalErrorHandler');
    const recorded = svc.getRecordedErrors();
    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.error).toBe(e);
    expect(recorded[0]?.name).toBe('GlobalErrorHandler');
  });

  it('recordError without a name leaves it undefined', async () => {
    const svc = new FakeCrashReportingService();
    await svc.recordError(new Error('x'));
    expect(svc.getRecordedErrors()[0]?.name).toBeUndefined();
  });

  it('log appends the message to the breadcrumb buffer', async () => {
    const svc = new FakeCrashReportingService();
    await svc.log('first');
    await svc.log('second');
    expect(svc.getBreadcrumbs()).toEqual(['first', 'second']);
  });

  it('crash flips didCrash and bumps the spy without throwing', () => {
    const svc = new FakeCrashReportingService();
    expect(() => svc.crash()).not.toThrow();
    expect(svc.didCrash()).toBe(true);
    expect(svc.spies.crashCalls).toBe(1);
  });
});

describe('FakeCrashReportingService — failNext', () => {
  it('makes the next setCollectionEnabled return Result.err one-shot', async () => {
    const svc = new FakeCrashReportingService();
    const err = netError();
    svc.failNext({ method: 'setCollectionEnabled', error: err });
    const first = await svc.setCollectionEnabled(true);
    expect(first.ok).toBe(false);
    if (!first.ok) expect(first.error).toBe(err);
    // Subsequent call behaves normally.
    const second = await svc.setCollectionEnabled(true);
    expect(second.ok).toBe(true);
    expect(svc.getCollectionEnabled()).toBe(true);
  });

  it('makes recordError return Result.err and does NOT append', async () => {
    const svc = new FakeCrashReportingService();
    svc.failNext({ method: 'recordError', error: netError() });
    const r = await svc.recordError(new Error('boom'));
    expect(r.ok).toBe(false);
    expect(svc.getRecordedErrors()).toHaveLength(0);
  });

  it('makes log return Result.err and does NOT append', async () => {
    const svc = new FakeCrashReportingService();
    svc.failNext({ method: 'log', error: netError() });
    const r = await svc.log('msg');
    expect(r.ok).toBe(false);
    expect(svc.getBreadcrumbs()).toHaveLength(0);
  });

  it('failNext does not stack — only one failure per method', async () => {
    const svc = new FakeCrashReportingService();
    svc.failNext({ method: 'setUserId', error: netError() });
    svc.failNext({ method: 'setUserId', error: netError('other') });
    const first = await svc.setUserId(uid());
    expect(first.ok).toBe(false);
    if (!first.ok) {
      // The second failNext call replaced the first — only the most
      // recent error is consumed.
      expect((first.error as NetworkError).code).toBe('other');
    }
    const second = await svc.setUserId(uid());
    expect(second.ok).toBe(true);
  });
});

describe('FakeCrashReportingService — reset', () => {
  it('clears all state and spy counts', async () => {
    const svc = new FakeCrashReportingService();
    await svc.setCollectionEnabled(true);
    await svc.setUserId(uid());
    await svc.setAttributes({ role: 'rider' });
    await svc.recordError(new Error('x'));
    await svc.log('msg');
    svc.crash();
    svc.failNext({ method: 'log', error: netError() });

    svc.reset();

    expect(svc.getCollectionEnabled()).toBeNull();
    expect(svc.getUserId()).toBeNull();
    expect(svc.getAttributes()).toEqual({});
    expect(svc.getRecordedErrors()).toEqual([]);
    expect(svc.getBreadcrumbs()).toEqual([]);
    expect(svc.didCrash()).toBe(false);
    expect(svc.spies.logCalls).toBe(0);
    // Primed failure cleared too.
    const r = await svc.log('after reset');
    expect(r.ok).toBe(true);
  });
});
