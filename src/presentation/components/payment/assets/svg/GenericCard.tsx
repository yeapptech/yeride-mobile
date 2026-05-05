import Svg, { Path, Rect } from 'react-native-svg';

/**
 * Generic card-brand fallback glyph, hand-authored for Phase 9
 * Turn 13.
 *
 * Trace target: legacy yeride's `assets/card.png`. Used when the
 * card brand is `jcb`, `unionpay`, or `unknown` — same fallback
 * arm the legacy `getPaymentMethodImage` carried.
 *
 * Visual: neutral grey card body with a gold chip outline (the
 * EMV chip is the universally-recognized "this is a credit card"
 * signal across fintech UIs) and two horizontal grey bars
 * suggesting card-number digits.
 *
 * viewBox 0 0 60 40 matches the 3:2 aspect of the badge size
 * records.
 */
export default function GenericCard({
  width,
  height,
}: {
  readonly width: number;
  readonly height: number;
}) {
  return (
    <Svg width={width} height={height} viewBox="0 0 60 40">
      {/* Card body — slate grey */}
      <Rect x="0" y="0" width="60" height="40" rx="4" fill="#5A6772" />
      {/* EMV chip outline — gold-toned rounded rect with internal
       * grid lines suggesting the chip contact pads */}
      <Rect x="6" y="13" width="12" height="10" rx="1.5" fill="#D4A55F" />
      <Path
        d="M 12 13 L 12 23 M 6 18 L 18 18"
        stroke="#8B6F35"
        strokeWidth="0.8"
        fill="none"
      />
      {/* Card number lines — two thin horizontal bars suggesting
       * card-number digits */}
      <Rect x="6" y="28" width="20" height="2" rx="0.5" fill="#9AA5AF" />
      <Rect x="30" y="28" width="20" height="2" rx="0.5" fill="#9AA5AF" />
    </Svg>
  );
}
