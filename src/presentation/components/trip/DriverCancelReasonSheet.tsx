import { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  CancellationReason,
  type CancellationReasonCode,
} from '@domain/entities/CancellationReason';

/**
 * Modal sheet asking the driver to confirm a cancellation and pick a
 * reason. Mirror of the rider-side `CancelReasonSheet` but gated on the
 * driver-allowed code set (via `CancellationReason.isDriverCode`):
 * `'driver_no_show'` is filtered out (a driver can't cancel for their own
 * no-show); `'passenger_no_show'` is added (driver-only code that's the
 * natural choice when the rider isn't at the pickup).
 *
 * Why a `Modal` instead of `@gorhom/bottom-sheet`: the parent
 * `DriverMonitorScreen` already hosts a bottom-sheet; nesting two
 * bottom-sheets is fragile in react-native-gesture-handler. `Modal` is the
 * simplest cross-platform primitive that respects edge-to-edge (legacy
 * CLAUDE.md note: pass `statusBarTranslucent` + `navigationBarTranslucent`
 * or the backdrop won't extend under the system bars on Android 15).
 *
 * The sheet does NOT call the cancel mutation — the parent owns it. The
 * sheet only assembles a `CancellationReason` value object and hands it
 * back via `onConfirm`. This keeps the sheet reusable across early-status
 * (en-route / at-pickup) and started views, each of which can capture a
 * different odometer / surface different copy on submit.
 */

const DRIVER_ALLOWED_CODES: readonly {
  code: CancellationReasonCode;
  label: string;
  description: string;
}[] = [
  {
    code: 'changed_mind',
    label: "I can't take this ride",
    description: "Something came up — I can't take this trip.",
  },
  {
    code: 'passenger_no_show',
    label: "Rider didn't show",
    description: "I waited at the pickup but the rider didn't appear.",
  },
  {
    code: 'vehicle_malfunction',
    label: 'Vehicle issue',
    description: 'My vehicle is having a problem.',
  },
  {
    code: 'vehicle_accident',
    label: 'Accident',
    description: 'A collision or roadside incident occurred.',
  },
  {
    code: 'safety_concerns',
    label: 'Safety concern',
    description: "I don't feel safe completing this trip.",
  },
  {
    code: 'other',
    label: 'Other',
    description: 'Tell us what happened.',
  },
];

interface DriverCancelReasonSheetProps {
  readonly visible: boolean;
  readonly isSubmitting?: boolean;
  readonly errorMessage?: string | null;
  readonly onClose: () => void;
  readonly onConfirm: (reason: CancellationReason) => void | Promise<void>;
}

export function DriverCancelReasonSheet({
  visible,
  isSubmitting,
  errorMessage,
  onClose,
  onConfirm,
}: DriverCancelReasonSheetProps) {
  const [selected, setSelected] = useState<CancellationReasonCode | null>(null);
  const [reasonText, setReasonText] = useState<string>('');

  const trimmedText = reasonText.trim();
  const otherTextValid = selected === 'other' ? trimmedText.length > 0 : true;
  const canConfirm = selected !== null && otherTextValid && !isSubmitting;

  const handleConfirm = (): void => {
    if (!selected) return;
    const r = CancellationReason.create({
      code: selected,
      reasonText: selected === 'other' ? trimmedText : null,
    });
    if (!r.ok) return;
    void onConfirm(r.value);
  };

  const handleClose = (): void => {
    setSelected(null);
    setReasonText('');
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      // legacy CLAUDE.md: pass these or the backdrop won't extend under
      // the system bars on Android 15 edge-to-edge.
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={handleClose}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Dismiss"
        onPress={handleClose}
        className="flex-1 bg-foreground/40"
      >
        {/* Inner card. We give it an explicit no-op `onPress` so that
            (a) in production, touch events that land on the card area
            don't bubble up to the outer dismiss Pressable on RN, and
            (b) in @testing-library/react-native's `fireEvent.press`, the
            press is absorbed at this Pressable instead of walking up to
            the dismiss handler that would reset internal state. */}
        <Pressable
          className="mt-auto rounded-t-3xl bg-card p-4"
          onPress={() => undefined}
        >
          <View className="self-center mb-3 h-1 w-12 rounded-full bg-border" />
          <Text className="mb-1 text-lg font-semibold text-foreground">
            Cancel ride
          </Text>
          <Text className="mb-3 text-sm text-muted-foreground">
            Pick a reason so we can improve.
          </Text>

          {DRIVER_ALLOWED_CODES.map((opt) => {
            const isSelected = selected === opt.code;
            return (
              <Pressable
                key={opt.code}
                onPress={() => setSelected(opt.code)}
                accessibilityRole="radio"
                accessibilityState={{ selected: isSelected }}
                className={`mb-2 rounded-xl border px-4 py-3 ${
                  isSelected ? 'border-primary bg-primary/10' : 'border-border'
                }`}
                testID={`driver-cancel-reason-${opt.code}`}
              >
                <Text className="text-base font-medium text-foreground">
                  {opt.label}
                </Text>
                <Text className="text-xs text-muted-foreground">
                  {opt.description}
                </Text>
              </Pressable>
            );
          })}

          {selected === 'other' && (
            <View className="mt-1">
              <Text className="mb-1 text-xs uppercase text-muted-foreground">
                Tell us more
              </Text>
              <TextInput
                value={reasonText}
                onChangeText={setReasonText}
                multiline
                placeholder="Describe what happened…"
                placeholderTextColor="#9ca3af"
                className="rounded-lg border border-border px-3 py-2 text-foreground"
                style={{ minHeight: 64 }}
                testID="driver-cancel-reason-other-text"
              />
            </View>
          )}

          {errorMessage && (
            <Text
              className="mt-3 text-sm text-error"
              testID="driver-cancel-reason-error"
            >
              {errorMessage}
            </Text>
          )}

          <View className="mt-4 flex-row gap-3">
            <Pressable
              onPress={handleClose}
              disabled={isSubmitting}
              accessibilityRole="button"
              accessibilityState={{ disabled: isSubmitting }}
              className={`flex-1 items-center rounded-xl bg-muted px-4 py-3 ${
                isSubmitting ? 'opacity-50' : ''
              }`}
              testID="driver-cancel-reason-keep"
            >
              <Text className="text-base font-semibold text-foreground">
                Keep ride
              </Text>
            </Pressable>
            <Pressable
              onPress={handleConfirm}
              disabled={!canConfirm}
              accessibilityRole="button"
              accessibilityState={{ disabled: !canConfirm }}
              className={`flex-1 items-center rounded-xl px-4 py-3 ${
                canConfirm ? 'bg-error' : 'bg-muted'
              }`}
              testID="driver-cancel-reason-confirm"
            >
              {isSubmitting ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <Text
                  className={`text-base font-semibold ${
                    canConfirm ? 'text-white' : 'text-muted-foreground'
                  }`}
                >
                  Cancel ride
                </Text>
              )}
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
