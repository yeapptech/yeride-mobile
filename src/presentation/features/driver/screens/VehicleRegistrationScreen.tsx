import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DecodedPreviewStep } from '../components/DecodedPreviewStep';
import { ManualEntryStep } from '../components/ManualEntryStep';
import { VinEntryStep } from '../components/VinEntryStep';
import {
  EMPTY_MANUAL_VALUES,
  useVehicleRegistrationViewModel,
} from '../view-models/useVehicleRegistrationViewModel';

/**
 * `VehicleRegistrationScreen` — driver registers a new vehicle.
 *
 * The screen body is a switch on `vm.state.kind`:
 *
 *   idle / decoding              → just the VIN entry step
 *   decoded                      → VIN entry + decoded-preview step
 *   manual                       → VIN entry + manual-entry form
 *   submitting / submitted       → spinner overlay (the VM pops back on
 *                                  success, so 'submitted' is briefly
 *                                  rendered before unmount)
 *   error                        → VIN entry + an inline banner with the
 *                                  error message; user can change the VIN
 *                                  or cancel
 *
 * The component does not call any use cases or queries directly — it
 * routes everything through the view-model.
 */
export default function VehicleRegistrationScreen() {
  const vm = useVehicleRegistrationViewModel();

  const isSubmitting = vm.state.kind === 'submitting';
  const showVinStep =
    vm.state.kind !== 'submitting' && vm.state.kind !== 'submitted';

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1"
      >
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: 64 }}
          keyboardShouldPersistTaps="handled"
        >
          <View className="mb-3">
            <Text className="text-xl font-semibold text-foreground">
              Register a vehicle
            </Text>
            <Text className="mt-1 text-xs text-muted-foreground">
              Enter your VIN and we&apos;ll auto-fill from NHTSA. If we
              can&apos;t decode it, you can fill in details manually.
            </Text>
          </View>

          {showVinStep && (
            <VinEntryStep
              value={vm.vinInput}
              onChangeText={vm.setVinInput}
              stateKind={vm.state.kind}
              onEnterManual={vm.enterManual}
            />
          )}

          {vm.state.kind === 'decoded' && (
            <DecodedPreviewStep
              decoded={vm.state.decoded}
              isSubmitting={false}
              onConfirm={vm.confirmDecoded}
              onEditManually={vm.editManually}
            />
          )}

          {vm.state.kind === 'manual' && (
            <ManualEntryStep
              initialValues={vm.state.initialValues ?? EMPTY_MANUAL_VALUES}
              isSubmitting={false}
              onSubmit={vm.submitManual}
            />
          )}

          {vm.state.kind === 'error' && (
            <View
              className="mt-4 rounded-lg border border-error/30 bg-error/10 p-3"
              testID="registration-error-banner"
            >
              <Text className="text-sm font-semibold text-error">
                {errorTitleFor(vm.state.error)}
              </Text>
              <Text className="mt-1 text-xs text-muted-foreground">
                {vm.state.error.message}
              </Text>
              <Pressable
                onPress={vm.resetToIdle}
                accessibilityRole="button"
                testID="registration-error-reset"
                className="mt-3 self-start rounded-lg border border-border px-3 py-2"
              >
                <Text className="text-sm text-foreground">
                  Start over with a different VIN
                </Text>
              </Pressable>
            </View>
          )}

          {isSubmitting && (
            <View
              className="mt-4 flex-row items-center justify-center rounded-xl bg-card p-4"
              testID="registration-submitting"
            >
              <ActivityIndicator size="small" />
              <Text className="ml-2 text-sm text-foreground">
                Registering vehicle…
              </Text>
            </View>
          )}

          <Pressable
            onPress={vm.cancel}
            accessibilityRole="button"
            testID="registration-cancel"
            className="mt-4 self-center px-4 py-3"
          >
            <Text className="text-sm text-muted-foreground">Cancel</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function errorTitleFor(error: { code: string }): string {
  switch (error.code) {
    case 'vehicle_already_exists':
      return 'This VIN is already registered';
    case 'auth_no_current_user':
      return "You're signed out — sign in again to register a vehicle";
    case 'vehicle_register_role_not_driver':
      return 'Only drivers can register vehicles';
    default:
      return 'Could not register vehicle';
  }
}
