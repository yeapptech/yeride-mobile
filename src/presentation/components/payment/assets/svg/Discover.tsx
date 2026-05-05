import Svg, { Circle, G, Path, Rect } from 'react-native-svg';

/**
 * Discover card-brand glyph, hand-authored for Phase 9 Turn 13.
 *
 * Trace target: legacy yeride's `assets/discover.png`. The
 * iconic Discover mark is the orange-on-black "DISCOVER" wordmark
 * with the spherical orange "O" ligature. At receipt-row sizes
 * the simplification is: white card body, dark grey "DISCOVER"
 * approximation, prominent orange disc on the right side.
 *
 * viewBox 0 0 60 40 matches the 3:2 aspect of the badge size
 * records.
 */
export default function Discover({
  width,
  height,
}: {
  readonly width: number;
  readonly height: number;
}) {
  return (
    <Svg width={width} height={height} viewBox="0 0 60 40">
      {/* White card body */}
      <Rect x="0" y="0" width="60" height="40" rx="4" fill="#FFFFFF" />
      {/* Dark grey card outline */}
      <Rect
        x="0.5"
        y="0.5"
        width="59"
        height="39"
        rx="3.5"
        fill="none"
        stroke="#E0E0E0"
        strokeWidth="0.5"
      />
      {/* "DISCOVER"-approximation rendered as a horizontal bar of
       * dark text-like marks (simplified letterforms) */}
      <G>
        <Path
          d="M 6 18 L 8 18 L 8 22 L 6 22 Z M 9 18 L 11 18 L 11 22 L 9 22 Z M 12 18 L 14 18 L 14 22 L 12 22 Z M 15 18 L 17 18 L 17 22 L 15 22 Z M 18 18 L 20 18 L 20 22 L 18 22 Z M 21 18 L 23 18 L 23 22 L 21 22 Z"
          fill="#231F20"
        />
      </G>
      {/* Iconic orange disc (Discover's signature orange ball) */}
      <Circle cx="44" cy="20" r="10" fill="#FF6000" />
      {/* Highlight on the disc to give it depth at small sizes */}
      <Circle cx="41" cy="17" r="3" fill="#FF8533" opacity="0.6" />
    </Svg>
  );
}
