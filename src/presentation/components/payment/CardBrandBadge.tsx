import { Image, View, type ImageSourcePropType } from 'react-native';

import type { CardBrand } from '@domain/entities/PaymentMethod';

import amex from './assets/amex.png';
import card from './assets/card.png';
import diners from './assets/diners-club.png';
import discover from './assets/discover.png';
import mastercard from './assets/mastercard.png';
import visa from './assets/visa.png';

/**
 * Card-brand glyph rendered on the rider Wallet rows AND the
 * RideReceipt payment row.
 *
 * Phase 9 Turn 7 extracted this from `WalletCardRow`'s inline
 * `BrandBadge` so the receipt screen could reuse the same surface.
 *
 * Glyph format: PNG. Legacy yeride's brand-mark assets ported into
 * `./assets/`; same source, same visual fidelity. No new native deps,
 * no native rebuild required. Per-brand SVG glyphs (option that would
 * have required `react-native-svg`) deferred — would have triggered a
 * Fabric componentProvider patch mirroring Phase 9 Turn 1's
 * `react-native-maps` work, and the visual outcome at receipt-row
 * size is the same.
 *
 * Brand-to-asset table:
 *   - visa / mastercard / amex / discover / diners → branded glyph
 *   - jcb / unionpay / unknown → generic `card.png` fallback
 *     (matches legacy `getPaymentMethodImage`'s `default:` arm)
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
 * line is the readable surface). `accessible={false}` prevents
 * screen readers from describing the image redundantly.
 */

export type CardBrandBadgeSize = 'sm' | 'md' | 'lg';

export interface CardBrandBadgeProps {
  readonly brand: CardBrand;
  readonly size?: CardBrandBadgeSize;
}

const BRAND_ASSETS: Record<CardBrand, ImageSourcePropType> = {
  visa,
  mastercard,
  amex,
  discover,
  diners,
  jcb: card,
  unionpay: card,
  unknown: card,
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
  const source = BRAND_ASSETS[props.brand];
  return (
    <View
      // Outer container keeps the glyph from being squished by parent
      // flex layouts; explicit width/height matches the asset's
      // intrinsic proportions.
      style={{ width: dims.width, height: dims.height }}
      testID={`card-brand-badge-${props.brand}`}
    >
      <Image
        source={source}
        accessible={false}
        resizeMode="contain"
        style={{ width: dims.width, height: dims.height }}
      />
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
