import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Pressable, Text, TextInput, View } from 'react-native';
import { z } from 'zod';

import {
  EMPTY_MANUAL_VALUES,
  type ManualVehicleFormValues,
} from '../view-models/useVehicleRegistrationViewModel';

interface ManualEntryStepProps {
  readonly initialValues: ManualVehicleFormValues;
  readonly isSubmitting: boolean;
  readonly onSubmit: (values: ManualVehicleFormValues) => void;
}

/**
 * Manual-entry form for vehicle registration. Reaches when NHTSA decode
 * fails (no-match or NetworkError) or when the driver explicitly taps
 * "Enter manually" from the VIN entry step.
 *
 * Field set tracks the legacy form (`yeride/src/driver/screens/VehicleRegistration.js`)
 * minus the licence-plate / colour / insurance fields the rewrite domain
 * model intentionally drops (see Phase 5 Turn 1 Vehicle entity). The
 * remaining fields are exactly what `VehicleClassifier.classifyManual` +
 * `.checkManualEligibility` consume.
 *
 * Chip-pickers for body / seats / doors / fuel mirror the legacy UX: low
 * cardinality, low typing friction, easy to validate with `z.enum`. Make /
 * model / year / trim use freeform inputs.
 *
 * `vehicleSize` only renders when bodyClass === 'sedan' — same as legacy.
 * It feeds the classifier's compact ↔ mid-size distinction.
 */

const BODY_CLASS_OPTIONS = [
  'sedan',
  'SUV',
  'coupe',
  'hatchback',
  'wagon',
  'van',
  'minivan',
  'crossover',
] as const;
const VEHICLE_SIZE_OPTIONS = ['compact', 'mid-size'] as const;
const SEAT_OPTIONS = ['2', '4', '5', '6', '7', '8'] as const;
const DOOR_OPTIONS = ['2', '3', '4', '5'] as const;
const FUEL_OPTIONS = [
  'gasoline',
  'diesel',
  'electric',
  'hybrid',
  'flex-fuel',
] as const;

// All form fields are typed as plain `string` so the schema's inferred
// output type matches `ManualVehicleFormValues` (loose strings). Validation
// at runtime still enforces the enum membership via `refine`, but the
// compile-time form value type stays interchangeable with what the VM
// consumes.
const schema = z
  .object({
    make: z.string().trim().min(1, 'Make is required').max(80),
    model: z.string().trim().min(1, 'Model is required').max(80),
    year: z
      .string()
      .regex(/^\d{4}$/, 'Year must be 4 digits')
      .refine((v) => {
        const n = Number.parseInt(v, 10);
        return Number.isFinite(n) && n >= 1900 && n <= 2100;
      }, 'Year out of range'),
    trim: z.string().max(80),
    bodyClass: z
      .string()
      .refine(
        (v): v is (typeof BODY_CLASS_OPTIONS)[number] =>
          (BODY_CLASS_OPTIONS as readonly string[]).includes(v),
        { message: 'Pick a body class' },
      ),
    vehicleSize: z.string(),
    seats: z
      .string()
      .refine((v) => (SEAT_OPTIONS as readonly string[]).includes(v), {
        message: 'Pick a seat count',
      }),
    doors: z
      .string()
      .refine((v) => (DOOR_OPTIONS as readonly string[]).includes(v), {
        message: 'Pick a door count',
      }),
    fuelType: z
      .string()
      .refine((v) => (FUEL_OPTIONS as readonly string[]).includes(v), {
        message: 'Pick a fuel type',
      }),
  })
  .superRefine((data, ctx) => {
    if (
      data.bodyClass === 'sedan' &&
      !(VEHICLE_SIZE_OPTIONS as readonly string[]).includes(data.vehicleSize)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['vehicleSize'],
        message: 'Pick a sedan size',
      });
    }
  });

// The form's runtime value type is the loose `ManualVehicleFormValues`
// (all strings), not the Zod-narrowed schema output. The resolver still
// validates against the strict schema; the narrowed unions only show up
// in `errors`. This keeps `defaultValues` + `reset` typeable without
// downcasting through `unknown`.
export function ManualEntryStep({
  initialValues,
  isSubmitting,
  onSubmit,
}: ManualEntryStepProps) {
  const {
    control,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors, isValid },
  } = useForm<ManualVehicleFormValues>({
    defaultValues: {
      ...EMPTY_MANUAL_VALUES,
      ...initialValues,
    },
    resolver: zodResolver(schema),
    mode: 'onChange',
  });

  // Reset the form when initialValues change (e.g. user returned to manual
  // after editing a previously-decoded VIN).
  useEffect(() => {
    reset({
      ...EMPTY_MANUAL_VALUES,
      ...initialValues,
    });
  }, [initialValues, reset]);

  const bodyClass = watch('bodyClass');

  const onPressSubmit = handleSubmit((values) => {
    onSubmit(values);
  });

  return (
    <View className="mt-4 rounded-xl bg-card p-4">
      <Text className="mb-3 text-sm font-medium text-foreground">
        Enter vehicle details
      </Text>

      <Controller
        control={control}
        name="make"
        render={({ field }) => (
          <LabeledTextField
            label="Make"
            placeholder="e.g. Toyota"
            value={field.value}
            onChangeText={field.onChange}
            error={errors.make?.message}
            testID="manual-make"
          />
        )}
      />
      <Controller
        control={control}
        name="model"
        render={({ field }) => (
          <LabeledTextField
            label="Model"
            placeholder="e.g. Camry"
            value={field.value}
            onChangeText={field.onChange}
            error={errors.model?.message}
            testID="manual-model"
          />
        )}
      />
      <Controller
        control={control}
        name="year"
        render={({ field }) => (
          <LabeledTextField
            label="Year"
            placeholder="e.g. 2022"
            keyboardType="numeric"
            maxLength={4}
            value={field.value}
            onChangeText={field.onChange}
            error={errors.year?.message}
            testID="manual-year"
          />
        )}
      />
      <Controller
        control={control}
        name="trim"
        render={({ field }) => (
          <LabeledTextField
            label="Trim (optional)"
            placeholder="e.g. SE"
            value={field.value}
            onChangeText={field.onChange}
            error={errors.trim?.message}
            testID="manual-trim"
          />
        )}
      />

      <ChipGroup
        label="Body type"
        options={BODY_CLASS_OPTIONS}
        value={bodyClass}
        onSelect={(v: (typeof BODY_CLASS_OPTIONS)[number]) => {
          setValue('bodyClass', v, { shouldValidate: true });
          // Clear vehicleSize when leaving 'sedan'.
          if (v !== 'sedan') {
            setValue('vehicleSize', '', { shouldValidate: true });
          }
        }}
        error={errors.bodyClass?.message}
        testIdPrefix="manual-body"
      />

      {bodyClass === 'sedan' && (
        <Controller
          control={control}
          name="vehicleSize"
          render={({ field }) => (
            <ChipGroup
              label="Sedan size"
              options={VEHICLE_SIZE_OPTIONS}
              value={field.value}
              onSelect={(v) => field.onChange(v)}
              error={errors.vehicleSize?.message}
              testIdPrefix="manual-size"
            />
          )}
        />
      )}

      <Controller
        control={control}
        name="seats"
        render={({ field }) => (
          <ChipGroup
            label="Seats"
            options={SEAT_OPTIONS}
            value={field.value}
            onSelect={(v) => field.onChange(v)}
            error={errors.seats?.message}
            testIdPrefix="manual-seats"
          />
        )}
      />
      <Controller
        control={control}
        name="doors"
        render={({ field }) => (
          <ChipGroup
            label="Doors"
            options={DOOR_OPTIONS}
            value={field.value}
            onSelect={(v) => field.onChange(v)}
            error={errors.doors?.message}
            testIdPrefix="manual-doors"
          />
        )}
      />
      <Controller
        control={control}
        name="fuelType"
        render={({ field }) => (
          <ChipGroup
            label="Fuel"
            options={FUEL_OPTIONS}
            value={field.value}
            onSelect={(v) => field.onChange(v)}
            error={errors.fuelType?.message}
            testIdPrefix="manual-fuel"
          />
        )}
      />

      <Pressable
        onPress={() => {
          void onPressSubmit();
        }}
        disabled={!isValid || isSubmitting}
        accessibilityRole="button"
        accessibilityState={{ disabled: !isValid || isSubmitting }}
        testID="manual-submit"
        className={`mt-4 items-center rounded-2xl px-4 py-3 ${
          !isValid || isSubmitting ? 'bg-muted' : 'bg-primary'
        }`}
      >
        <Text
          className={`text-base font-semibold ${
            !isValid || isSubmitting
              ? 'text-muted-foreground'
              : 'text-primary-foreground'
          }`}
        >
          {isSubmitting ? 'Registering…' : 'Register vehicle'}
        </Text>
      </Pressable>
    </View>
  );
}

/* ─── helpers ────────────────────────────────────────────────────── */

interface LabeledTextFieldProps {
  readonly label: string;
  readonly placeholder?: string | undefined;
  readonly value: string;
  readonly onChangeText: (next: string) => void;
  readonly error?: string | undefined;
  readonly testID?: string | undefined;
  readonly keyboardType?: 'default' | 'numeric';
  readonly maxLength?: number | undefined;
}

function LabeledTextField({
  label,
  placeholder,
  value,
  onChangeText,
  error,
  testID,
  keyboardType = 'default',
  maxLength,
}: LabeledTextFieldProps) {
  return (
    <View className="mb-3">
      <Text className="mb-1 text-xs uppercase text-muted-foreground">
        {label}
      </Text>
      <TextInput
        testID={testID}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#9ca3af"
        keyboardType={keyboardType}
        maxLength={maxLength}
        autoCorrect={false}
        className={`rounded-lg border px-3 py-2 text-base text-foreground ${
          error !== undefined ? 'border-error' : 'border-border'
        }`}
      />
      {error !== undefined && (
        <Text className="mt-1 text-xs text-error">{error}</Text>
      )}
    </View>
  );
}

interface ChipGroupProps<O extends readonly string[]> {
  readonly label: string;
  readonly options: O;
  readonly value: string;
  readonly onSelect: (value: O[number]) => void;
  readonly error?: string | undefined;
  readonly testIdPrefix: string;
}

function ChipGroup<O extends readonly string[]>({
  label,
  options,
  value,
  onSelect,
  error,
  testIdPrefix,
}: ChipGroupProps<O>) {
  return (
    <View className="mb-3">
      <Text className="mb-1 text-xs uppercase text-muted-foreground">
        {label}
      </Text>
      <View className="flex-row flex-wrap">
        {options.map((opt) => {
          const selected = value === opt;
          return (
            <Pressable
              key={opt}
              onPress={() => onSelect(opt as O[number])}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              testID={`${testIdPrefix}-${opt}`}
              className={`mb-2 mr-2 rounded-full px-3 py-2 ${
                selected ? 'bg-primary' : 'bg-muted'
              }`}
            >
              <Text
                className={`text-sm capitalize ${
                  selected ? 'text-primary-foreground' : 'text-foreground'
                }`}
              >
                {opt}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {error !== undefined && (
        <Text className="text-xs text-error">{error}</Text>
      )}
    </View>
  );
}
