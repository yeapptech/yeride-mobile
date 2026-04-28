import { Text, View } from 'react-native';

import type { Endpoint } from '@domain/entities/Endpoint';

/**
 * Two-line read-only display of a pickup or dropoff endpoint. Used on
 * RouteSelectScreen at the top of the screen and on RideMonitor's
 * Awaiting/Dispatched/Started views (turn 3.4).
 *
 * When `placeName` is set, line 1 is the place name and line 2 is the
 * address. When it's not, line 1 is the address and line 2 is hidden.
 *
 * `kind` toggles the colour and label of the leading dot:
 *   - 'pickup'  → primary (gold)
 *   - 'dropoff' → error (red)
 */
interface EndpointSummaryProps {
  readonly endpoint: Endpoint | null;
  readonly kind: 'pickup' | 'dropoff';
  /** Override the leading label text. Defaults to "Pickup" / "Dropoff". */
  readonly label?: string;
  /** Render placeholder text when the endpoint is null. */
  readonly placeholder?: string;
}

export function EndpointSummary({
  endpoint,
  kind,
  label,
  placeholder,
}: EndpointSummaryProps) {
  const headerLabel = label ?? (kind === 'pickup' ? 'Pickup' : 'Dropoff');
  const dotClass = kind === 'pickup' ? 'bg-primary' : 'bg-error';

  if (!endpoint) {
    return (
      <View className="flex-row items-start gap-3 py-3">
        <View className={`mt-1 h-3 w-3 rounded-full ${dotClass} opacity-30`} />
        <View className="flex-1">
          <Text className="text-xs uppercase text-muted-foreground">
            {headerLabel}
          </Text>
          <Text className="text-base text-muted-foreground">
            {placeholder ?? 'Not set'}
          </Text>
        </View>
      </View>
    );
  }

  const placeName = endpoint.placeName;
  return (
    <View className="flex-row items-start gap-3 py-3">
      <View className={`mt-1 h-3 w-3 rounded-full ${dotClass}`} />
      <View className="flex-1">
        <Text className="text-xs uppercase text-muted-foreground">
          {headerLabel}
        </Text>
        {placeName ? (
          <>
            <Text className="text-base font-semibold text-foreground">
              {placeName}
            </Text>
            <Text
              className="text-sm text-muted-foreground"
              numberOfLines={1}
              ellipsizeMode="tail"
            >
              {endpoint.address}
            </Text>
          </>
        ) : (
          <Text
            className="text-base text-foreground"
            numberOfLines={2}
            ellipsizeMode="tail"
          >
            {endpoint.address}
          </Text>
        )}
      </View>
    </View>
  );
}
