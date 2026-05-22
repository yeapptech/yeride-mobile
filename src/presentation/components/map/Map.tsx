import { useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';

import type { Coordinates } from '@domain/entities/Coordinates';
import MapView, {
  Marker,
  type MapViewMethods,
  Polyline,
  PROVIDER_GOOGLE,
  type Region as RNRegion,
} from 'react-native-maps';

import { decodePolyline, type DecodedPoint } from './decodePolyline';

/**
 * Shared Map component for every screen that renders a `react-native-maps`
 * surface (RouteSelect, RiderHome, RideMonitor, future DriverHome /
 * DriverMonitor).
 *
 * ## The always-mounted-children rule
 *
 * react-native-maps 1.24.0 ships a legacy view-manager. On RN's New
 * Architecture (Expo SDK 55 default) it goes through the Fabric → Paper
 * interop layer, which caches subview indices. When any direct child of
 * `<MapView>` is conditionally mounted/unmounted, NSMutableArray throws
 * NSRangeException → SIGABRT (see legacy CLAUDE.md, AIRMap entry).
 *
 * To avoid this, **every direct MapView child here is always mounted for
 * the component's lifetime**. Visibility is driven by props:
 *   - polylines: empty `coordinates={[]}` hides them
 *   - markers:    `opacity={0}` + a dummy coordinate hides them
 *
 * The marker/polyline pool is fixed-size:
 *   - 3 marker slots (pickup, dropoff, driver)
 *   - 5 polyline slots (selected dropoff route, pickup route, alt 1, alt 2,
 *     alt 3 — Google Routes API caps alternatives at 3)
 *
 * If a future surface needs more than 3 alternative polylines or extra
 * markers, extend the pool here rather than rendering them conditionally
 * at the call site.
 *
 * ## What this component does NOT do
 *
 *   - It doesn't subscribe to anything. Driver location, pickup / dropoff,
 *     and route alternatives all flow in via props. View-models compose
 *     the right hooks and feed this component a snapshot.
 *   - It doesn't compute fits / region animations. The caller can pass
 *     an explicit `region` to recenter; an imperative ref-based fit-to-
 *     coordinates API can land later if a real consumer needs it.
 *   - It doesn't render marker labels or branded pin styles. That's
 *     intentional in turn 3.2 — the map should look right with default
 *     pins so we can prove the harness, then turn 3.3+ stylize.
 *
 * ## Provider
 *
 * Both platforms force `PROVIDER_GOOGLE`. On Android this matches legacy
 * yeride and the `com.google.android.geo.API_KEY` plumbing in
 * `withGoogleMapsApiKey`. On iOS, Phase 9 turn 1 flipped the rewrite from
 * Apple Maps (`provider={undefined}`) to Google Maps to escape a Fabric
 * registration regression: under Expo SDK 55 + RN 0.83.6 New Arch, every
 * screen using `<MapView>` without `provider="google"` falls through to a
 * pink "Unimplemented component: <RNMapsMapView>" placeholder (the
 * react-native-maps@1.24 Apple Maps view manager isn't picked up by the
 * Fabric → Paper interop). Switching to the Google view manager
 * (`AIRGoogleMap`) sidesteps the issue entirely. The plugin
 * `plugins/withNavigationSdk.js` ensures the `react-native-maps/Google`
 * subspec lands in the Podfile and bumps its `GoogleMaps` dep to 10.7.0
 * to match the Navigation SDK's pin.
 *
 * Legacy yeride uses `provider={Platform.OS === 'ios' ? undefined : 'google'}`
 * (Apple Maps on iOS) — but legacy is on Expo SDK 53 with the old
 * architecture and doesn't hit the Fabric regression. The rewrite needs
 * Google on both platforms; legacy parity is intentionally not preserved
 * here.
 */

export interface MapMarkerProps {
  readonly coordinates: Coordinates;
  /** Tint colour. Default depends on the slot. */
  readonly color?: string;
  readonly title?: string;
}

export interface MapRoute {
  /** Stable id; if you only have one route, "main" is fine. */
  readonly id: string;
  /** Google polyline-encoded string. */
  readonly encodedPolyline: string;
}

export interface MapRegion {
  readonly latitude: number;
  readonly longitude: number;
  readonly latitudeDelta: number;
  readonly longitudeDelta: number;
}

export interface MapProps {
  /**
   * Centre/zoom. The first non-null value lands on the native
   * `initialRegion` prop (one-shot, used to place the camera at mount).
   * Subsequent value changes are picked up internally and forwarded to
   * `mapRef.animateToRegion(...)` so the camera follows updates after
   * mount — required so a cold-start `null → non-null` transition
   * doesn't leave the camera at the default world view, and so a fresh
   * `useCurrentLocation` reading after a stale-cached one re-centres.
   *
   * Comparison is on lat/lng only (rounded), not object identity —
   * call sites that build `initialRegion` as a fresh literal each
   * render won't churn animations.
   */
  readonly initialRegion: MapRegion | null;
  /** Pickup pin. `null` to hide. */
  readonly pickup: MapMarkerProps | null;
  /** Dropoff pin. `null` to hide. */
  readonly dropoff: MapMarkerProps | null;
  /** Driver location pin (during dispatched / started). `null` to hide. */
  readonly driver: MapMarkerProps | null;
  /**
   * The dropoff route (rider → destination) currently in focus — gold,
   * stroke 4. `null` to hide.
   */
  readonly selectedRoute: MapRoute | null;
  /**
   * The driver → pickup route shown during `dispatched`. Green, stroke 4.
   * `null` to hide.
   */
  readonly pickupRoute: MapRoute | null;
  /**
   * Alternative route options shown alongside `selectedRoute` (gray, dashed).
   * Capped at 3; extras are ignored. Pass `[]` to show no alternatives.
   */
  readonly alternativeRoutes: readonly MapRoute[];
  /**
   * Called when the user pans the map. Most surfaces don't need this;
   * RouteSearch uses it to update the active service-area lookup.
   */
  readonly onRegionChangeComplete?: (region: MapRegion) => void;
}

const ALT_POLYLINE_SLOTS = 3;
const HIDDEN_COORD = { latitude: 0, longitude: 0 } as const;

/**
 * `animateToRegion` duration in ms. Short enough to feel responsive on a
 * cold-start null→non-null transition, long enough to not feel like a
 * jump cut.
 */
const ANIMATE_TO_REGION_MS = 350;

/**
 * Rounded-precision threshold for the camera-follow effect. Two regions
 * are treated as "the same place" when |Δlat| < 1e-5 AND |Δlng| < 1e-5
 * (~1.1m at the equator). Stops floating-point churn from fresh literal
 * objects on every render from triggering a re-animation.
 */
const REGION_EPSILON = 1e-5;

/**
 * Color tokens — inlined hex with a `// --token` comment per the legacy
 * design-system convention (Tailwind classes don't reach into native map
 * primitives).
 */
const STROKE_SELECTED = '#f9c901'; // --primary (brand gold)
const STROKE_PICKUP = '#15803d'; // --success (green)
const STROKE_ALT = '#9CA3AF'; // gray-400

export function Map({
  initialRegion,
  pickup,
  dropoff,
  driver,
  selectedRoute,
  pickupRoute,
  alternativeRoutes,
  onRegionChangeComplete,
}: MapProps) {
  // Imperative ref into the native MapView. Used solely for
  // `animateToRegion` (camera-follow effect below). The MapView's
  // `initialRegion` prop is still the canonical placement for the
  // first non-null value at mount; the ref kicks in for every change
  // after that.
  const mapRef = useRef<MapViewMethods>(null);

  // Last region we actively applied — either via the native
  // `initialRegion` prop (first non-null value at mount) or via a
  // subsequent `animateToRegion` call. Used to dedupe so a fresh
  // literal with the same lat/lng doesn't kick off an animation each
  // render. `null` until the first non-null region is observed.
  const lastAppliedRef = useRef<{
    readonly latitude: number;
    readonly longitude: number;
  } | null>(initialRegion ? toLatLng(initialRegion) : null);

  // Whether MapView mounted with a non-null `initialRegion`. When true,
  // the native prop already placed the camera and the effect skips
  // animating to the SAME value on first paint. When false (cold
  // start with `initialRegion={null}`), the first non-null value will
  // arrive via the effect and `animateToRegion` is the only path
  // that moves the camera off the default world view.
  const mountedWithInitialRegionRef = useRef<boolean>(initialRegion !== null);

  useEffect(() => {
    if (!initialRegion) return;
    const next = toLatLng(initialRegion);
    const last = lastAppliedRef.current;
    if (last && approxSamePlace(last, next)) return;
    lastAppliedRef.current = next;

    // First-effect-pass exception: if the consumer passed a non-null
    // `initialRegion` at mount, the native prop has already placed the
    // camera. Don't double-animate to the same point.
    if (last === null && mountedWithInitialRegionRef.current) {
      return;
    }

    // Either (a) cold-start null → non-null transition, or (b) a real
    // post-mount change in the centre. Either way, animate.
    mapRef.current?.animateToRegion(
      toRNRegion(initialRegion),
      ANIMATE_TO_REGION_MS,
    );
  }, [initialRegion]);

  // Decode polylines once per change — react-native-maps wants
  // `Coordinates[]`, not encoded strings.
  const selectedCoords = useMemo<DecodedPoint[]>(
    () => (selectedRoute ? decodePolyline(selectedRoute.encodedPolyline) : []),
    [selectedRoute],
  );
  const pickupCoords = useMemo<DecodedPoint[]>(
    () => (pickupRoute ? decodePolyline(pickupRoute.encodedPolyline) : []),
    [pickupRoute],
  );

  // Pad alternativeRoutes to the slot count so every Polyline child stays
  // mounted across re-renders. Slots beyond the cap are dropped.
  const altCoords = useMemo<DecodedPoint[][]>(() => {
    const sliced = alternativeRoutes.slice(0, ALT_POLYLINE_SLOTS);
    const out: DecodedPoint[][] = [];
    for (let i = 0; i < ALT_POLYLINE_SLOTS; i += 1) {
      const route = sliced[i];
      out.push(route ? decodePolyline(route.encodedPolyline) : []);
    }
    return out;
  }, [alternativeRoutes]);

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={styles.map}
        showsCompass={true}
        {...(initialRegion ? { initialRegion: toRNRegion(initialRegion) } : {})}
        {...(onRegionChangeComplete
          ? {
              onRegionChangeComplete: (r: RNRegion) =>
                onRegionChangeComplete(fromRNRegion(r)),
            }
          : {})}
      >
        {/* ──── Polyline pool ────
            Slot 0: alternative route #1
            Slot 1: alternative route #2
            Slot 2: alternative route #3
            Slot 3: pickup route (driver → pickup)
            Slot 4: selected dropoff route

            All five render unconditionally; visibility = empty coords.
            Selected route is rendered LAST so it draws on top of any
            alternative running along the same segments. */}
        <Polyline
          key="alt-0"
          coordinates={altCoords[0] ?? []}
          strokeWidth={3}
          strokeColor={STROKE_ALT}
          lineDashPattern={[5, 5]}
        />
        <Polyline
          key="alt-1"
          coordinates={altCoords[1] ?? []}
          strokeWidth={3}
          strokeColor={STROKE_ALT}
          lineDashPattern={[5, 5]}
        />
        <Polyline
          key="alt-2"
          coordinates={altCoords[2] ?? []}
          strokeWidth={3}
          strokeColor={STROKE_ALT}
          lineDashPattern={[5, 5]}
        />
        <Polyline
          key="pickup-route"
          coordinates={pickupCoords}
          strokeWidth={4}
          strokeColor={STROKE_PICKUP}
        />
        <Polyline
          key="selected-route"
          coordinates={selectedCoords}
          strokeWidth={4}
          strokeColor={STROKE_SELECTED}
        />

        {/* ──── Marker pool ────
            Slot 0: pickup
            Slot 1: dropoff
            Slot 2: driver

            tracksViewChanges={false} for performance — without it, every
            subview update on the MapView re-renders all custom markers.
            Default Marker pins are platform-native; turn 3.3+ swaps in
            branded views inside the Marker. */}
        <Marker
          key="pickup-marker"
          coordinate={pickup ? toCoord(pickup.coordinates) : HIDDEN_COORD}
          opacity={pickup ? 1 : 0}
          tracksViewChanges={false}
          {...(pickup?.color ? { pinColor: pickup.color } : {})}
          {...(pickup?.title ? { title: pickup.title } : {})}
        />
        <Marker
          key="dropoff-marker"
          coordinate={dropoff ? toCoord(dropoff.coordinates) : HIDDEN_COORD}
          opacity={dropoff ? 1 : 0}
          tracksViewChanges={false}
          {...(dropoff?.color ? { pinColor: dropoff.color } : {})}
          {...(dropoff?.title ? { title: dropoff.title } : {})}
        />
        <Marker
          key="driver-marker"
          coordinate={driver ? toCoord(driver.coordinates) : HIDDEN_COORD}
          opacity={driver ? 1 : 0}
          anchor={{ x: 0.5, y: 0.5 }}
          tracksViewChanges={false}
          {...(driver?.color ? { pinColor: driver.color } : {})}
          {...(driver?.title ? { title: driver.title } : {})}
        />
      </MapView>
    </View>
  );
}

function toCoord(c: Coordinates): { latitude: number; longitude: number } {
  return { latitude: c.latitude, longitude: c.longitude };
}

function toLatLng(r: MapRegion): { latitude: number; longitude: number } {
  return { latitude: r.latitude, longitude: r.longitude };
}

function approxSamePlace(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): boolean {
  return (
    Math.abs(a.latitude - b.latitude) < REGION_EPSILON &&
    Math.abs(a.longitude - b.longitude) < REGION_EPSILON
  );
}

function toRNRegion(r: MapRegion): RNRegion {
  return {
    latitude: r.latitude,
    longitude: r.longitude,
    latitudeDelta: r.latitudeDelta,
    longitudeDelta: r.longitudeDelta,
  };
}

function fromRNRegion(r: RNRegion): MapRegion {
  return {
    latitude: r.latitude,
    longitude: r.longitude,
    latitudeDelta: r.latitudeDelta,
    longitudeDelta: r.longitudeDelta,
  };
}

const styles = StyleSheet.create({
  container: { flex: 1, position: 'relative' },
  map: { flex: 1 },
});
