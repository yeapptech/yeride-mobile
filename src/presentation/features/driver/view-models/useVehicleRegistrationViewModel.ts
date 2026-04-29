import { useNavigation } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { RegisterVehicleArgs } from '@app/usecases/vehicle/RegisterVehicle';
import type { RideServiceId } from '@domain/entities/RideServiceId';
import type { Vehicle } from '@domain/entities/Vehicle';
import type { VehicleClass } from '@domain/entities/VehicleClass';
import { Vin } from '@domain/entities/Vin';
import {
  type AuthorizationError,
  type ConflictError,
  type NotFoundError,
  ValidationError,
} from '@domain/errors';
import { VehicleClassifier, type VinDecodeResult } from '@domain/services';
import type { DriverStackNavigation } from '@presentation/navigation/types';
import {
  useRegisterVehicleMutation,
  useVinDecodeQuery,
} from '@presentation/queries';
import { LOG } from '@shared/logger';

const logger = LOG.extend('VehicleRegistrationVM');

/**
 * View-model for `VehicleRegistrationScreen`.
 *
 * Owns a tagged-union state machine driving the multi-step form:
 *
 *   { kind: 'idle' }                       — initial; user hasn't typed a complete VIN
 *   { kind: 'decoding', vin }              — VIN parsed; useVinDecodeQuery in flight
 *   { kind: 'decoded', decoded }           — NHTSA returned data; preview ready
 *   { kind: 'manual', initialValues? }     — user is filling out manual fields
 *   { kind: 'submitting' }                 — RegisterVehicle mutation in flight
 *   { kind: 'submitted', vehicle }         — registration succeeded; screen pops back
 *   { kind: 'error', error }               — submit failed (Conflict, Auth, Validation)
 *
 * Flow:
 *   1. User types in the VIN field. The VM debounces input by 400ms,
 *      attempts `Vin.create(...)` on each stable value, and only triggers
 *      `useVinDecodeQuery` when the parse succeeds.
 *   2. On `Result.ok(decoded)` → flip to `'decoded'`.
 *      On `Result.ok(null)` or `NetworkError` → flip to `'manual'` so the
 *      user can fill in the form (no separate "Decode failed" toast — the
 *      manual-entry mode IS the recovery).
 *   3. From `'decoded'`: tap "Confirm & register" → submit; tap "Edit
 *      manually" → flip to `'manual'` with the decoded values pre-seeded.
 *   4. From `'manual'`: submit runs the form values through the classifier
 *      (`VehicleClassifier.classifyManual` + `.checkManualEligibility`
 *      + `.computeEligibleServices`) and calls `RegisterVehicle`.
 *   5. `Conflict('vehicle_already_exists')` → `{ kind: 'error', error }`
 *      with a friendly inline banner; user can change the VIN or cancel.
 *
 * Debouncing: a single `setTimeout` ref. 400ms matches the kickoff
 * decision and is plenty for typing. Tests can use `jest.useFakeTimers()`
 * to run the decode synchronously.
 */

export interface ManualVehicleFormValues {
  readonly make: string;
  readonly model: string;
  /** Year as a string from the form input; parsed at submit time. */
  readonly year: string;
  readonly trim: string;
  readonly bodyClass: string;
  /** Only consulted when `bodyClass === 'sedan'`. */
  readonly vehicleSize: string;
  /** Seats as a string; parsed at submit. */
  readonly seats: string;
  /** Doors as a string; parsed at submit. */
  readonly doors: string;
  readonly fuelType: string;
}

export const EMPTY_MANUAL_VALUES: ManualVehicleFormValues = {
  make: '',
  model: '',
  year: '',
  trim: '',
  bodyClass: '',
  vehicleSize: '',
  seats: '',
  doors: '',
  fuelType: '',
};

export type RegistrationState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'decoding'; readonly vin: Vin }
  | { readonly kind: 'decoded'; readonly decoded: VinDecodeResult }
  | {
      readonly kind: 'manual';
      readonly initialValues: ManualVehicleFormValues;
      readonly fromDecodedVin: Vin | null;
    }
  | { readonly kind: 'submitting' }
  | { readonly kind: 'submitted'; readonly vehicle: Vehicle }
  | {
      readonly kind: 'error';
      readonly error:
        | AuthorizationError
        | NotFoundError
        | ConflictError
        | ValidationError;
    };

export interface UseVehicleRegistrationViewModel {
  readonly state: RegistrationState;
  /** Raw VIN input (uppercased). Drives the debounce + decode pipeline. */
  readonly vinInput: string;
  setVinInput: (value: string) => void;
  /** Manual transition: user taps "Enter manually" from the VIN entry step. */
  enterManual: () => void;
  /** From `'decoded'`: user taps "Edit manually" to override decoded data. */
  editManually: () => void;
  /** From `'decoded'`: confirm the decoded values and submit. */
  confirmDecoded: () => void;
  /** From `'manual'`: submit the form values. */
  submitManual: (values: ManualVehicleFormValues) => void;
  /** Cancel the registration entirely → pop back to the list. */
  cancel: () => void;
  /** Reset back to `'idle'` (used by the inline "VIN already registered" banner). */
  resetToIdle: () => void;
}

const DEBOUNCE_MS = 400;

export function useVehicleRegistrationViewModel(): UseVehicleRegistrationViewModel {
  const navigation = useNavigation<DriverStackNavigation>();
  const queryClient = useQueryClient();
  const registerMutation = useRegisterVehicleMutation();

  const [vinInput, setVinInputRaw] = useState<string>('');
  const [debouncedVinString, setDebouncedVinString] = useState<string>('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Track the registration state explicitly. `idle` / `manual` / `submitting`
  // / `submitted` / `error` are all VM-driven. `decoding` and `decoded`
  // mirror the underlying decode query's status — but we model them
  // explicitly here so the screen renders off the union, not raw query
  // booleans.
  const [state, setState] = useState<RegistrationState>({ kind: 'idle' });

  /* ─── debounce → Vin parse → query ───────────────────────────────── */

  const setVinInput = useCallback((value: string) => {
    const upper = value.toUpperCase();
    setVinInputRaw(upper);
    if (debounceRef.current !== null) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      setDebouncedVinString(upper);
    }, DEBOUNCE_MS);
  }, []);

  // Clear the debounce timer on unmount so the test renderer doesn't
  // emit a "Cannot update a component that has unmounted" warning.
  useEffect(() => {
    return () => {
      if (debounceRef.current !== null) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  // Try to parse the debounced value as a Vin. Only triggers the query
  // when the parse succeeds (17-char + check-digit pass).
  const parsedVin = useMemo(() => {
    if (debouncedVinString.length !== 17) return null;
    const r = Vin.create(debouncedVinString);
    return r.ok ? r.value : null;
  }, [debouncedVinString]);

  // Hold off on querying once we've already left the `idle`/`decoding`
  // states. If the user hits "Edit manually" we shouldn't keep the decode
  // alive — it'll stomp the manual state on emit.
  const decodeEnabled =
    parsedVin !== null &&
    (state.kind === 'idle' ||
      state.kind === 'decoding' ||
      state.kind === 'decoded');

  const decodeQuery = useVinDecodeQuery(decodeEnabled ? parsedVin : null);

  /* ─── state transitions driven by query status ───────────────────── */

  // Move into 'decoding' as soon as we have a parsed VIN and we're still
  // in `idle`. The `decoded` and `manual` transitions land via the query's
  // success / no-match / error effects below.
  useEffect(() => {
    if (parsedVin === null) return;
    setState((prev) => {
      if (prev.kind === 'idle') {
        return { kind: 'decoding', vin: parsedVin };
      }
      return prev;
    });
  }, [parsedVin]);

  // Bridge the query's terminal outcomes into the state machine:
  //   - data === VinDecodeResult → 'decoded'
  //   - data === null  (no-match)→ 'manual' (with `fromDecodedVin` set so we
  //                                  know which VIN to attach on submit)
  //   - error  (NetworkError)    → 'manual' (same UX)
  useEffect(() => {
    if (!decodeEnabled) return;
    if (decodeQuery.isLoading || decodeQuery.isFetching) return;

    if (decodeQuery.isSuccess) {
      const decoded = decodeQuery.data;
      if (decoded) {
        setState({ kind: 'decoded', decoded });
      } else {
        setState({
          kind: 'manual',
          fromDecodedVin: parsedVin,
          initialValues: EMPTY_MANUAL_VALUES,
        });
      }
    } else if (decodeQuery.isError) {
      logger.warn('decode failed; falling back to manual', decodeQuery.error);
      setState({
        kind: 'manual',
        fromDecodedVin: parsedVin,
        initialValues: EMPTY_MANUAL_VALUES,
      });
    }
  }, [
    decodeEnabled,
    decodeQuery.data,
    decodeQuery.error,
    decodeQuery.isError,
    decodeQuery.isFetching,
    decodeQuery.isLoading,
    decodeQuery.isSuccess,
    parsedVin,
  ]);

  /* ─── transitions driven by user actions ─────────────────────────── */

  const enterManual = useCallback(() => {
    setState({
      kind: 'manual',
      fromDecodedVin: parsedVin,
      initialValues: EMPTY_MANUAL_VALUES,
    });
  }, [parsedVin]);

  const editManually = useCallback(() => {
    setState((prev) => {
      if (prev.kind !== 'decoded') return prev;
      const d = prev.decoded;
      return {
        kind: 'manual',
        fromDecodedVin: d.vin,
        initialValues: {
          make: d.make,
          model: d.model,
          year: String(d.year),
          trim: d.trim ?? '',
          bodyClass: d.bodyClass ?? '',
          vehicleSize: '',
          seats: d.seats !== null ? String(d.seats) : '',
          doors: d.doors !== null ? String(d.doors) : '',
          fuelType: d.specs.engine?.fuelType ?? '',
        },
      };
    });
  }, []);

  const submitDecoded = useCallback(
    (decoded: VinDecodeResult) => {
      setState({ kind: 'submitting' });
      const args: RegisterVehicleArgs = {
        vin: decoded.vin,
        make: decoded.make,
        model: decoded.model,
        year: decoded.year,
        vehicleClass: decoded.vehicleClass,
        eligibleServices: decoded.eligibleServices,
        dataSource: 'vin_decoded',
        trim: decoded.trim,
        bodyClass: decoded.bodyClass,
        seats: decoded.seats,
        doors: decoded.doors,
        stockPhoto: decoded.stockPhoto,
        specs: decoded.specs,
      };
      registerMutation.mutate(args, {
        onSuccess: (vehicle) => {
          setState({ kind: 'submitted', vehicle });
          navigation.goBack();
        },
        onError: (error) => {
          setState({ kind: 'error', error });
        },
      });
    },
    [navigation, registerMutation],
  );

  const confirmDecoded = useCallback(() => {
    if (state.kind !== 'decoded') return;
    submitDecoded(state.decoded);
  }, [state, submitDecoded]);

  const submitManual = useCallback(
    (values: ManualVehicleFormValues) => {
      if (state.kind !== 'manual') return;

      // Parse the year + counts. The Zod schema in the screen validates
      // these client-side, but the VM is the seam where strings cross
      // into the domain — re-parse defensively.
      const year = Number.parseInt(values.year, 10);
      const seats =
        values.seats.length > 0 ? Number.parseInt(values.seats, 10) : null;
      const doors =
        values.doors.length > 0 ? Number.parseInt(values.doors, 10) : null;

      if (!Number.isFinite(year)) {
        setState({
          kind: 'error',
          error: new ValidationError({
            code: 'vehicle_register_year_invalid',
            message: 'Year must be a 4-digit number',
            field: 'year',
          }),
        });
        return;
      }

      // Resolve the VIN. Manual flow only allows submission when we have
      // a parsed VIN already (the form is reachable only after the user
      // typed something that parsed). `fromDecodedVin` carries forward.
      const vin = state.fromDecodedVin;
      if (vin === null) {
        setState({
          kind: 'error',
          error: new ValidationError({
            code: 'vehicle_register_vin_missing',
            message: 'A valid VIN is required to register',
            field: 'vin',
          }),
        });
        return;
      }

      const vehicleClass: VehicleClass = VehicleClassifier.classifyManual({
        make: values.make,
        bodyClass: values.bodyClass,
        vehicleSize: values.vehicleSize.length > 0 ? values.vehicleSize : null,
        seats,
      });
      const isEligible = VehicleClassifier.checkManualEligibility({
        year,
        bodyClass: values.bodyClass,
        doors,
        seats,
      });
      const eligibleServices: readonly RideServiceId[] =
        VehicleClassifier.computeEligibleServices(vehicleClass, isEligible);

      setState({ kind: 'submitting' });

      // Build VehicleSpecs piecewise so `exactOptionalPropertyTypes` doesn't
      // complain about `engine: undefined` / `dimensions: undefined`. Same
      // pattern `NhtsaVinDecoderService.extractSpecs` uses.
      const specs: VinDecodeResult['specs'] = {};
      if (values.fuelType.length > 0) {
        (specs as { engine: { fuelType: string } }).engine = {
          fuelType: values.fuelType,
        };
      }
      const dimensions: { seats?: number; doors?: number } = {};
      if (seats !== null) dimensions.seats = seats;
      if (doors !== null) dimensions.doors = doors;
      if (Object.keys(dimensions).length > 0) {
        (specs as { dimensions: typeof dimensions }).dimensions = dimensions;
      }

      const args: RegisterVehicleArgs = {
        vin,
        make: values.make,
        model: values.model,
        year,
        vehicleClass,
        eligibleServices,
        dataSource: 'manual_entry',
        trim: values.trim.length > 0 ? values.trim : null,
        bodyClass: values.bodyClass.length > 0 ? values.bodyClass : null,
        seats,
        doors,
        // Manual entry doesn't fetch a stock photo (Phase 5 Turn 3 locked
        // decision 2). Drivers upload their own photos in Turn 4.
        stockPhoto: null,
        specs,
      };
      registerMutation.mutate(args, {
        onSuccess: (vehicle) => {
          setState({ kind: 'submitted', vehicle });
          navigation.goBack();
        },
        onError: (error) => {
          setState({ kind: 'error', error });
        },
      });
    },
    [state, navigation, registerMutation],
  );

  const cancel = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  const resetToIdle = useCallback(() => {
    setVinInputRaw('');
    setDebouncedVinString('');
    if (debounceRef.current !== null) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    // Drop any cached decode so a re-typed VIN re-fires.
    queryClient.removeQueries({ queryKey: ['vehicle', 'decode'] });
    setState({ kind: 'idle' });
  }, [queryClient]);

  return {
    state,
    vinInput,
    setVinInput,
    enterManual,
    editManually,
    confirmDecoded,
    submitManual,
    cancel,
    resetToIdle,
  };
}

export type { VinDecodeResult } from '@domain/services';
