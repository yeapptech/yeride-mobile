import Svg, { Circle, Rect } from 'react-native-svg';

/**
 * Diners Club card-brand glyph, hand-authored for Phase 9 Turn 13.
 *
 * Trace target: legacy yeride's `assets/diners-club.png`. The
 * canonical Diners Club mark is two interlocking discs — the
 * left half navy blue, the right half a lighter blue, separated
 * by a thin white line. Reads cleanly at sm (28x18) without
 * text.
 *
 * viewBox 0 0 60 40 matches the 3:2 aspect of the badge size
 * records.
 */
export default function Diners({
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
      {/* Outer disc (Diners Club blue #0079BE) */}
      <Circle cx="30" cy="20" r="13" fill="#0079BE" />
      {/* Inner white wedge that creates the interlocking-discs
       * effect — a vertical white stripe through the disc */}
      <Rect x="29" y="7" width="2" height="26" fill="#FFFFFF" />
      {/* Inner blue inset on the left to suggest the second disc */}
      <Circle cx="26" cy="20" r="8" fill="#FFFFFF" />
      <Circle cx="26" cy="20" r="6" fill="#0079BE" />
      <Circle cx="34" cy="20" r="8" fill="#FFFFFF" />
      <Circle cx="34" cy="20" r="6" fill="#0079BE" />
    </Svg>
  );
}
