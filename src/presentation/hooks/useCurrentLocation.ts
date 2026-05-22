import * as Location from 'expo-location';
import { useCallback, useEffect, useState } from 'react';

import { Coordinates } from '@domain/entities/Coordinates';
import { LOG } from '@shared/logger';

const logger = LOG.extend('useCurrentLocation');

/**
 * Foreground location read for surfaces that need to centre a map or
 * resolve the active service area before any trip is in flight.
 *
 * Boundaries:
 *   - This hook is FOREGROUND ONLY. The full background-geolocation
 *     pipeline (start/stop, permissions, geofence registration,
 *     listener-level dedup) is Phase 4's responsibility — it lives in
 *     `BackgroundGeolocationClient` + `useGpsLifecycle`, owned by
 *     `AppContent`.
 *
 *   - The hook does not write to Firestore. View-models compose this
 *     hook with `useUpdateLocationMutation` if they want to push the
 *     result to `users/{uid}.location`.
 *
 *   - Permission state is reported via `permissionStatus`. A "denied"
 *     state is not an error — it's an expected user choice. Screens
 *     should surface a "we need location to show your map" prompt
 *     and a "Open settings" CTA.
 *
 *   - Coordinates are domain value objects, not raw lat/lng. Construction
 *     can fail (out-of-range numbers) — we log and emit `null` rather
 *     than throwing.
 *
 * The hook does ONE foreground read on mount when permission is
 * granted; it does not poll. RiderHome refreshes by re-mounting (e.g.
 * the user pulls to refresh) or by reading from `useGpsLifecycle` once
 * Phase 4 lands.
 */

export type LocationPermission =
  | 'undetermined'
  | 'requesting'
  | 'granted'
  | 'denied';

export interface UseCurrentLocation {
  readonly coordinates: Coordinates | null;
  readonly permissionStatus: LocationPermission;
  readonly error: string | null;
  /** Re-request permission + re-read. Idempotent. */
  refresh: () => Promise<void>;
}

export function useCurrentLocation(): UseCurrentLocation {
  const [coordinates, setCoordinates] = useState<Coordinates | null>(null);
  const [permissionStatus, setPermissionStatus] =
    useState<LocationPermission>('undetermined');
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setPermissionStatus('requesting');
    setError(null);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setPermissionStatus('denied');
        return;
      }
      setPermissionStatus('granted');
      // Try last-known position first — cheap, returns null instead of
      // throwing. This unblocks the common simulator case where the GPS
      // provider has been seeded with a point (Extended Controls SET
      // LOCATION on Android, Features > Location > Custom on iOS) but
      // hasn't been promoted to a "current fix" by the FusedLocationProvider.
      // `getCurrentPositionAsync` would otherwise throw with
      // "Current location is unavailable. Make sure that location services
      // are enabled" until the provider gets around to acquiring a
      // proper fix.
      //
      // `maxAge: 2 minutes` — we'd previously left this uncapped, which
      // burned us on the Android emulator after sessions where the OS's
      // FusedLocationProvider had a stale fix from a prior trip's
      // dropoff cached. With the BG-geolocation native init skipped in
      // `__DEV__` (tslocationmanager:4.1.5 priority workaround) there's
      // no background stream to correct the stale read, so the map sat
      // on the old coordinate indefinitely. A 2-minute cap still
      // satisfies the simulator-seeded-once case (a fresh SET LOCATION
      // is well under 2 min old when the app boots) and falls through
      // to a live `getCurrentPositionAsync` call otherwise.
      //
      // `requiredAccuracy: 200m` — a freshly-seeded simulator fix is
      // exact; a stale cached fix from a different geographic area
      // typically has accumulated drift past this threshold. Belt-and-
      // braces with `maxAge`.
      const freshLastKnown = await Location.getLastKnownPositionAsync({
        maxAge: 2 * 60 * 1000,
        requiredAccuracy: 200,
      });
      // Three-tier fallback chain:
      //   1. Fresh cached fix (capped). Best case — no SDK calls, instant.
      //   2. Live `getCurrentPositionAsync`. Hits the FusedLocationProvider
      //      / CLLocationManager — can throw `ERR_CURRENT_LOCATION_IS_UNAVAILABLE`
      //      when the OS hasn't promoted any provider to a "current fix"
      //      yet (common on iOS/Android simulators after a fresh boot,
      //      and on real devices indoors without a recent fix). When this
      //      throws, the catch below falls through to step 3.
      //   3. UNCAPPED `getLastKnownPositionAsync` (any cached fix, no
      //      matter how stale). The original bug we fixed in step 1 was
      //      that this returned a "last dropoff" point — but a known-
      //      stale point is a better cold-start UX than the default
      //      world-view map + a red error toast. Once the user moves or
      //      `useGpsLifecycle` pushes a real fix in, the staleness self-
      //      corrects.
      let reading = freshLastKnown;
      if (!reading) {
        try {
          reading = await Location.getCurrentPositionAsync({
            // Lower accuracy on the cold path: less likely to time out on
            // a simulator that's only seeded a single GPS point. The
            // Coordinates value object validates the result anyway.
            accuracy: Location.Accuracy.Lowest,
          });
        } catch (liveError: unknown) {
          // Last-ditch: any cached fix, no staleness cap. If THAT's also
          // null, re-throw the original live-read error so the outer
          // catch surfaces a useful message.
          const staleLastKnown = await Location.getLastKnownPositionAsync();
          if (!staleLastKnown) {
            throw liveError;
          }
          const liveCode =
            typeof liveError === 'object' &&
            liveError !== null &&
            'code' in liveError
              ? String((liveError as { code: unknown }).code)
              : 'unknown';
          logger.warn(
            'refresh: live read unavailable, falling back to stale cached fix',
            { code: liveCode },
          );
          reading = staleLastKnown;
        }
      }
      const r = Coordinates.create(
        reading.coords.latitude,
        reading.coords.longitude,
      );
      if (!r.ok) {
        logger.warn('refresh: invalid coordinates from sensor', r.error);
        setError('Got invalid coordinates from the sensor — try again.');
        setCoordinates(null);
        return;
      }
      setCoordinates(r.value);
    } catch (e: unknown) {
      // Surface the expo-location CodedError details when present —
      // `code` is a string like 'E_LOCATION_UNAUTHORIZED' /
      // 'E_LOCATION_TIMEOUT' / 'E_LOCATION_SERVICES_DISABLED' /
      // 'ERR_CURRENT_LOCATION_IS_UNAVAILABLE'. The default
      // `console.error(error)` collapses to a stack trace; we explicitly
      // include the message and code so the toast shows something useful.
      //
      // Log level is `warn`, NOT `error`: every reach of this catch is a
      // user-facing recoverable state (no permission, OS hasn't acquired
      // a fix yet, location services disabled). The view-model surfaces a
      // red banner with a "Try again" CTA — the right escalation. We
      // don't want LOG.error's Crashlytics non-fatal fan-out for
      // expected user-recoverable conditions, and we don't want the
      // LogBox red overlay either.
      const code =
        typeof e === 'object' && e !== null && 'code' in e
          ? String((e as { code: unknown }).code)
          : 'unknown';
      const message = e instanceof Error ? e.message : String(e);
      logger.warn('refresh failed', { code, message });
      setError(
        e instanceof Error
          ? e.message
          : 'Could not read your location — try again.',
      );
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { coordinates, permissionStatus, error, refresh };
}
