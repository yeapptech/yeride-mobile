/**
 * @jest-environment node
 */
import { Coordinates } from '@domain/entities/Coordinates';
import { CrashlyticsLogTransport, LOG } from '@shared/logger';
import { FakeCrashReportingService } from '@shared/testing';

import {
  NavigationSdkClient,
  type NavArrivalEvent,
  type NavigationListenerSetters,
} from '../NavigationSdkClient';

/**
 * Type cast for the global SDK mock from jest.setup.ts. The mock exposes
 * `__makeController()` / `__makeListeners()` / `__emitArrival` / `__reset`
 * test helpers under the named exports.
 */
interface NavMock {
  RouteStatus: Record<string, string>;
  NavigationSessionStatus: Record<string, string>;
  TravelMode: Record<string, number>;
  __makeController: () => MockController;
  __makeListeners: () => MockListeners;
  __emitArrival: (event: unknown) => void;
  __reset: () => void;
}

interface MockController {
  init: jest.Mock;
  showTermsAndConditionsDialog: jest.Mock;
  setDestinations: jest.Mock;
  startGuidance: jest.Mock;
  stopGuidance: jest.Mock;
  cleanup: jest.Mock;
}

interface MockListeners {
  setOnArrival: jest.Mock;
}

// Pull the mocked module from `jest.setup.ts`. Using `require()` here
// (NOT `jest.requireActual`) routes through the global `jest.mock()`
// registration, which is exactly what we want — the real SDK module's
// TurboModule init crashes outside an RN runtime; the mock exposes
// `__makeController` / `__makeListeners` / `__emitArrival` / `__reset`
// for adapter tests.
const sdk = require('@googlemaps/react-native-navigation-sdk') as NavMock;

const validCoords = (): Coordinates => {
  const r = Coordinates.create(40.7128, -74.006);
  if (!r.ok) throw new Error('test setup: bad coords');
  return r.value;
};

const sampleArrivalEvent = (
  overrides: Partial<{ title: string; isFinal: boolean; placeId: string }> = {},
): unknown => ({
  waypoint: {
    title: overrides.title ?? 'Pickup',
    placeId: overrides.placeId,
    position: { lat: 40.7128, lng: -74.006 },
  },
  isFinalDestination: overrides.isFinal ?? true,
});

beforeEach(() => {
  sdk.__reset();
});

describe('NavigationSdkClient', () => {
  describe('without a connected controller', () => {
    it('init returns NetworkError code navigation_sdk_not_connected', async () => {
      const client = new NavigationSdkClient();
      const result = await client.init();
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('navigation_sdk_not_connected');
      }
    });

    it('setDestinations / startGuidance / showTerms also return navigation_sdk_not_connected', async () => {
      const client = new NavigationSdkClient();
      const dest = await client.setDestinations({
        waypoints: [{ coords: validCoords(), title: 'Pickup' }],
      });
      const start = await client.startGuidance();
      const terms = await client.showTermsAndConditionsDialog();
      for (const r of [dest, start, terms]) {
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error.code).toBe('navigation_sdk_not_connected');
      }
    });

    it('stopGuidance is tolerant — no controller resolves Ok (cleanup-path-friendly)', async () => {
      const client = new NavigationSdkClient();
      const result = await client.stopGuidance();
      expect(result.ok).toBe(true);
    });

    it('cleanup with no controller is idempotent — Ok', async () => {
      const client = new NavigationSdkClient();
      const result = await client.cleanup();
      expect(result.ok).toBe(true);
    });
  });

  describe('init', () => {
    it("maps SDK status 'ok' to Result.ok(true)", async () => {
      const client = new NavigationSdkClient();
      const controller = sdk.__makeController();
      const listeners = sdk.__makeListeners();
      controller.init.mockResolvedValueOnce(sdk.NavigationSessionStatus['OK']);
      client.setController({
        controller: controller as unknown as Parameters<
          NavigationSdkClient['setController']
        >[0]['controller'],
        listeners: listeners as unknown as NavigationListenerSetters,
      });
      const result = await client.init();
      expect(result.ok).toBe(true);
    });

    it("maps SDK status 'termsNotAccepted' to AuthorizationError", async () => {
      const client = new NavigationSdkClient();
      const controller = sdk.__makeController();
      controller.init.mockResolvedValueOnce(
        sdk.NavigationSessionStatus['TERMS_NOT_ACCEPTED'],
      );
      client.setController({
        controller: controller as unknown as Parameters<
          NavigationSdkClient['setController']
        >[0]['controller'],
        listeners:
          sdk.__makeListeners() as unknown as NavigationListenerSetters,
      });
      const result = await client.init();
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('navigation_terms_not_accepted');
      }
    });

    it("maps SDK status 'notAuthorized' to AuthorizationError", async () => {
      const client = new NavigationSdkClient();
      const controller = sdk.__makeController();
      controller.init.mockResolvedValueOnce(
        sdk.NavigationSessionStatus['NOT_AUTHORIZED'],
      );
      client.setController({
        controller: controller as unknown as Parameters<
          NavigationSdkClient['setController']
        >[0]['controller'],
        listeners:
          sdk.__makeListeners() as unknown as NavigationListenerSetters,
      });
      const result = await client.init();
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('navigation_api_not_authorized');
      }
    });

    it('returns NetworkError when controller.init() throws', async () => {
      const client = new NavigationSdkClient();
      const controller = sdk.__makeController();
      controller.init.mockRejectedValueOnce(new Error('SDK exploded'));
      client.setController({
        controller: controller as unknown as Parameters<
          NavigationSdkClient['setController']
        >[0]['controller'],
        listeners:
          sdk.__makeListeners() as unknown as NavigationListenerSetters,
      });
      const result = await client.init();
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('navigation_init_failed');
    });
  });

  describe('showTermsAndConditionsDialog', () => {
    it('returns Result.ok({accepted: true}) on accept', async () => {
      const client = new NavigationSdkClient();
      const controller = sdk.__makeController();
      controller.showTermsAndConditionsDialog.mockResolvedValueOnce(true);
      client.setController({
        controller: controller as unknown as Parameters<
          NavigationSdkClient['setController']
        >[0]['controller'],
        listeners:
          sdk.__makeListeners() as unknown as NavigationListenerSetters,
      });
      const result = await client.showTermsAndConditionsDialog();
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.accepted).toBe(true);
    });

    it('returns Result.ok({accepted: false}) on decline (NOT an error)', async () => {
      const client = new NavigationSdkClient();
      const controller = sdk.__makeController();
      controller.showTermsAndConditionsDialog.mockResolvedValueOnce(false);
      client.setController({
        controller: controller as unknown as Parameters<
          NavigationSdkClient['setController']
        >[0]['controller'],
        listeners:
          sdk.__makeListeners() as unknown as NavigationListenerSetters,
      });
      const result = await client.showTermsAndConditionsDialog();
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.accepted).toBe(false);
    });

    it('returns NetworkError when SDK throws', async () => {
      const client = new NavigationSdkClient();
      const controller = sdk.__makeController();
      controller.showTermsAndConditionsDialog.mockRejectedValueOnce(
        new Error('dialog crashed'),
      );
      client.setController({
        controller: controller as unknown as Parameters<
          NavigationSdkClient['setController']
        >[0]['controller'],
        listeners:
          sdk.__makeListeners() as unknown as NavigationListenerSetters,
      });
      const result = await client.showTermsAndConditionsDialog();
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('navigation_terms_dialog_failed');
      }
    });
  });

  describe('setDestinations', () => {
    it('forwards waypoint coords + uses routingOptions when no routeToken', async () => {
      const client = new NavigationSdkClient();
      const controller = sdk.__makeController();
      controller.setDestinations.mockResolvedValueOnce(sdk.RouteStatus['OK']);
      client.setController({
        controller: controller as unknown as Parameters<
          NavigationSdkClient['setController']
        >[0]['controller'],
        listeners:
          sdk.__makeListeners() as unknown as NavigationListenerSetters,
      });
      const result = await client.setDestinations({
        waypoints: [{ coords: validCoords(), title: 'Pickup' }],
        avoidTolls: true,
      });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toBe('ok');
      expect(controller.setDestinations).toHaveBeenCalledTimes(1);
      const [waypoints, options] = controller.setDestinations.mock.calls[0] as [
        unknown[],
        Record<string, unknown>,
      ];
      expect(waypoints).toEqual([
        {
          title: 'Pickup',
          position: { lat: 40.7128, lng: -74.006 },
        },
      ]);
      expect(options['routingOptions']).toBeDefined();
      expect(options['routeTokenOptions']).toBeUndefined();
      const routing = options['routingOptions'] as Record<string, unknown>;
      expect(routing['avoidTolls']).toBe(true);
      expect(routing['avoidFerries']).toBe(true);
      expect(routing['travelMode']).toBe(sdk.TravelMode['DRIVING']);
    });

    it('uses routeTokenOptions when routeToken is provided', async () => {
      const client = new NavigationSdkClient();
      const controller = sdk.__makeController();
      controller.setDestinations.mockResolvedValueOnce(sdk.RouteStatus['OK']);
      client.setController({
        controller: controller as unknown as Parameters<
          NavigationSdkClient['setController']
        >[0]['controller'],
        listeners:
          sdk.__makeListeners() as unknown as NavigationListenerSetters,
      });
      await client.setDestinations({
        waypoints: [{ coords: validCoords(), title: 'Dropoff' }],
        routeToken: 'tok_abc',
      });
      const [, options] = controller.setDestinations.mock.calls[0] as [
        unknown[],
        Record<string, unknown>,
      ];
      expect(options['routingOptions']).toBeUndefined();
      expect(options['routeTokenOptions']).toBeDefined();
      const tokenOpts = options['routeTokenOptions'] as Record<string, unknown>;
      expect(tokenOpts['routeToken']).toBe('tok_abc');
      expect(tokenOpts['travelMode']).toBe(sdk.TravelMode['DRIVING']);
    });

    it('maps non-OK route status to Result.ok(<status>) — domain outcome, not error', async () => {
      const client = new NavigationSdkClient();
      const controller = sdk.__makeController();
      controller.setDestinations.mockResolvedValueOnce(
        sdk.RouteStatus['NO_ROUTE_FOUND'],
      );
      client.setController({
        controller: controller as unknown as Parameters<
          NavigationSdkClient['setController']
        >[0]['controller'],
        listeners:
          sdk.__makeListeners() as unknown as NavigationListenerSetters,
      });
      const result = await client.setDestinations({
        waypoints: [{ coords: validCoords(), title: 'Pickup' }],
      });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toBe('no_route_found');
    });

    it('returns NetworkError when SDK throws (transport failure)', async () => {
      const client = new NavigationSdkClient();
      const controller = sdk.__makeController();
      controller.setDestinations.mockRejectedValueOnce(
        new Error('native crash'),
      );
      client.setController({
        controller: controller as unknown as Parameters<
          NavigationSdkClient['setController']
        >[0]['controller'],
        listeners:
          sdk.__makeListeners() as unknown as NavigationListenerSetters,
      });
      const result = await client.setDestinations({
        waypoints: [{ coords: validCoords(), title: 'Pickup' }],
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('navigation_setdestinations_failed');
      }
    });

    it('rejects empty waypoint list locally without calling the SDK', async () => {
      const client = new NavigationSdkClient();
      const controller = sdk.__makeController();
      client.setController({
        controller: controller as unknown as Parameters<
          NavigationSdkClient['setController']
        >[0]['controller'],
        listeners:
          sdk.__makeListeners() as unknown as NavigationListenerSetters,
      });
      const result = await client.setDestinations({ waypoints: [] });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe(
          'navigation_setdestinations_empty_waypoints',
        );
      }
      expect(controller.setDestinations).not.toHaveBeenCalled();
    });
  });

  describe('startGuidance / stopGuidance', () => {
    it('startGuidance happy path returns Result.ok(true)', async () => {
      const client = new NavigationSdkClient();
      const controller = sdk.__makeController();
      client.setController({
        controller: controller as unknown as Parameters<
          NavigationSdkClient['setController']
        >[0]['controller'],
        listeners:
          sdk.__makeListeners() as unknown as NavigationListenerSetters,
      });
      const result = await client.startGuidance();
      expect(result.ok).toBe(true);
      expect(controller.startGuidance).toHaveBeenCalledTimes(1);
    });

    it('stopGuidance returns NetworkError when SDK throws', async () => {
      const client = new NavigationSdkClient();
      const controller = sdk.__makeController();
      controller.stopGuidance.mockRejectedValueOnce(new Error('boom'));
      client.setController({
        controller: controller as unknown as Parameters<
          NavigationSdkClient['setController']
        >[0]['controller'],
        listeners:
          sdk.__makeListeners() as unknown as NavigationListenerSetters,
      });
      const result = await client.stopGuidance();
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('navigation_stop_guidance_failed');
      }
    });
  });

  describe('cleanup', () => {
    it('calls stopGuidance and cleanup on the controller; clears subscribers', async () => {
      const client = new NavigationSdkClient();
      const controller = sdk.__makeController();
      const listeners = sdk.__makeListeners();
      client.setController({
        controller: controller as unknown as Parameters<
          NavigationSdkClient['setController']
        >[0]['controller'],
        listeners: listeners as unknown as NavigationListenerSetters,
      });
      const cb = jest.fn();
      client.subscribeToArrival(cb);
      const result = await client.cleanup();
      expect(result.ok).toBe(true);
      expect(controller.stopGuidance).toHaveBeenCalledTimes(1);
      expect(controller.cleanup).toHaveBeenCalledTimes(1);
      // setOnArrival called with our handler on subscribe, then again
      // with null on cleanup.
      expect(listeners.setOnArrival).toHaveBeenCalledWith(null);
    });

    it('continues to cleanup even if stopGuidance throws', async () => {
      const client = new NavigationSdkClient();
      const controller = sdk.__makeController();
      controller.stopGuidance.mockRejectedValueOnce(
        new Error('ignored on cleanup'),
      );
      client.setController({
        controller: controller as unknown as Parameters<
          NavigationSdkClient['setController']
        >[0]['controller'],
        listeners:
          sdk.__makeListeners() as unknown as NavigationListenerSetters,
      });
      const result = await client.cleanup();
      expect(result.ok).toBe(true);
      expect(controller.cleanup).toHaveBeenCalledTimes(1);
    });

    it('returns NetworkError when controller.cleanup() throws', async () => {
      const client = new NavigationSdkClient();
      const controller = sdk.__makeController();
      controller.cleanup.mockRejectedValueOnce(new Error('cleanup boom'));
      client.setController({
        controller: controller as unknown as Parameters<
          NavigationSdkClient['setController']
        >[0]['controller'],
        listeners:
          sdk.__makeListeners() as unknown as NavigationListenerSetters,
      });
      const result = await client.cleanup();
      expect(result.ok).toBe(false);
      if (!result.ok)
        expect(result.error.code).toBe('navigation_cleanup_failed');
    });
  });

  describe('subscribeToArrival', () => {
    it('registers exactly one underlying SDK listener regardless of subscriber count', () => {
      const client = new NavigationSdkClient();
      const controller = sdk.__makeController();
      const listeners = sdk.__makeListeners();
      client.setController({
        controller: controller as unknown as Parameters<
          NavigationSdkClient['setController']
        >[0]['controller'],
        listeners: listeners as unknown as NavigationListenerSetters,
      });
      const a = jest.fn();
      const b = jest.fn();
      const disposeA = client.subscribeToArrival(a);
      const disposeB = client.subscribeToArrival(b);
      // setOnArrival called once when the first subscriber joined; the
      // second subscribe just reuses the existing listener.
      const callsToActivate = listeners.setOnArrival.mock.calls.filter(
        (c) => c[0] !== null && c[0] !== undefined,
      );
      expect(callsToActivate).toHaveLength(1);
      disposeA();
      disposeB();
    });

    it('fans events to every subscriber and dedupes consecutive identical fires', () => {
      const client = new NavigationSdkClient();
      const controller = sdk.__makeController();
      const listeners = sdk.__makeListeners();
      client.setController({
        controller: controller as unknown as Parameters<
          NavigationSdkClient['setController']
        >[0]['controller'],
        listeners: listeners as unknown as NavigationListenerSetters,
      });
      const a = jest.fn();
      const b = jest.fn();
      client.subscribeToArrival(a);
      client.subscribeToArrival(b);

      const evt = sampleArrivalEvent({ title: 'Pickup', isFinal: true });
      sdk.__emitArrival(evt);
      sdk.__emitArrival(evt); // duplicate — should be deduped

      expect(a).toHaveBeenCalledTimes(1);
      expect(b).toHaveBeenCalledTimes(1);
      const event: NavArrivalEvent = a.mock.calls[0][0] as NavArrivalEvent;
      expect(event.title).toBe('Pickup');
      expect(event.isFinalDestination).toBe(true);
      expect(event.coords?.latitude).toBe(40.7128);
    });

    it('disposer removes the subscriber; final disposer clears the SDK listener', () => {
      const client = new NavigationSdkClient();
      const controller = sdk.__makeController();
      const listeners = sdk.__makeListeners();
      client.setController({
        controller: controller as unknown as Parameters<
          NavigationSdkClient['setController']
        >[0]['controller'],
        listeners: listeners as unknown as NavigationListenerSetters,
      });
      const cb = jest.fn();
      const dispose = client.subscribeToArrival(cb);
      dispose();
      // Last subscriber gone — SDK listener should have been cleared.
      expect(listeners.setOnArrival).toHaveBeenLastCalledWith(null);
      // And subsequent emissions don't reach the disposed callback.
      sdk.__emitArrival(sampleArrivalEvent());
      expect(cb).not.toHaveBeenCalled();
    });

    it('subscribers registered before setController get the SDK listener applied at connect time', () => {
      const client = new NavigationSdkClient();
      const cb = jest.fn();
      // Subscribe BEFORE any controller is connected.
      const dispose = client.subscribeToArrival(cb);
      const controller = sdk.__makeController();
      const listeners = sdk.__makeListeners();
      client.setController({
        controller: controller as unknown as Parameters<
          NavigationSdkClient['setController']
        >[0]['controller'],
        listeners: listeners as unknown as NavigationListenerSetters,
      });
      // Now setOnArrival should have been called with our handler.
      const activations = listeners.setOnArrival.mock.calls.filter(
        (c) => c[0] !== null && c[0] !== undefined,
      );
      expect(activations.length).toBeGreaterThanOrEqual(1);
      // And events flow through.
      sdk.__emitArrival(sampleArrivalEvent());
      expect(cb).toHaveBeenCalledTimes(1);
      dispose();
    });
  });

  /**
   * Phase 9 turn 12 — telemetry: the L512 `handleArrival: subscriber
   * threw` site flipped from `LOG.warn` to `LOG.error` so the rawMeta
   * channel fans throwing arrival subscribers out to
   * `CrashlyticsLogTransport.recordError` (Phase 9 turn 6 contract).
   * Mirrors Turn 9's BackgroundGeolocationClient L502/L547
   * subscriber-threw flips verbatim:
   *   - attach a `CrashlyticsLogTransport` to the singleton `LOG`
   *   - register a throwing subscriber alongside a peer
   *   - emit an arrival
   *   - assert reference identity on the recorded Error AND that the
   *     peer DID receive the event (fan-out resilience)
   *   - detach in `try/finally` so subsequent tests in the same Jest
   *     worker don't see leaked transports
   *
   * Asserts `recorded.name === 'YeRide:NavigationSdk'` so Firebase
   * Console groups non-fatals correctly under the adapter's scope.
   */
  describe('telemetry — recordError fan-out via rawMeta channel (Phase 9 turn 12)', () => {
    const SCOPE = 'YeRide:NavigationSdk';

    it('arrival subscriber throws → recordError fires with the thrown Error (fan-out continues)', () => {
      const fakeCrash = new FakeCrashReportingService();
      const transport = new CrashlyticsLogTransport(fakeCrash);
      LOG.addTransport(transport);
      try {
        const client = new NavigationSdkClient();
        const controller = sdk.__makeController();
        const listeners = sdk.__makeListeners();
        client.setController({
          controller: controller as unknown as Parameters<
            NavigationSdkClient['setController']
          >[0]['controller'],
          listeners: listeners as unknown as NavigationListenerSetters,
        });

        const seededError = new Error('arrival-subscriber-bug');
        const throwingCb = jest.fn(() => {
          throw seededError;
        });
        const peerCb = jest.fn();

        const disposeA = client.subscribeToArrival(throwingCb);
        const disposeB = client.subscribeToArrival(peerCb);

        sdk.__emitArrival(sampleArrivalEvent());

        const recorded = fakeCrash.getRecordedErrors();
        // Reference identity — `e` in the catch is the seededError
        // instance; the rawMeta channel preserves it through
        // `sanitizeForLogging`.
        const seededRecord = recorded.find((r) => r.error === seededError);
        expect(seededRecord).toBeDefined();
        // Scope-pin: Firebase Console groups by `name` field. Pinning
        // here catches any future scope rename that would silently
        // re-cluster these reports.
        expect(seededRecord?.name).toBe(SCOPE);
        // Fan-out resilience: peer subscriber DID receive the event
        // despite the prior subscriber throwing.
        expect(peerCb).toHaveBeenCalledTimes(1);
        // Throwing subscriber was called once before throwing.
        expect(throwingCb).toHaveBeenCalledTimes(1);

        disposeA();
        disposeB();
      } finally {
        LOG.removeTransport(transport);
      }
    });
  });

  /**
   * Phase 9 turn 15 — three teardown LOG.warn sites in this file
   * (L387 stopGuidance standalone, L415 cleanup setOnArrival(null),
   * L428 cleanup-internal stopGuidance) flipped to LOG.error so the
   * rawMeta channel fans them out to `recordError`. Mirrors Turn 12's
   * L520 fan-out test verbatim — attach a `CrashlyticsLogTransport`
   * to the singleton `LOG`, drive the failure path via the existing
   * SDK mock, assert `getRecordedErrors()` contains a record with
   * reference identity on `Error`, name=='YeRide:NavigationSdk',
   * and the inline log message substring (Crashlytics groups by
   * scope + leading message text). VM-side teardown logs at
   * `useDriverNavigationViewModel.ts` L296/L300 stay at LOG.warn
   * (which doesn't fan out), so these flips do NOT create duplicate
   * Crashlytics reports today.
   */
  describe('telemetry — recordError fan-out via rawMeta channel (Phase 9 turn 15)', () => {
    const SCOPE = 'YeRide:NavigationSdk';

    it('standalone stopGuidance throw → recordError fires with the thrown Error', async () => {
      const fakeCrash = new FakeCrashReportingService();
      const transport = new CrashlyticsLogTransport(fakeCrash);
      LOG.addTransport(transport);
      try {
        const client = new NavigationSdkClient();
        const controller = sdk.__makeController();
        const seededError = new Error('stopGuidance-bug');
        controller.stopGuidance.mockRejectedValueOnce(seededError);
        client.setController({
          controller: controller as unknown as Parameters<
            NavigationSdkClient['setController']
          >[0]['controller'],
          listeners:
            sdk.__makeListeners() as unknown as NavigationListenerSetters,
        });

        const result = await client.stopGuidance();

        // Result.err still surfaces to the caller — the LOG.error is
        // the breadcrumb fan-out, not a replacement for the wrapped
        // NetworkError.
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.code).toBe('navigation_stop_guidance_failed');
        }

        const recorded = fakeCrash.getRecordedErrors();
        const seededRecord = recorded.find((r) => r.error === seededError);
        expect(seededRecord).toBeDefined();
        expect(seededRecord?.name).toBe(SCOPE);
        // Inline message substring — pinning the leading text catches
        // any future cosmetic edit that would re-cluster Crashlytics
        // issues by changing the grouping key.
        expect(seededRecord?.error.message).toContain('stopGuidance-bug');
      } finally {
        LOG.removeTransport(transport);
      }
    });

    it('cleanup: setOnArrival(null) throw → recordError fires; cleanup continues', async () => {
      const fakeCrash = new FakeCrashReportingService();
      const transport = new CrashlyticsLogTransport(fakeCrash);
      LOG.addTransport(transport);
      try {
        const client = new NavigationSdkClient();
        const controller = sdk.__makeController();
        const listeners = sdk.__makeListeners();
        client.setController({
          controller: controller as unknown as Parameters<
            NavigationSdkClient['setController']
          >[0]['controller'],
          listeners: listeners as unknown as NavigationListenerSetters,
        });
        // Activate the SDK arrival listener so cleanup will call
        // setOnArrival(null) on teardown.
        const cb = jest.fn();
        const dispose = client.subscribeToArrival(cb);

        // setOnArrival is called ONCE on subscribe (with the handler)
        // and then on cleanup with null — the second call is the one
        // we need to throw on. Use mockImplementation on a counter
        // so we throw only when invoked with `null`.
        const seededError = new Error('setOnArrival-detach-bug');
        listeners.setOnArrival.mockImplementation(
          (arg: ((e: unknown) => void) | null | undefined) => {
            if (arg === null) throw seededError;
          },
        );

        const result = await client.cleanup();

        // Cleanup should still resolve Ok — the listener-detach
        // failure is intentionally swallowed; controller.cleanup()
        // ran successfully.
        expect(result.ok).toBe(true);
        // Confirm the controller's cleanup() was reached after the
        // listener-detach throw (proves the function continued past
        // the catch).
        expect(controller.cleanup).toHaveBeenCalledTimes(1);

        const recorded = fakeCrash.getRecordedErrors();
        const seededRecord = recorded.find((r) => r.error === seededError);
        expect(seededRecord).toBeDefined();
        expect(seededRecord?.name).toBe(SCOPE);
        expect(seededRecord?.error.message).toContain(
          'setOnArrival-detach-bug',
        );

        dispose();
      } finally {
        LOG.removeTransport(transport);
      }
    });

    it('cleanup-internal stopGuidance throw → recordError fires; cleanup continues', async () => {
      const fakeCrash = new FakeCrashReportingService();
      const transport = new CrashlyticsLogTransport(fakeCrash);
      LOG.addTransport(transport);
      try {
        const client = new NavigationSdkClient();
        const controller = sdk.__makeController();
        const seededError = new Error('cleanup-stopGuidance-bug');
        controller.stopGuidance.mockRejectedValueOnce(seededError);
        client.setController({
          controller: controller as unknown as Parameters<
            NavigationSdkClient['setController']
          >[0]['controller'],
          listeners:
            sdk.__makeListeners() as unknown as NavigationListenerSetters,
        });

        const result = await client.cleanup();

        // Cleanup should still resolve Ok — the cleanup-internal
        // stopGuidance failure is intentionally swallowed so the
        // session isn't stranded; controller.cleanup() ran
        // successfully.
        expect(result.ok).toBe(true);
        expect(controller.cleanup).toHaveBeenCalledTimes(1);

        const recorded = fakeCrash.getRecordedErrors();
        const seededRecord = recorded.find((r) => r.error === seededError);
        expect(seededRecord).toBeDefined();
        expect(seededRecord?.name).toBe(SCOPE);
        expect(seededRecord?.error.message).toContain(
          'cleanup-stopGuidance-bug',
        );
      } finally {
        LOG.removeTransport(transport);
      }
    });
  });
});
