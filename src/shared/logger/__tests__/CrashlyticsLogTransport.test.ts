import { NetworkError } from '@domain/errors';
import { FakeCrashReportingService } from '@shared/testing';

import { CrashlyticsLogTransport } from '../CrashlyticsLogTransport';

/**
 * Helper to flush microtasks — the transport's `log()` is sync but the
 * underlying `crashReporting.log()` / `recordError()` calls are async
 * and dispatched via `void`. Awaiting a microtask drains the queue so
 * the fake's call records are populated before the assertion.
 */
const flushMicrotasks = () => Promise.resolve();

describe('CrashlyticsLogTransport — breadcrumb fan-out (every level)', () => {
  it('formats and forwards every log level to crashReporting.log()', async () => {
    const fake = new FakeCrashReportingService();
    const transport = new CrashlyticsLogTransport(fake);
    transport.log('debug', 'YeRide', 'd-msg');
    transport.log('info', 'YeRide:Module', 'i-msg');
    transport.log('warn', 'GPS', 'w-msg');
    transport.log('error', 'RIDE', 'e-msg');
    await flushMicrotasks();
    expect(fake.getBreadcrumbs()).toEqual([
      '[YeRide] d-msg',
      '[YeRide:Module] i-msg',
      '[GPS] w-msg',
      '[RIDE] e-msg',
    ]);
  });

  it('uses the logger scope as the breadcrumb prefix', async () => {
    const fake = new FakeCrashReportingService();
    const transport = new CrashlyticsLogTransport(fake);
    transport.log('info', 'Container', 'using FakeCrashReporting');
    await flushMicrotasks();
    const [b] = fake.getBreadcrumbs();
    expect(b).toBe('[Container] using FakeCrashReporting');
  });
});

describe('CrashlyticsLogTransport — recordError trigger (error level only)', () => {
  it('fires recordError when meta is an Error and level is error', async () => {
    const fake = new FakeCrashReportingService();
    const transport = new CrashlyticsLogTransport(fake);
    const err = new Error('something broke');
    transport.log('error', 'RIDE', 'dispatch failed', err);
    await flushMicrotasks();
    expect(fake.getRecordedErrors()).toHaveLength(1);
    const recorded = fake.getRecordedErrors()[0];
    expect(recorded?.error).toBe(err);
    expect(recorded?.name).toBe('RIDE');
  });

  it('fires recordError when meta is an object with an `error` field', async () => {
    const fake = new FakeCrashReportingService();
    const transport = new CrashlyticsLogTransport(fake);
    const err = new Error('inner boom');
    transport.log('error', 'GPS', 'subscribe failed', {
      error: err,
      context: 'extra',
    });
    await flushMicrotasks();
    expect(fake.getRecordedErrors()).toHaveLength(1);
    expect(fake.getRecordedErrors()[0]?.error).toBe(err);
  });

  it('does NOT fire recordError when level is not error (warn / info / debug)', async () => {
    const fake = new FakeCrashReportingService();
    const transport = new CrashlyticsLogTransport(fake);
    const err = new Error('boom');
    transport.log('warn', 'RIDE', 'should-not-record', err);
    transport.log('info', 'RIDE', 'should-not-record', err);
    transport.log('debug', 'RIDE', 'should-not-record', err);
    await flushMicrotasks();
    expect(fake.getRecordedErrors()).toHaveLength(0);
    // Breadcrumbs DO accumulate at every level.
    expect(fake.getBreadcrumbs()).toHaveLength(3);
  });

  it('does NOT fire recordError when meta is a plain object with no Error', async () => {
    const fake = new FakeCrashReportingService();
    const transport = new CrashlyticsLogTransport(fake);
    transport.log('error', 'RIDE', 'fare calc rejected', {
      code: 'invalid_fare',
      message: 'fare too low',
    });
    await flushMicrotasks();
    expect(fake.getRecordedErrors()).toHaveLength(0);
    // Breadcrumb still lands.
    expect(fake.getBreadcrumbs()).toEqual(['[RIDE] fare calc rejected']);
  });

  it('does NOT fire recordError when meta is undefined', async () => {
    const fake = new FakeCrashReportingService();
    const transport = new CrashlyticsLogTransport(fake);
    transport.log('error', 'RIDE', 'no meta here');
    await flushMicrotasks();
    expect(fake.getRecordedErrors()).toHaveLength(0);
    expect(fake.getBreadcrumbs()).toEqual(['[RIDE] no meta here']);
  });
});

describe('CrashlyticsLogTransport — failure isolation', () => {
  it('a recordError rejection does NOT throw out of log()', async () => {
    const fake = new FakeCrashReportingService();
    fake.failNext({
      method: 'recordError',
      error: new NetworkError({
        code: 'crashlytics_record_error_failed',
        message: 'native missing',
      }),
    });
    const transport = new CrashlyticsLogTransport(fake);
    expect(() =>
      transport.log('error', 'RIDE', 'still ok', new Error('boom')),
    ).not.toThrow();
    await flushMicrotasks();
    // Breadcrumb still went through (different method, not primed to fail).
    expect(fake.getBreadcrumbs()).toEqual(['[RIDE] still ok']);
  });

  it('a log rejection does NOT throw out of log()', async () => {
    const fake = new FakeCrashReportingService();
    fake.failNext({
      method: 'log',
      error: new NetworkError({
        code: 'crashlytics_log_failed',
        message: 'native missing',
      }),
    });
    const transport = new CrashlyticsLogTransport(fake);
    expect(() => transport.log('info', 'RIDE', 'still ok')).not.toThrow();
    await flushMicrotasks();
    // The log call was primed to fail — fake records nothing.
    expect(fake.getBreadcrumbs()).toHaveLength(0);
  });
});
