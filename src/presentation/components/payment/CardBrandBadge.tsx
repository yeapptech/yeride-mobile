import type { ComponentType } from 'react';
import { View } from 'react-native';

import type { CardBrand } from '@domain/entities/PaymentMethod';

import Amex from './assets/svg/Amex';
import Diners from './assets/svg/Diners';
import Discover from './assets/svg/Discover';
import GenericCard from './assets/svg/GenericCard';
import Mastercard from './assets/svg/Mastercard';
import Visa from './assets/svg/Visa';

/**
 * Card-brand glyph rendered on the rider Wallet rows AND the
 * RideReceipt payment row.
 *
 * Phase 9 Turn 7 extracted this from `WalletCardRow`'s inline
 * `BrandBadge` so the receipt screen could reuse the same surface.
 *
 * Phase 9 Turn 13 flipped the rendering pipeline from PNG `<Image>`
 * to per-brand SVG components via `react-native-svg@15.15.3`. SVG
 * glyphs are resolution-independent — they render crisply at 1x /
 * 2x / 3x display densities and at the reserved `'lg'` 48x30 size
 * without re-exporting from a higher-DPI source. The legacy PNG
 * assets in `./assets/` are orphaned (sandbox virtiofs blocks
 * `unlink()`); they can be removed in any non-sandbox checkout.
 *
 * `react-native-svg@15.15.3` ships a complete
 * `codegenConfig.ios.componentProvider` block in its own
 * `package.json` covering all 28 Fabric components — no plugin
 * patch is required (unlike Phase 9 Turn 1's react-native-maps
 * escape). A fresh `npm run prebuild` IS required before the next
 * iOS / Android build so the auto-linked native module gets
 * included.
 *
 * Brand-to-glyph table:
 *   - visa / mastercard / amex / discover / diners → branded SVG
 *   - jcb / unionpay / unknown → GenericCard SVG (matches legacy
 *     `getPaymentMethodImage`'s `default:` arm — now SVG-rendered
 *     instead of falling through to a PNG, so the entire pipeline
 *     is uniformly SVG)
 *
 * Sizes:
 *   - `'sm'` (28x18) — wallet row inline; same footprint as the prior
 *     text-only `BrandBadge`'s 12x9 nominal box
 *   - `'md'` (36x22) — receipt payment row; slightly larger so the
 *     brand reads as a header element rather than an inline tag
 *   - `'lg'` (48x30) — reserved for future surfaces (ManageCard
 *     screen, AddPaymentMethod confirmation)
 *
 * Accessibility: the badge is decorative (the brand text + last-4
 * line is the readable surface). The outer `<View/>` carries no
 * accessibility role; SVG children are not announced by screen
 * readers by default.
 */

export type CardBrandBadgeSize = 'sm' | 'md' | 'lg';

export interface CardBrandBadgeProps {
  readonly brand: CardBrand;
  readonly size?: CardBrandBadgeSize;
}

type BrandGlyph = ComponentType<{
  readonly width: number;
  readonly height: number;
}>;

const BRAND_GLYPHS: Record<CardBrand, BrandGlyph> = {
  visa: Visa,
  mastercard: Mastercard,
  amex: Amex,
  discover: Discover,
  diners: Diners,
  jcb: GenericCard,
  unionpay: GenericCard,
  unknown: GenericCard,
};

const SIZE_DIMENSIONS: Record<
  CardBrandBadgeSize,
  { readonly width: number; readonly height: number }
> = {
  sm: { width: 28, height: 18 },
  md: { width: 36, height: 22 },
  lg: { width: 48, height: 30 },
};

export function CardBrandBadge(props: CardBrandBadgeProps) {
  const size = props.size ?? 'sm';
  const dims = SIZE_DIMENSIONS[size];
  const Glyph = BRAND_GLYPHS[props.brand];
  return (
    <View
      // Outer container keeps the glyph from being squished by parent
      // flex layouts; explicit width/height matches the SVG viewBox
      // proportions (3:2 aspect across all brands).
      style={{ width: dims.width, height: dims.height }}
      testID={`card-brand-badge-${props.brand}`}
    >
      <Glyph width={dims.width} height={dims.height} />
    </View>
  );
}

/**
 * Format a `CardBrand` for human display next to the badge — e.g.
 * "Visa", "Mastercard", "Amex". Falls through to "Card" for the
 * `unknown` brand. Used by both `WalletCardRow` and the
 * `RideReceiptScreen` payment row.
 */
export function formatBrand(brand: CardBrand): string {
  switch (brand) {
    case 'visa':
      return 'Visa';
    case 'mastercard':
      return 'Mastercard';
    case 'amex':
      return 'Amex';
    case 'discover':
      return 'Discover';
    case 'diners':
      return 'Diners';
    case 'jcb':
      return 'JCB';
    case 'unionpay':
      return 'UnionPay';
    case 'unknown':
      return 'Card';
  }
}
