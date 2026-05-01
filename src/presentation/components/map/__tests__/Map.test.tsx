import { render } from '@testing-library/react-native';

import { Map } from '../Map';

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
});
