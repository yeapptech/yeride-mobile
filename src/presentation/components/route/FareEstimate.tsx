import { Text, View } from 'react-native';

import type { Money } from '@domain/entities/Money';

/**
 * Pre-trip fare display. The legacy yeride `calculateRangeFare` returned a
 * single number (the "range" was a vestige of a commented-out `fare *
 * 1.19` upper bound), so this component renders one number — `$X.YY` —
 * not a min-max. If product wants an explicit range later, this is the
 * single place to extend.
 *
 * Rendering rule:
 *   - Show "—" when `fare` is null. Used by RouteSelect rows that haven't
 *     resolved a fare yet (e.g. ride-service tier whose snapshot doesn't
 *     have valid pricing).
 *   - Cents are always shown ("$8.00", not "$8") so the column visually
 *     aligns across rows in the ride-service list.
 */
interface FareEstimateProps {
  readonly fare: Money | null;
}

export function FareEstimate({ fare }: FareEstimateProps) {
  if (!fare) {
    return (
      <Text className="text-base font-medium text-muted-foreground">—</Text>
    );
  }
  return (
    <View>
      <Text className="text-base font-semibold text-foreground">
        {formatMoney(fare)}
      </Text>
    </View>
  );
}

function formatMoney(money: Money): string {
  // Money's CurrencyCode union is currently `'USD'`-only. Hot path stays
  // explicit so it doesn't pay the `Intl.NumberFormat` init cost; if a
  // second currency lands, branch here.
  return `$${money.majorUnits.toFixed(2)}`;
}
