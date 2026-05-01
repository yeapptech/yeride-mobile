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
      // No `maxAge` cap: for centring a map any cached fix beats none, and
      // simulator-seeded "single point" locations frequently age past a
      // tight window between the set-location action and the app's first
      // mount/reload. Stale cached fixes are corrected as soon as the user
      // moves (or the route playback streams) and `useGpsLifecycle` /
      // `refresh()` push fresh readings in.
      const lastKnown = await Location.getLastKnownPositionAsync();
      const reading =
        lastKnown ??
        (await Location.getCurrentPositionAsync({
          // Lower accuracy on the cold path: less likely to time out on
          // a simulator that's only seeded a single GPS point. The
          // Coordinates value object validates the result anyway.
          accuracy: Location.Accuracy.Lowest,
        }));
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
      // 'E_LOCATION_TIMEOUT' / 'E_LOCATION_SERVICES_DISABLED'. The
      // default `console.error(error)` collapses to a stack trace; we
      // explicitly include the message and code so the toast shows
      // something useful.
      const code =
        typeof e === 'object' && e !== null && 'code' in e
          ? String((e as { code: unknown }).code)
          : 'unknown';
      const message = e instanceof Error ? e.message : String(e);
      logger.error('refresh failed', { code, message });
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
