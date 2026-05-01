/**
 * Slim ambient types for `react-native-maps` 1.24.0.
 *
 * Why this file exists: 1.24.0 publishes its .tsx source as `main` (no
 * compiled .d.ts), so when our Map component imports `react-native-maps`,
 * TypeScript tries to type-check the package's source under our strict
 * `exactOptionalPropertyTypes` settings — and the package's source isn't
 * authored to that bar (200+ errors across Geojson, Heatmap, MapWMSTile,
 * etc., none of which we touch). `skipLibCheck` doesn't help because the
 * package ships .ts, not .d.ts.
 *
 * Workaround: `tsconfig.json` `paths` redirects every `'react-native-maps'`
 * import at TYPE-CHECK time to this file. Metro and Jest's module
 * resolvers don't consume tsconfig.paths, so runtime resolution still
 * finds the real package. The shim declares only what `Map.tsx`
 * consumes — extend it as more primitives land in future map components.
 *
 * Remove this shim when react-native-maps ships compiled types or fixes
 * its source under exactOptionalPropertyTypes.
 */

import type { ComponentType, ReactNode, RefObject } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';

export interface LatLng {
  latitude: number;
  longitude: number;
}

export interface Region extends LatLng {
  latitudeDelta: number;
  longitudeDelta: number;
}

export interface MapViewProps {
  style?: StyleProp<ViewStyle>;
  initialRegion?: Region;
  region?: Region;
  provider?: 'google' | undefined;
  showsCompass?: boolean;
  showsUserLocation?: boolean;
  onRegionChangeComplete?: (region: Region) => void;
  onPress?: (event: { nativeEvent: { coordinate: LatLng } }) => void;
  children?: ReactNode;
  ref?: RefObject<MapViewMethods>;
}

export interface MapViewMethods {
  animateToRegion: (region: Region, duration?: number) => void;
  fitToCoordinates: (
    coordinates: readonly LatLng[],
    options?: {
      edgePadding?: {
        top: number;
        right: number;
        bottom: number;
        left: number;
      };
      animated?: boolean;
    },
  ) => void;
}

export interface MarkerProps {
  coordinate: LatLng;
  title?: string;
  description?: string;
  pinColor?: string;
  opacity?: number;
  anchor?: { x: number; y: number };
  tracksViewChanges?: boolean;
  children?: ReactNode;
}

export interface PolylineProps {
  coordinates: readonly LatLng[];
  strokeColor?: string;
  strokeWidth?: number;
  lineDashPattern?: readonly number[];
  lineCap?: 'butt' | 'round' | 'square';
}

declare const MapView: ComponentType<MapViewProps>;
export default MapView;

export const Marker: ComponentType<MarkerProps>;
export const Polyline: ComponentType<PolylineProps>;

// Provider constants (Phase 9 turn 1: rewrite forces PROVIDER_GOOGLE on
// both platforms to escape the iOS Apple Maps Fabric registration
// regression). Mirror the runtime export from
// `node_modules/react-native-maps/src/ProviderConstants.ts`.
export const PROVIDER_GOOGLE: 'google';
export const PROVIDER_DEFAULT: undefined;
