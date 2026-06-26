/**
 * Ambient module declarations for static image assets bundled via Metro.
 *
 * Metro (runtime) and the `jest-expo` preset (tests) both resolve
 * `import x from './foo.png'` to an asset reference. This declaration gives
 * those imports a type under our strict tsconfig. The project shipped no
 * bundled image assets before the driver-car marker, so no `expo-env.d.ts`
 * (which would otherwise reference `expo/types`' image declarations) was
 * ever generated — this slim shim covers what we use.
 */
declare module '*.png' {
  import type { ImageSourcePropType } from 'react-native';

  const content: ImageSourcePropType;
  export default content;
}
