import {
  ActivityIndicator,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';

import { formatMoney } from '@presentation/utils/formatMoney';

import {
  TIP_PRESETS,
  type TipFlowState,
  type TipFlowErrorKind,
  type TipPresetMinorUnits,
} from '../view-models/useTipFlowViewModel';

/**
 * Inline tip prompt mounted on `RideReceiptScreen` between the fare
 * breakdown and the Payment placeholder. Pure prop-driven over
 * `useTipFlowViewModel`'s `state` — every interaction routes through the
 * VM's callbacks, no internal state.
 *
 * Layout:
 *   ┌────────────────────────────────────────────┐
 *   │ Tip your driver                            │
 *   │ ┌────┐ ┌────┐ ┌────┐ ┌────────┐            │
 *   │ │ $1 │ │ $3 │ │ $5 │ │ Custom │            │
 *   │ └────┘ └────┘ └────┘ └────────┘            │
 *   │ (custom-mode only:)                        │
 *   │ $ [____] (number-pad, maxLength=2)         │
 *   │                                             │
 *   │ (error band, dismissible)                   │
 *   │                                             │
 *   │ ┌────────────────────────────────────────┐ │
 *   │ │            Tip $X (or spinner)         │ │
 *   │ └────────────────────────────────────────┘ │
 *   └────────────────────────────────────────────┘
 *
 * `'submitted'` swaps the body for a "Tip $X added — thank you!" strip
 * until the live `tipPayment` row lands and the parent VM's next render
 * flips state to `'hidden'`.
 *
 * `'hidden'` returns `null`.
 */
export function TipSelector({ state }: { readonly state: TipFlowState }) {
  if (state.kind === 'hidden') {
    return null;
  }

  if (state.kind === 'submitted') {
    return (
      <View
        testID="tip-selector-submitted"
        className="mx-4 my-2 rounded-2xl border border-success/40 bg-success/10 px-4 py-4"
      >
        <Text className="text-center text-base font-medium text-success">
          Tip {formatMoney(state.tipAmount)} added — thank you!
        </Text>
      </View>
    );
  }

  // From here on we render the form. All four remaining arms (idle /
  // selected / submitting / error) share the chip layout.
  const isSubmitting = state.kind === 'submitting';
  const isFormArm =
    state.kind === 'idle' ||
    state.kind === 'selected' ||
    state.kind === 'error';
  const isCustom = isFormArm ? state.isCustom : false;
  const customText = isFormArm ? state.customText : '';
  const selectedPresetMinor = isFormArm ? state.selectedPresetMinor : null;
  const tipAmount =
    state.kind === 'selected' ||
    state.kind === 'submitting' ||
    (state.kind === 'error' && state.tipAmount !== null)
      ? state.tipAmount
      : null;
  const submitDisabled = !tipAmount || isSubmitting;

  return (
    <View
      testID="tip-selector"
      className="mx-4 my-2 rounded-2xl border border-border bg-card px-4 py-4"
    >
      <Text className="text-base font-semibold text-foreground">
        Tip your driver
      </Text>
      <Text className="mt-0.5 text-xs text-muted-foreground">
        Optional — tipping is never required.
      </Text>

      <View className="mt-3 flex-row" testID="tip-selector-presets">
        {TIP_PRESETS.map((minorUnits) => (
          <PresetChip
            key={minorUnits}
            minorUnits={minorUnits}
            selected={!isCustom && selectedPresetMinor === minorUnits}
            disabled={isSubmitting || !isFormArm}
            onPress={() => {
              if (isFormArm) state.onSelectPreset(minorUnits);
            }}
          />
        ))}
        <CustomChip
          selected={isCustom}
          disabled={isSubmitting || !isFormArm}
          onPress={() => {
            if (isFormArm) state.onSelectCustom();
          }}
        />
      </View>

      {isCustom ? (
        <View className="mt-3 flex-row items-center rounded-xl border border-border bg-muted px-3">
          <Text className="mr-2 text-base text-muted-foreground">$</Text>
          <TextInput
            testID="tip-selector-custom-input"
            value={customText}
            onChangeText={(text) => {
              if (isFormArm) state.onCustomAmountChange(text);
            }}
            editable={!isSubmitting && isFormArm}
            placeholder="Enter amount (1–99)"
            keyboardType="number-pad"
            maxLength={2}
            className="flex-1 py-3 text-base text-foreground"
            accessibilityLabel="Custom tip amount in whole dollars"
          />
        </View>
      ) : null}

      {state.kind === 'error' ? (
        <View
          testID="tip-selector-error"
          className="mt-3 rounded-xl border border-error/40 bg-error/10 px-3 py-2"
        >
          <Text className="text-sm text-error">
            {errorCopy(state.error.kind, state.error.message)}
          </Text>
          <Pressable
            testID="tip-selector-error-dismiss"
            accessibilityRole="button"
            onPress={state.onDismissError}
            className="mt-1 self-end"
          >
            <Text className="text-xs font-medium text-error">Dismiss</Text>
          </Pressable>
        </View>
      ) : null}

      <Pressable
        testID="tip-selector-submit"
        accessibilityRole="button"
        accessibilityState={{ disabled: submitDisabled }}
        disabled={submitDisabled}
        onPress={() => {
          if (state.kind === 'selected' || state.kind === 'error') {
            state.onSubmit();
          }
        }}
        className={`mt-4 items-center rounded-xl px-4 py-3 ${
          submitDisabled ? 'bg-muted' : 'bg-primary'
        }`}
      >
        {isSubmitting ? (
          <ActivityIndicator
            color="white"
            testID="tip-selector-submit-spinner"
          />
        ) : (
          <Text
            className={`text-base font-semibold ${
              submitDisabled
                ? 'text-muted-foreground'
                : 'text-primary-foreground'
            }`}
          >
            {tipAmount ? `Tip ${formatMoney(tipAmount)}` : 'Tip your driver'}
          </Text>
        )}
      </Pressable>
    </View>
  );
}

function PresetChip({
  minorUnits,
  selected,
  disabled,
  onPress,
}: {
  readonly minorUnits: TipPresetMinorUnits;
  readonly selected: boolean;
  readonly disabled: boolean;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      testID={`tip-selector-preset-${minorUnits}`}
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      className={`mr-2 flex-1 items-center rounded-xl border px-2 py-3 ${
        selected ? 'border-primary bg-primary' : 'border-border bg-muted'
      }`}
    >
      <Text
        className={`text-sm font-semibold ${
          selected ? 'text-primary-foreground' : 'text-foreground'
        }`}
      >
        ${minorUnits / 100}
      </Text>
    </Pressable>
  );
}

function CustomChip({
  selected,
  disabled,
  onPress,
}: {
  readonly selected: boolean;
  readonly disabled: boolean;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      testID="tip-selector-preset-custom"
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      className={`flex-1 items-center rounded-xl border px-2 py-3 ${
        selected ? 'border-primary bg-primary' : 'border-border bg-muted'
      }`}
    >
      <Text
        className={`text-sm font-semibold ${
          selected ? 'text-primary-foreground' : 'text-foreground'
        }`}
      >
        Custom
      </Text>
    </Pressable>
  );
}

function errorCopy(kind: TipFlowErrorKind, fallback: string): string {
  switch (kind) {
    case 'validation':
      return 'We couldn’t add this tip — the trip may not be ready yet. Please try again in a moment.';
    case 'network':
      return 'Connection trouble — your tip didn’t go through. Please try again.';
    case 'unauthorized':
      return 'We couldn’t verify your account. Please sign in and try again.';
    case 'unknown':
    default:
      return (
        fallback ||
        'Something went wrong. Please try again or come back to this trip later.'
      );
  }
}
