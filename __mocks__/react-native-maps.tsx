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

export const PROVIDER_GOOGLE = 'google';

const MapView = ({ provider, children, testID }: MapViewProps) => (
  <View testID={testID ?? `map-view-provider-${provider ?? 'undefined'}`}>
    {children}
  </View>
);

export const Polyline = ({ coordinates }: PolylineProps) => (
  <View testID={`map-polyline-len-${(coordinates ?? []).length}`} />
);

export const Marker = ({ opacity }: MarkerProps) => (
  <View testID={`map-marker-opacity-${opacity ?? 1}`} />
);

// `Region` is a TypeScript-only export in the real package — TS reads
// the real `.d.ts` via moduleResolution, so an empty value here is
// fine. Re-exported as `unknown` to satisfy any wildcard re-import.
export type Region = {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
};

export default MapView;
