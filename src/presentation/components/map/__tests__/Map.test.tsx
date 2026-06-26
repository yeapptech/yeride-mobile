import { render } from '@testing-library/react-native';

import { Coordinates } from '@domain/entities/Coordinates';
import {
  animateToRegionCalls,
  markerRenders,
  resetMapMockState,
} from 'react-native-maps';

import { Map } from '../Map';

function coords(lat: number, lng: number): Coordinates {
  const r = Coordinates.create(lat, lng);
  if (!r.ok) throw new Error('test setup: bad coords');
  return r.value;
}

// Numeric sentinel — a real `require('./x.png')` resolves to a number, which
// is a valid `ImageSourcePropType`. Using one here lets us assert the image
// is forwarded by identity without importing the bundled asset.
const CAR_IMAGE = 4242;

/**
 * Rendering invariants for the shared `<Map/>` component.
 *
 * **Phase 9 turn 1** — locks the iOS Apple Maps Fabric escape: the
 * rewrite must pass `provider="google"` (`PROVIDER_GOOGLE`) on both
 * platforms. Without it, iOS falls through to a pink "Unimplemented
 * component: <RNMapsMapView>" placeholder under Expo SDK 55 + RN 0.83.6
 * New Arch (the react-native-maps@1.24 Apple Maps view manager isn't
 * picked up by the Fabric → Paper interop). Reverting to
 * `provider={Platform.OS === 'ios' ? undefined : 'google'}` would break
 * every iOS map screen — these tests catch that regression.
 *
 * **Always-mounted-children rule** (Phase 3 turn 4 / 4a) — react-native-maps
 * 1.24's legacy view manager goes through the Fabric → Paper interop on
 * New Arch, which caches subview indices. Conditionally mounting any
 * direct MapView child causes NSRangeException at the next render. The
 * fixed marker/polyline pool here keeps every child mounted; visibility
 * is driven by props (empty `coordinates`, `opacity={0}`). The structural
 * tests below assert the pool sizes so a refactor that drops a slot or
 * adds a `{cond && <Polyline/>}` flip fails loud.
 *
 * `react-native-maps` is mocked globally in `jest.setup.ts` — the real
 * module imports native view-managers that require a live RN runtime.
 * The stubs return simple host views with the relevant props encoded
 * in `testID`s so `getAllByTestId` / `getByTestId` can assert on them.
 */

const baseProps = {
  initialRegion: null,
  pickup: null,
  dropoff: null,
  driver: null,
  selectedRoute: null,
  pickupRoute: null,
  alternativeRoutes: [],
} as const;

describe('Map', () => {
  beforeEach(() => {
    resetMapMockState();
  });

  it('passes PROVIDER_GOOGLE to MapView (Phase 9 turn 1 — iOS Apple Maps Fabric escape)', () => {
    const { getByTestId } = render(<Map {...baseProps} />);
    // The mocked MapView encodes the `provider` prop into its testID, so
    // a regression that flips the provider back to undefined / 'apple' /
    // a Platform-branch surfaces as a missing testID rather than a
    // visual diff.
    expect(getByTestId('map-view-provider-google')).toBeTruthy();
  });

  it('mounts the always-on polyline pool (5 slots) regardless of route props', () => {
    // No routes provided — every slot still mounts with empty coordinates,
    // matching the Phase 3 always-mounted-children invariant. The
    // `getAllByTestId` lookup uses the `len-0` suffix the mock produces.
    const { getAllByTestId } = render(<Map {...baseProps} />);
    expect(getAllByTestId('map-polyline-len-0')).toHaveLength(5);
  });

  it('mounts the always-on marker pool (3 slots) regardless of marker props', () => {
    // No pickup / dropoff / driver provided — every slot still mounts
    // with `opacity={0}` and a dummy coordinate.
    const { getAllByTestId } = render(<Map {...baseProps} />);
    expect(getAllByTestId('map-marker-opacity-0')).toHaveLength(3);
  });

  /**
   * Camera-follow effect (the fix for the "driver home shows the last
   * dropoff location" bug). Three invariants:
   *   1. A non-null `initialRegion` at mount uses MapView's native
   *      `initialRegion` prop — no `animateToRegion` call.
   *   2. A `null → non-null` transition (cold start) animates so the
   *      camera leaves the default world view.
   *   3. A real value change (different lat/lng) animates.
   *   4. A fresh literal with the SAME lat/lng does NOT animate —
   *      otherwise call sites that build `initialRegion` inline on
   *      every render would churn animations continuously.
   */
  describe('camera-follow effect', () => {
    const region = (lat: number, lng: number) => ({
      latitude: lat,
      longitude: lng,
      latitudeDelta: 0.05,
      longitudeDelta: 0.05,
    });

    it('does NOT animate when initialRegion is non-null on first render (native prop handles placement)', () => {
      render(<Map {...baseProps} initialRegion={region(26.1, -80.2)} />);
      expect(animateToRegionCalls).toHaveLength(0);
    });

    it('animates when initialRegion transitions null → non-null (cold start fix)', () => {
      const { rerender } = render(<Map {...baseProps} initialRegion={null} />);
      expect(animateToRegionCalls).toHaveLength(0);

      rerender(<Map {...baseProps} initialRegion={region(26.1, -80.2)} />);
      expect(animateToRegionCalls).toHaveLength(1);
      expect(animateToRegionCalls[0]?.region.latitude).toBeCloseTo(26.1);
      expect(animateToRegionCalls[0]?.region.longitude).toBeCloseTo(-80.2);
    });

    it('animates when initialRegion changes to a different lat/lng post-mount', () => {
      const { rerender } = render(
        <Map {...baseProps} initialRegion={region(26.1, -80.2)} />,
      );
      expect(animateToRegionCalls).toHaveLength(0);

      rerender(<Map {...baseProps} initialRegion={region(26.2, -80.3)} />);
      expect(animateToRegionCalls).toHaveLength(1);
      expect(animateToRegionCalls[0]?.region.latitude).toBeCloseTo(26.2);
      expect(animateToRegionCalls[0]?.region.longitude).toBeCloseTo(-80.3);
    });

    it('does NOT animate when initialRegion is a fresh literal with the same lat/lng', () => {
      const { rerender } = render(
        <Map {...baseProps} initialRegion={region(26.1, -80.2)} />,
      );
      // Re-render with a brand-new object literal at the same coords —
      // approxSamePlace dedupe should suppress the animation.
      rerender(<Map {...baseProps} initialRegion={region(26.1, -80.2)} />);
      expect(animateToRegionCalls).toHaveLength(0);
    });
  });

  /**
   * Driver car-image marker. The driver slot renders a rotating car image
   * (driver "you are here") when `image` is supplied, instead of the
   * default coloured pin. `rotation` (GPS heading) + `flat` face the car
   * along the direction of travel.
   */
  describe('driver car-image marker', () => {
    it('renders the car image at the given coordinate with rotation + flat, KEEPING a fallback pinColor', () => {
      render(
        <Map
          {...baseProps}
          driver={{
            coordinates: coords(26.1297, -80.2654),
            title: 'You are here',
            image: CAR_IMAGE,
            rotation: 137,
            flat: true,
          }}
        />,
      );
      const driver = markerRenders.find((m) => m.image !== undefined);
      expect(driver).toBeTruthy();
      expect(driver?.image).toBe(CAR_IMAGE);
      expect(driver?.rotation).toBe(137);
      expect(driver?.flat).toBe(true);
      // pinColor MUST still be present even though the image overrides it —
      // the native Fabric MarkerManager NPEs on a null pinColor (regression
      // guard for the on-device crash).
      expect(driver?.pinColor).toBe('#f7b731');
      expect(driver?.coordinate).toEqual({
        latitude: 26.1297,
        longitude: -80.2654,
      });
    });

    it('defaults rotation to 0 and flat to true when an image is given without them', () => {
      render(
        <Map
          {...baseProps}
          driver={{ coordinates: coords(26.1, -80.2), image: CAR_IMAGE }}
        />,
      );
      const driver = markerRenders.find((m) => m.image !== undefined);
      expect(driver?.rotation).toBe(0);
      expect(driver?.flat).toBe(true);
    });

    it('falls back to the default cab-yellow pin (pinColor, no image) when no image is supplied', () => {
      render(
        <Map {...baseProps} driver={{ coordinates: coords(26.1, -80.2) }} />,
      );
      const visible = markerRenders.find((m) => m.opacity === 1);
      expect(visible?.image).toBeUndefined();
      expect(visible?.pinColor).toBe('#f7b731');
      expect(visible?.rotation).toBeUndefined();
    });
  });
});
