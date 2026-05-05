import Svg, { G, Path, Rect } from 'react-native-svg';

/**
 * Visa card-brand glyph, hand-authored for Phase 9 Turn 13.
 *
 * Trace target: legacy yeride's `assets/visa.png`. Captures the
 * Visa wordmark on a navy background — the navy + yellow accent
 * combination is Visa's primary brand color signature, and the
 * stylized "V" + bar reads as the wordmark at receipt-row sizes
 * even when individual letterforms are below the rendering
 * threshold.
 *
 * viewBox 0 0 60 40 matches the 3:2 aspect of the badge size
 * records (sm 28x18 / md 36x22 / lg 48x30) so the glyph fills
 * the parent without distortion.
 */
export default function Visa({
  width,
  height,
}: {
  readonly width: number;
  readonly height: number;
}) {
  return (
    <Svg width={width} height={height} viewBox="0 0 60 40">
      {/* Navy card body (#1A1F71 — Visa's primary blue) */}
      <Rect x="0" y="0" width="60" height="40" rx="4" fill="#1A1F71" />
      {/* Stylized VISA wordmark approximation in white */}
      <G>
        {/* V */}
        <Path
          d="M 10 14 L 13 26 L 16 26 L 19 14 L 16 14 L 14.5 22 L 13 14 Z"
          fill="#FFFFFF"
        />
        {/* I (slanted i) */}
        <Path d="M 21 14 L 24 14 L 22 26 L 19 26 Z" fill="#FFFFFF" />
        {/* S */}
        <Path
          d="M 26 17 Q 26 14 30 14 L 33 14 L 32.5 16.5 L 30 16.5 Q 28.5 16.5 28.5 17.5 Q 28.5 18.5 30 19 L 31 19.5 Q 33 20.5 33 22.5 Q 33 26 28.5 26 L 25 26 L 25.5 23.5 L 28.5 23.5 Q 30 23.5 30 22.5 Q 30 21.5 28.5 21 L 27.5 20.5 Q 26 19.5 26 17 Z"
          fill="#FFFFFF"
        />
        {/* A */}
        <Path
          d="M 38 14 L 41 14 L 44 26 L 41 26 L 40.5 24 L 37.5 24 L 37 26 L 34 26 Z M 38 22 L 40 22 L 39 17.5 Z"
          fill="#FFFFFF"
        />
      </G>
      {/* Yellow accent bar (Visa's secondary brand color) */}
      <Rect x="6" y="30" width="48" height="3" fill="#F7B600" />
    </Svg>
  );
}
