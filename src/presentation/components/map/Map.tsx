import { useMemo } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import type { Coordinates } from '@domain/entities/Coordinates';
import MapView, {
  Marker,
  Polyline,
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
 * On Android we force the Google Maps provider (matches legacy: the
 * `com.google.android.geo.API_KEY` plumbing in `withGoogleMapsApiKey`
 * targets it). On iOS we let the platform pick (Apple Maps default for
 * react-native-maps' built-in MapView).
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
   * Initial centre/zoom. Subsequent reads of this prop are ignored —
   * `MapView` only consumes `initialRegion` once. To programmatically
   * animate, use a ref + `animateToRegion` (not exposed here yet).
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
        provider={Platform.OS === 'ios' ? undefined : 'google'}
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
