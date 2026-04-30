/**
 * @jest-environment node
 */
import { Coordinates } from '@domain/entities/Coordinates';
import { AuthorizationError, NetworkError } from '@domain/errors';

import {
  FakeNavigationSdkClient,
  type NavArrivalEvent,
  type NavSetDestinationsArgs,
} from '../FakeNavigationSdkClient';

const validCoords = (): Coordinates => {
  const r = Coordinates.create(40.7128, -74.006);
  if (!r.ok) throw new Error('test setup: bad coords');
  return r.value;
};

const arrivalEvent = (
  overrides: Partial<NavArrivalEvent> = {},
): NavArrivalEvent => ({
  title: 'Pickup',
  coords: validCoords(),
  placeId: null,
  isFinalDestination: true,
  timestampMs: Date.now(),
  ...overrides,
});

const sampleSetDestinationsArgs: NavSetDestinationsArgs = {
  waypoints: [{ coords: validCoords(), title: 'Pickup' }],
};

describe('FakeNavigationSdkClient', () => {
  describe('seed helpers', () => {
    it('seedTermsAccepted controls the next showTermsAndConditionsDialog return', async () => {
      const fake = new FakeNavigationSdkClient();
      fake.seedTermsAccepted(false);
      const result = await fake.showTermsAndConditionsDialog();
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.accepted).toBe(false);
    });

    it('seedRouteStatus controls the next setDestinations return', async () => {
      const fake = new FakeNavigationSdkClient();
      fake.seedRouteStatus('no_route_found');
      const result = await fake.setDestinations(sampleSetDestinationsArgs);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toBe('no_route_found');
      // No active destinations on a non-OK status.
      expect(fake.getActiveDestinations()).toBeNull();
    });

    it('default route status ok stores active destinations', async () => {
      const fake = new FakeNavigationSdkClient();
      const result = await fake.setDestinations(sampleSetDestinationsArgs);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toBe('ok');
      expect(fake.getActiveDestinations()).toEqual(sampleSetDestinationsArgs);
    });
  });

  describe('failNext', () => {
    it('primes a one-shot Result.err for the next matching call', async () => {
      const fake = new FakeNavigationSdkClient();
      const error = new NetworkError({
        code: 'navigation_init_failed',
        message: 'boom',
      });
      fake.failNext({ method: 'init', error });
      const first = await fake.init();
      const second = await fake.init();
      expect(first.ok).toBe(false);
      if (!first.ok) expect(first.error.code).toBe('navigation_init_failed');
      expect(second.ok).toBe(true);
    });

    it('failNext on cleanup still tears down in-memory state', async () => {
      const fake = new FakeNavigationSdkClient();
      // Get into a "guiding" state with subscribers + active destinations.
      await fake.startGuidance();
      fake.subscribeToArrival(jest.fn());
      await fake.setDestinations(sampleSetDestinationsArgs);
      expect(fake.isGuiding()).toBe(true);
      expect(fake.getArrivalSubscriberCount()).toBe(1);
      expect(fake.getActiveDestinations()).not.toBeNull();

      fake.failNext({
        method: 'cleanup',
        error: new NetworkError({
          code: 'navigation_cleanup_failed',
          message: 'fail',
        }),
      });
      const result = await fake.cleanup();
      expect(result.ok).toBe(false);
      // Even on failure, fake mirrors the real adapter's
      // best-effort-cleanup behaviour.
      expect(fake.isGuiding()).toBe(false);
      expect(fake.getArrivalSubscriberCount()).toBe(0);
      expect(fake.getActiveDestinations()).toBeNull();
    });

    it('AuthorizationError is allowed for init failNext (matches NavInitError union)', async () => {
      const fake = new FakeNavigationSdkClient();
      fake.failNext({
        method: 'init',
        error: new AuthorizationError({
          code: 'navigation_terms_not_accepted',
          message: 'no',
        }),
      });
      const result = await fake.init();
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('navigation_terms_not_accepted');
      }
    });
  });

  describe('emitArrival + dedup', () => {
    it('fans events to every registered subscriber', () => {
      const fake = new FakeNavigationSdkClient();
      const a = jest.fn();
      const b = jest.fn();
      fake.subscribeToArrival(a);
      fake.subscribeToArrival(b);
      fake.emitArrival(arrivalEvent());
      expect(a).toHaveBeenCalledTimes(1);
      expect(b).toHaveBeenCalledTimes(1);
    });

    it('dedupes consecutive identical fires (waypointKey, isFinal)', () => {
      const fake = new FakeNavigationSdkClient();
      const cb = jest.fn();
      fake.subscribeToArrival(cb);
      const evt = arrivalEvent();
      fake.emitMultiFireArrival(evt, 3);
      expect(cb).toHaveBeenCalledTimes(1);
    });

    it('treats different waypoints as distinct events', () => {
      const fake = new FakeNavigationSdkClient();
      const cb = jest.fn();
      fake.subscribeToArrival(cb);
      fake.emitArrival(arrivalEvent({ placeId: 'place-A' }));
      fake.emitArrival(arrivalEvent({ placeId: 'place-B' }));
      expect(cb).toHaveBeenCalledTimes(2);
    });

    it('disposer removes the subscriber and zeroes the subscriber count', () => {
      const fake = new FakeNavigationSdkClient();
      const cb = jest.fn();
      const dispose = fake.subscribeToArrival(cb);
      dispose();
      fake.emitArrival(arrivalEvent());
      expect(cb).not.toHaveBeenCalled();
      expect(fake.getArrivalSubscriberCount()).toBe(0);
    });
  });

  describe('spies', () => {
    it('records call counts + args', async () => {
      const fake = new FakeNavigationSdkClient();
      await fake.init();
      await fake.showTermsAndConditionsDialog();
      await fake.setDestinations(sampleSetDestinationsArgs);
      await fake.startGuidance();
      await fake.stopGuidance();
      const dispose = fake.subscribeToArrival(jest.fn());
      dispose();
      await fake.cleanup();

      expect(fake.spies.initCalls).toBe(1);
      expect(fake.spies.showTermsCalls).toBe(1);
      expect(fake.spies.setDestinationsCalls).toEqual([
        sampleSetDestinationsArgs,
      ]);
      expect(fake.spies.startGuidanceCalls).toBe(1);
      expect(fake.spies.stopGuidanceCalls).toBe(1);
      expect(fake.spies.cleanupCalls).toBe(1);
      expect(fake.spies.subscribeArrivalCalls).toBe(1);
      expect(fake.spies.arrivalDisposes).toBe(1);
    });
  });

  describe('reset', () => {
    it('wipes seed + spy + subscriber state', async () => {
      const fake = new FakeNavigationSdkClient();
      fake.seedTermsAccepted(false);
      fake.seedRouteStatus('network_error');
      fake.subscribeToArrival(jest.fn());
      await fake.startGuidance();
      await fake.setDestinations(sampleSetDestinationsArgs);
      await fake.init();

      fake.reset();

      expect(fake.spies.initCalls).toBe(0);
      expect(fake.spies.startGuidanceCalls).toBe(0);
      expect(fake.spies.subscribeArrivalCalls).toBe(0);
      expect(fake.isGuiding()).toBe(false);
      expect(fake.isInitialized()).toBe(false);
      expect(fake.getActiveDestinations()).toBeNull();
      expect(fake.getArrivalSubscriberCount()).toBe(0);

      // Defaults restored: showTerms now returns accepted=true again,
      // setDestinations returns 'ok'.
      const terms = await fake.showTermsAndConditionsDialog();
      const dest = await fake.setDestinations(sampleSetDestinationsArgs);
      expect(terms.ok && terms.value.accepted).toBe(true);
      expect(dest.ok && dest.value).toBe('ok');
    });
  });

  describe('introspection helpers', () => {
    it('isInitialized flips on successful init', async () => {
      const fake = new FakeNavigationSdkClient();
      expect(fake.isInitialized()).toBe(false);
      await fake.init();
      expect(fake.isInitialized()).toBe(true);
    });

    it('isGuiding tracks startGuidance / stopGuidance / cleanup', async () => {
      const fake = new FakeNavigationSdkClient();
      expect(fake.isGuiding()).toBe(false);
      await fake.startGuidance();
      expect(fake.isGuiding()).toBe(true);
      await fake.stopGuidance();
      expect(fake.isGuiding()).toBe(false);
      await fake.startGuidance();
      await fake.cleanup();
      expect(fake.isGuiding()).toBe(false);
    });
  });
});
