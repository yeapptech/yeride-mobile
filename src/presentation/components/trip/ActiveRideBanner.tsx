import { Pressable, Text, View } from 'react-native';

/**
 * Persistent "you have a live ride" bar shown across the rider/driver
 * bottom tabs while a ride is active. Tapping returns to the monitor.
 *
 * Dumb/presentational: all state (visibility, status label, navigation)
 * is owned by the role-specific banner view-models
 * (`useRiderActiveRideBannerViewModel` / `useDriverActiveRideBannerViewModel`).
 * `topInset` is the safe-area top inset supplied by the mounting
 * navigator so the bar clears the notch; the navigator also zeroes the
 * inset context for the tabs below it so screens don't double-pad.
 */
export interface ActiveRideBannerProps {
  readonly visible: boolean;
  readonly statusLabel: string;
  readonly onReturn: () => void;
  readonly topInset: number;
}

export function ActiveRideBanner({
  visible,
  statusLabel,
  onReturn,
  topInset,
}: ActiveRideBannerProps) {
  if (!visible) return null;
  return (
    <Pressable
      testID="active-ride-banner"
      accessibilityRole="button"
      accessibilityLabel={`${statusLabel}. Tap to return to your ride.`}
      onPress={onReturn}
      style={{ paddingTop: topInset }}
      className="bg-primary active:opacity-80"
    >
      <View className="flex-row items-center justify-between px-4 py-2">
        <View className="flex-row items-center">
          <View
            testID="active-ride-banner-dot"
            className="mr-2 h-2 w-2 rounded-full bg-primary-foreground"
          />
          <Text className="text-sm font-semibold text-primary-foreground">
            {statusLabel}
          </Text>
        </View>
        <Text className="text-sm font-medium text-primary-foreground">
          Return ›
        </Text>
      </View>
    </Pressable>
  );
}
