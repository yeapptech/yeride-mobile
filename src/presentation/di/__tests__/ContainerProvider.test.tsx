/**
 * @jest-environment node
 */
import { render } from '@testing-library/react-native';
import { Text } from 'react-native';

import { useCrashReporting } from '@presentation/di';
import { LOG } from '@shared/logger';
import {
  FakeCrashReportingService,
  TestContainerProvider,
} from '@shared/testing';

/**
 * Phase 9 turn 3 sub-turn 3b — verify `<ContainerProvider/>` attaches a
 * `CrashlyticsLogTransport` to the singleton `LOG` on mount and detaches
 * it on unmount. Tested via the breadcrumb buffer on the
 * `FakeCrashReportingService`: a `LOG.error(...)` while mounted should
 * produce a breadcrumb (and a recorded error when meta carries an
 * Error); after unmount, subsequent log calls must NOT reach the fake.
 *
 * The fake instance flows through TestContainerProvider →
 * ContainerProvider, which is the same path the real provider uses.
 */

function Probe() {
  // Touch the hook to make sure the provider is wired correctly. The
  // assertion is on the side effect (transport attachment), not the
  // returned value.
  useCrashReporting();
  return <Text>ok</Text>;
}

describe('ContainerProvider — CrashlyticsLogTransport runtime attachment', () => {
  it('routes LOG.* breadcrumbs into the injected fake while mounted', () => {
    const fake = new FakeCrashReportingService();
    const view = render(
      <TestContainerProvider crashReporting={fake}>
        <Probe />
      </TestContainerProvider>,
    );

    // Use `info` so the assertion proves the breadcrumb fan-out path
    // works without depending on the Error-sanitization behavior of
    // the logger pipeline (sanitizeForLogging rewrites Error meta to
    // a plain object before the transport sees it; recordError fan-
    // out path is exercised in the transport's own unit tests via
    // direct `transport.log(...)` calls).
    LOG.extend('ContainerTest').info('attached transport delivery');

    expect(fake.getBreadcrumbs()).toEqual([
      '[YeRide:ContainerTest] attached transport delivery',
    ]);

    view.unmount();
  });

  it('detaches the transport on unmount so subsequent logs do not reach the fake', () => {
    const fake = new FakeCrashReportingService();
    const { unmount } = render(
      <TestContainerProvider crashReporting={fake}>
        <Probe />
      </TestContainerProvider>,
    );

    // Pre-unmount: transport is attached.
    LOG.extend('ContainerTest').info('pre-unmount');
    expect(fake.getBreadcrumbs()).toEqual([
      '[YeRide:ContainerTest] pre-unmount',
    ]);

    unmount();

    // Post-unmount: subsequent calls must not reach the fake.
    LOG.extend('ContainerTest').info('post-unmount-info');
    LOG.extend('ContainerTest').warn('post-unmount-warn');
    expect(fake.getBreadcrumbs()).toEqual([
      '[YeRide:ContainerTest] pre-unmount',
    ]);
  });

  it('attaches a fresh transport per mount when re-mounting', () => {
    const fake1 = new FakeCrashReportingService();
    const view1 = render(
      <TestContainerProvider crashReporting={fake1}>
        <Probe />
      </TestContainerProvider>,
    );
    LOG.extend('Remount').info('first');
    expect(fake1.getBreadcrumbs()).toEqual(['[YeRide:Remount] first']);
    view1.unmount();

    // Second mount with a different fake — only the second fake should
    // see subsequent log calls.
    const fake2 = new FakeCrashReportingService();
    const view2 = render(
      <TestContainerProvider crashReporting={fake2}>
        <Probe />
      </TestContainerProvider>,
    );
    LOG.extend('Remount').info('second');

    expect(fake1.getBreadcrumbs()).toEqual(['[YeRide:Remount] first']);
    expect(fake2.getBreadcrumbs()).toEqual(['[YeRide:Remount] second']);

    view2.unmount();
  });
});
