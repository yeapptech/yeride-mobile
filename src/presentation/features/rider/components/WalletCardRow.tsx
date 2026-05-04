import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import type { CardBrand, PaymentMethod } from '@domain/entities/PaymentMethod';
import type { PaymentMethodId } from '@domain/entities/PaymentMethodId';
import {
  CardBrandBadge,
  formatBrand,
} from '@presentation/components/payment/CardBrandBadge';

/**
 * One row in the rider Wallet list.
 *
 * Layout (left to right):
 *   [brand badge]  [BRAND •••• last4 · MM/YY?]      [✓ default? ]  [trash]
 *
 * The brand badge renders a per-brand PNG glyph (Phase 9 Turn 7
 * extracted the inline `BrandBadge` text-only component into the
 * shared `CardBrandBadge` so the receipt screen could reuse it).
 *
 * Tap on the row body fires `onSetDefault` (toggling default on this
 * card). The trash button fires `onDelete`. The default-card row still
 * has the trash visible — `useWalletViewModel.onDelete` pops a different
 * Alert variant when the user tries to remove the default-and-only card.
 *
 * Per-row in-flight tracking comes from the parent: when
 * `isSetDefaultInFlight` is true the row body shows a spinner and the
 * tap is suppressed; same shape for `isDetachInFlight` on the trash
 * button.
 */

export interface WalletCardRowProps {
  readonly method: PaymentMethod;
  readonly isDefault: boolean;
  readonly isSetDefaultInFlight: boolean;
  readonly isDetachInFlight: boolean;
  readonly onSetDefault: (paymentMethodId: PaymentMethodId) => void;
  readonly onDelete: (paymentMethodId: PaymentMethodId) => void;
}

export function WalletCardRow(props: WalletCardRowProps) {
  const { method, isDefault, isSetDefaultInFlight, isDetachInFlight } = props;

  const expiryText = formatExpiry(method.expiry);
  const brandLabel = formatBrand(method.brand);

  return (
    <View
      testID={`wallet-row-${String(method.id)}`}
      className="flex-row items-center rounded-2xl border border-border bg-card px-4 py-3"
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Set ${brandLabel} ending in ${method.last4} as default`}
        disabled={isSetDefaultInFlight || isDefault}
        onPress={() => props.onSetDefault(method.id)}
        testID={`wallet-row-tap-${String(method.id)}`}
        className="flex-1 flex-row items-center"
      >
        <BrandBadge brand={method.brand} />
        <View className="ml-3 flex-1">
          <Text className="text-base font-medium text-foreground">
            {brandLabel} •••• {method.last4}
            {expiryText !== null ? ` · ${expiryText}` : ''}
          </Text>
          {isDefault ? (
            <Text className="mt-0.5 text-xs font-medium text-primary">
              Default
            </Text>
          ) : null}
        </View>
        {isSetDefaultInFlight ? (
          <ActivityIndicator
            size="small"
            testID="wallet-row-set-default-spinner"
          />
        ) : isDefault ? (
          <Text className="text-base font-semibold text-primary">✓</Text>
        ) : null}
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Remove ${brandLabel} ending in ${method.last4}`}
        disabled={isDetachInFlight}
        onPress={() => props.onDelete(method.id)}
        testID={`wallet-row-trash-${String(method.id)}`}
        className="ml-3 h-9 w-9 items-center justify-center rounded-full"
      >
        {isDetachInFlight ? (
          <ActivityIndicator size="small" testID="wallet-row-trash-spinner" />
        ) : (
          <Text className="text-lg text-muted-foreground">🗑</Text>
        )}
      </Pressable>
    </View>
  );
}

function BrandBadge({ brand }: { readonly brand: CardBrand }) {
  // Wraps the shared `CardBrandBadge` in the same h-9 w-12 muted-bg
  // pill the wallet rows have always carried, so the row layout stays
  // pixel-stable across the Phase 9 Turn 7 refactor.
  return (
    <View className="h-9 w-12 items-center justify-center rounded-md bg-muted">
      <CardBrandBadge brand={brand} size="sm" />
    </View>
  );
}

/**
 * Format expiry as `MM/YY`. Null when the server didn't expose expiry —
 * the row hides the suffix entirely in that case.
 */
function formatExpiry(
  expiry: { readonly month: number; readonly year: number } | null,
): string | null {
  if (expiry === null) return null;
  const mm = String(expiry.month).padStart(2, '0');
  const yy = String(expiry.year).slice(-2);
  return `${mm}/${yy}`;
}
