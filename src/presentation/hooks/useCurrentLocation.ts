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
      const reading = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
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
      logger.error('refresh failed', e);
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
