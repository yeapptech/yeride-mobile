/**
 * Manual Jest mock for `react-native-maps`. Auto-discovered by Jest
 * because this file's path matches `<rootDir>/__mocks__/<package>`.
 *
 * The real package exports native view-managers that fail to load
 * outside a live RN runtime (`AIRMap`, `AIRGoogleMap`). We replace
 * `MapView` / `Marker` / `Polyline` with simple host views that encode
 * the props we care about into `testID`s, so render-tree queries can
 * assert on them.
 *
 * `PROVIDER_GOOGLE` mirrors the real value from
 * `node_modules/react-native-maps/src/ProviderConstants.ts` — the literal
 * string `'google'`.
 *
 * `MapView` is exported as a `forwardRef` host so consumers can grab a
 * ref (the production `<Map>` component does this for the camera-follow
 * effect). The exposed ref handle implements `animateToRegion`, which
 * appends every call to the module-level `animateToRegionCalls` array.
 * Tests can import that array to assert that the camera moved (or
 * didn't move) in response to a prop change, without coupling to a
 * spy/snapshot pattern. The array is cleared per-test by
 * `resetMapMockState()`.
 *
 * Lives as a manual mock (not an inline `jest.mock` factory) because the
 * NativeWind babel plugin wraps every component in a CSS-interop helper
 * that closes over a file-scope `_ReactNativeCSSInterop` binding. Inline
 * `jest.mock` factories are hoisted above all file-scope bindings, so
 * the factory body would reference an out-of-scope variable. A regular
 * module file binds correctly.
 *
 * If a consumer test needs a different shape (e.g. simulating a render
 * error or capturing a region change), override per-test via
 * `jest.spyOn` on the relevant export, or rebind via
 * `jest.doMock('react-native-maps', () => ...)` BEFORE requiring the
 * module under test.
 */

import { forwardRef, useImperativeHandle } from 'react';
import { View } from 'react-native';

type MapViewProps = {
  readonly provider?: string;
  readonly children?: React.ReactNode;
  readonly testID?: string;
};

type PolylineProps = {
  readonly coordinates?: ReadonlyArray<{
    latitude: number;
    longitude: number;
  }>;
};

type MarkerProps = {
  readonly opacity?: number;
  readonly children?: React.ReactNode;
};

export type Region = {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
};

export interface MapViewHandle {
  animateToRegion: (region: Region, durationMs?: number) => void;
}

export const PROVIDER_GOOGLE = 'google';

/**
 * Module-level capture of every `animateToRegion` call made via a
 * MapView ref. Tests should call `resetMapMockState()` in `beforeEach`
 * (or rely on `jest.resetModules()`) to start from a clean slate.
 */
export const animateToRegionCalls: Array<{
  region: Region;
  durationMs?: number;
}> = [];

export function resetMapMockState(): void {
  animateToRegionCalls.length = 0;
}

const MapView = forwardRef<MapViewHandle, MapViewProps>(
  ({ provider, children, testID }, ref) => {
    useImperativeHandle(
      ref,
      () => ({
        animateToRegion: (region: Region, durationMs?: number) => {
          animateToRegionCalls.push(
            durationMs === undefined ? { region } : { region, durationMs },
          );
        },
      }),
      [],
    );
    return (
      <View testID={testID ?? `map-view-provider-${provider ?? 'undefined'}`}>
        {children}
      </View>
    );
  },
);
MapView.displayName = 'MapView';

export const Polyline = ({ coordinates }: PolylineProps) => (
  <View testID={`map-polyline-len-${(coordinates ?? []).length}`} />
);

export const Marker = ({ opacity }: MarkerProps) => (
  <View testID={`map-marker-opacity-${opacity ?? 1}`} />
);

export default MapView;
