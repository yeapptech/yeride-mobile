/**
 * Manual Jest mock for `react-native-svg`. Auto-discovered by Jest
 * because this file's path matches `<rootDir>/__mocks__/<package>`.
 *
 * The real package exports Fabric view-managers (`RNSVGSvgView`,
 * `RNSVGPath`, `RNSVGRect`, ...) that fail to load outside a live RN
 * runtime. We replace each primitive with a simple `<View/>`-based
 * passthrough that renders its `children` so the rendered tree
 * remains queryable via `getByTestId`.
 *
 * Lives as a manual mock (not an inline `jest.mock` factory in
 * `jest.setup.ts`) because the NativeWind babel plugin wraps every
 * component referencing `View` in a CSS-interop helper that closes
 * over a file-scope `_ReactNativeCSSInterop` binding. Inline
 * `jest.mock` factories are hoisted above all file-scope bindings,
 * so the factory body would reference an out-of-scope variable. A
 * regular module file binds correctly. Mirrors the
 * `__mocks__/react-native-maps.tsx` pattern from Phase 9 Turn 1.
 *
 * Each export is a `jest.fn()` so tests can assert via reference
 * identity:
 *
 *   import { Svg, Path } from 'react-native-svg';
 *   render(<CardBrandBadge brand="visa" />);
 *   expect(Svg).toHaveBeenCalled();
 *   expect(Path).toHaveBeenCalled();
 *
 * Tests that need to clear invocations between renders call
 * `(Svg as unknown as jest.Mock).mockClear()` (or rely on Jest's
 * `clearMocks: true` config).
 */

import * as React from 'react';
import { View } from 'react-native';

type PassthroughProps = {
  readonly children?: React.ReactNode;
  readonly testID?: string;
};

const makePassthrough = (
  displayName: string,
): jest.Mock<React.ReactElement, [PassthroughProps]> => {
  const fn = jest.fn(({ children, ...props }: PassthroughProps) =>
    React.createElement(View, props as Record<string, unknown>, children),
  );
  (fn as unknown as { displayName: string }).displayName = displayName;
  return fn;
};

export const Svg = makePassthrough('Svg');
export const Path = makePassthrough('Path');
export const Rect = makePassthrough('Rect');
export const Circle = makePassthrough('Circle');
export const Ellipse = makePassthrough('Ellipse');
export const Line = makePassthrough('Line');
export const Polygon = makePassthrough('Polygon');
export const Polyline = makePassthrough('Polyline');
export const G = makePassthrough('G');
export const Text = makePassthrough('Text');
export const TSpan = makePassthrough('TSpan');
export const Defs = makePassthrough('Defs');
export const LinearGradient = makePassthrough('LinearGradient');
export const RadialGradient = makePassthrough('RadialGradient');
export const Stop = makePassthrough('Stop');
export const ClipPath = makePassthrough('ClipPath');
export const Mask = makePassthrough('Mask');
export const Pattern = makePassthrough('Pattern');
export const Symbol = makePassthrough('Symbol');
export const Use = makePassthrough('Use');

export default Svg;
