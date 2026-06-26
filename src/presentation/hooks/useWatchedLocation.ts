import * as Location from 'expo-location';
import { useEffect, useState } from 'react';

import { Coordinates } from '@domain/entities/Coordinates';
import { LOG } from '@shared/logger';

const logger = LOG.extend('useWatchedLocation');

export interface WatchedLocation {
  /** Latest foreground fix, or `null` until the first watch callback. */
  readonly coordinates: Coordinates | null;
  /**
   * Latest travel heading in degrees (0–360 clockwise from north), or `null`
   * until a GPS-sourced heading arrives. HELD across stationary fixes (the OS
   * reports `-1` / no heading when not moving) so a rotating marker keeps its
   * last bearing instead of snapping back to north.
   */
  readonly heading: number | null;
}

/**
 * Continuous FOREGROUND location watch via `expo-location`'s
 * `watchPositionAsync`. The companion to the one-shot `useCurrentLocation`:
 * that hook centres a map at mount; this one keeps a live coordinate +
 * heading flowing while a map surface is on screen so the "you are here" /
 * driver car marker FOLLOWS the device.
 *
 * Why a second source on top of the background-geolocation stream
 * (`useGpsStore` / `useGpsCurrentLocation`): the Transistor BG SDK gates its
 * emissions on Android activity-recognition, which reports "still" on an
 * emulator — so the BG stream never wakes there and the marker would freeze
 * during Extended-Controls route playback. `watchPositionAsync` reads the OS
 * fused provider directly, with no activity-recognition gate, so it follows
 * on the emulator AND is a belt-and-braces foreground source on real devices.
 * Consumers prefer the BG stream and fall back to this:
 * `useGpsCurrentLocation() ?? watched.coordinates ?? currentLocation.coordinates`.
 *
 * Foreground-only and presentation-direct, mirroring `useCurrentLocation`
 * (the BG SDK is the only location source behind a domain seam). Pass
 * `enabled = currentLocation.permissionStatus === 'granted'` so the watch
 * starts exactly when foreground permission has been granted (no second
 * permission prompt — `useCurrentLocation` owns that).
 */
export function useWatchedLocation(enabled: boolean): WatchedLocation {
  const [coordinates, setCoordinates] = useState<Coordinates | null>(null);
  const [heading, setHeading] = useState<number | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let subscription: Location.LocationSubscription | null = null;
    let cancelled = false;

    void (async () => {
      try {
        const sub = await Location.watchPositionAsync(
          {
            // PRIORITY_HIGH_ACCURACY — NOT Balanced. A Balanced (low-power)
            // request never forces the GPS active; it passively rides
            // whatever fixes the OS already produces. On the Android
            // emulator's route playback nothing else pulls the GPS, so the
            // route points sit on the provider and never stream to us — the
            // car marker froze unless another app (e.g. Google Maps
            // turn-by-turn) elevated the system request to high accuracy.
            // High accuracy makes US the one that wakes the GPS, so the
            // marker follows on its own. On real devices this is also the
            // right call for a live vehicle marker (nav-grade tracking).
            accuracy: Location.Accuracy.High,
            distanceInterval: 5,
            timeInterval: 1000,
          },
          (reading) => {
            const r = Coordinates.create(
              reading.coords.latitude,
              reading.coords.longitude,
            );
            if (r.ok) setCoordinates(r.value);
            // OS reports `-1` / null when not moving — hold the last bearing
            // rather than reset rotation to north.
            const h = reading.coords.heading;
            if (typeof h === 'number' && h >= 0) setHeading(h);
          },
        );
        if (cancelled) {
          void sub.remove();
        } else {
          subscription = sub;
        }
      } catch (e: unknown) {
        // Recoverable (permission revoked mid-session, location services off):
        // warn, don't fan out to Crashlytics. The one-shot read's banner is
        // the user-facing escalation.
        const message = e instanceof Error ? e.message : String(e);
        logger.warn('watch failed', { message });
      }
    })();

    return () => {
      cancelled = true;
      void subscription?.remove();
    };
  }, [enabled]);

  return { coordinates, heading };
}
