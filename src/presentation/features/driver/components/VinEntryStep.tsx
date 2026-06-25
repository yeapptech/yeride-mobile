import {
  ActivityIndicator,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';

interface VinEntryStepProps {
  readonly value: string;
  readonly onChangeText: (next: string) => void;
  readonly stateKind:
    | 'idle'
    | 'decoding'
    | 'decoded'
    | 'manual'
    | 'submitting'
    | 'submitted'
    | 'error';
  readonly onEnterManual: () => void;
}

/**
 * VIN input step. The view-model owns the debounce + decode trigger; this
 * component just renders the text input plus inline status indicators.
 *
 * Status indicators are derived from `stateKind`:
 *   - `'idle'`        → 17-char counter; no progress
 *   - `'decoding'`    → small spinner + "Decoding…" copy
 *   - `'decoded'`     → green checkmark text — we keep the input visible
 *                       so the user can see the VIN as part of the
 *                       confirmation context above the preview.
 *   - others          → input disabled (subordinate steps own the surface)
 *
 * "Enter manually" CTA is rendered unconditionally below the input. It
 * becomes the recovery path when the driver knows NHTSA won't decode their
 * VIN (e.g. fleet vehicle with a non-public VIN).
 */
export function VinEntryStep({
  value,
  onChangeText,
  stateKind,
  onEnterManual,
}: VinEntryStepProps) {
  const inputDisabled = stateKind === 'submitting' || stateKind === 'submitted';

  return (
    <View className="rounded-xl bg-card p-4">
      <Text className="mb-1 text-sm font-medium text-foreground">
        VIN (Vehicle Identification Number)
      </Text>
      <TextInput
        testID="vin-input"
        value={value}
        onChangeText={onChangeText}
        editable={!inputDisabled}
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={17}
        placeholder="17-character VIN"
        placeholderTextColor="#9ca3af"
        className="rounded-lg border border-border px-3 py-3 text-base text-foreground"
      />

      <View className="mt-2 flex-row items-center justify-between">
        <Text className="text-xs text-muted-foreground">{value.length}/17</Text>
        <DecodeIndicator stateKind={stateKind} />
      </View>

      <Pressable
        onPress={onEnterManual}
        accessibilityRole="button"
        testID="vin-enter-manually"
        className="mt-3 self-start"
      >
        <Text className="text-sm text-brand-deep">Enter manually instead</Text>
      </Pressable>
    </View>
  );
}

function DecodeIndicator({
  stateKind,
}: {
  readonly stateKind: VinEntryStepProps['stateKind'];
}) {
  if (stateKind === 'decoding') {
    return (
      <View className="flex-row items-center">
        <ActivityIndicator size="small" />
        <Text className="ml-2 text-xs text-muted-foreground">
          Decoding VIN…
        </Text>
      </View>
    );
  }
  if (stateKind === 'decoded') {
    return (
      <Text className="text-xs text-success" testID="vin-decoded-indicator">
        VIN decoded
      </Text>
    );
  }
  if (stateKind === 'manual') {
    return (
      <Text className="text-xs text-warning" testID="vin-manual-indicator">
        Manual entry
      </Text>
    );
  }
  return null;
}
