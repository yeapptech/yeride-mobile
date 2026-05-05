import Svg, { Circle, Path, Rect } from 'react-native-svg';

/**
 * Mastercard card-brand glyph, hand-authored for Phase 9 Turn 13.
 *
 * Trace target: legacy yeride's `assets/mastercard.png`. Captures
 * the iconic interlocking-circles mark — red on the left, yellow
 * on the right, with the lens-shaped overlap rendered in orange
 * via a Path that approximates the intersection. Reads cleanly
 * at sm (28x18) without text.
 *
 * viewBox 0 0 60 40 matches the 3:2 aspect of the badge size
 * records.
 */
export default function Mastercard({
  width,
  height,
}: {
  readonly width: number;
  readonly height: number;
}) {
  return (
    <Svg width={width} height={height} viewBox="0 0 60 40">
      {/* Light card body so the circles read on any parent background */}
      <Rect x="0" y="0" width="60" height="40" rx="4" fill="#FFFFFF" />
      {/* Red circle (left) */}
      <Circle cx="24" cy="20" r="11" fill="#EB001B" />
      {/* Yellow circle (right) */}
      <Circle cx="36" cy="20" r="11" fill="#F79E1B" />
      {/* Orange lens-shaped overlap (intersection of the two circles).
       * Approximated as a Path with two arcs meeting at the top and
       * bottom of the overlap zone. */}
      <Path
        d="M 30 11 A 11 11 0 0 1 30 29 A 11 11 0 0 1 30 11 Z"
        fill="#FF5F00"
      />
    </Svg>
  );
}
