import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import type { RegisterVehicleArgs } from '@app/usecases/vehicle/RegisterVehicle';
import type { Vehicle } from '@domain/entities/Vehicle';
import type { Vin } from '@domain/entities/Vin';
import type {
  AuthorizationError,
  ConflictError,
  NetworkError,
  NotFoundError,
  ValidationError,
} from '@domain/errors';
import type { VinDecodeResult } from '@domain/services';
import { useUseCases } from '@presentation/di';

import { queryKeys } from './keys';

/**
 * Vehicle-management queries + mutations. Subscriptions for the driver's
 * list are intentionally NOT here: `useVehicleListViewModel` reaches for
 * `useFirestoreSubscription` directly because `ListDriverVehicles` exposes
 * a `.subscribe(...)` shape rather than the `.execute(...)` shape that
 * `useUseCaseSubscription` adapts.
 *
 * Cache invalidation contract:
 *   - `useRegisterVehicleMutation` invalidates `user.current` (auto-active
 *     pointer may change) AND `serviceArea.activeForLocation` is left alone
 *     (vehicles don't change service-area resolution).
 *   - `useSetActiveVehicleMutation` invalidates `user.current` so the
 *     active-pointer paint refreshes.
 *   - `useDeleteVehicleMutation` invalidates `user.current` (active pointer
 *     may have cleared).
 *
 * The vehicles-list itself doesn't need invalidation because the live
 * Firestore subscription (`InMemoryVehicleRepository.subscribeByDriver`
 * in tests, `FirestoreVehicleRepository.subscribeByDriver` in prod) emits
 * a fresh array on every change.
 */

/**
 * Decode a VIN. Returns `Result.ok(decoded) | Result.ok(null) | Result.err(NetworkError)`
 * shaped as a regular query: `data` is `VinDecodeResult | null`, `error`
 * is `NetworkError`. The view-model maps these onto the form state machine.
 *
 * Disabled (no fetch) when `vin` is null. The 5-minute stale time matches
 * the kickoff decision — NHTSA data for a given VIN is essentially
 * immutable; re-decoding a VIN the user just typed is waste.
 */
export function useVinDecodeQuery(
  vin: Vin | null,
): UseQueryResult<VinDecodeResult | null, NetworkError> {
  const useCases = useUseCases();
  return useQuery({
    queryKey: vin
      ? queryKeys.vehicle.decode(String(vin))
      : ['vehicle', 'decode', null],
    queryFn: async (): Promise<VinDecodeResult | null> => {
      if (!vin) return null;
      const r = await useCases.decodeVin.execute({ vin });
      if (!r.ok) throw r.error;
      return r.value;
    },
    enabled: vin !== null,
    staleTime: 5 * 60 * 1000,
    // NHTSA is read-only and stable; refetching on focus is needless work.
    refetchOnWindowFocus: false,
  });
}

/**
 * Register a vehicle. The use case handles auth, role gating, auto-approve,
 * and the first-vehicle auto-active flag — the mutation just maps the
 * `Result` to a Promise and invalidates the caller's user query so any
 * `activeVehicleId` change paints immediately.
 *
 * The `Conflict` branch (`vehicle_already_exists`) surfaces as a thrown
 * `ConflictError` the VM converts into a "VIN already registered" inline
 * banner instead of a toast.
 */
export function useRegisterVehicleMutation(): UseMutationResult<
  Vehicle,
  AuthorizationError | NotFoundError | ConflictError | ValidationError,
  RegisterVehicleArgs
> {
  const useCases = useUseCases();
  const queryClient = useQueryClient();
  return useMutation<
    Vehicle,
    AuthorizationError | NotFoundError | ConflictError | ValidationError,
    RegisterVehicleArgs
  >({
    mutationFn: async (args: RegisterVehicleArgs): Promise<Vehicle> => {
      const r = await useCases.registerVehicle.execute(args);
      if (!r.ok) throw r.error;
      return r.value;
    },
    onSuccess: () => {
      // First-vehicle auto-active may have flipped `user.activeVehicleId`.
      void queryClient.invalidateQueries({
        queryKey: queryKeys.user.current(),
      });
    },
  });
}

/**
 * Set (or clear) the signed-in driver's active vehicle. The Vin → Vin | null
 * input mirrors the use case: pass `null` to clear, pass a `Vin` to flip.
 *
 * The repository propagates `services.ride` from the new active vehicle's
 * eligible-services list. We invalidate `user.current` so the next read
 * sees the updated `activeVehicleId`.
 */
export function useSetActiveVehicleMutation(): UseMutationResult<
  true,
  AuthorizationError | NotFoundError | ValidationError,
  { readonly vin: Vin | null }
> {
  const useCases = useUseCases();
  const queryClient = useQueryClient();
  return useMutation<
    true,
    AuthorizationError | NotFoundError | ValidationError,
    { readonly vin: Vin | null }
  >({
    mutationFn: async (args: { readonly vin: Vin | null }): Promise<true> => {
      const r = await useCases.setActiveVehicle.execute(args);
      if (!r.ok) throw r.error;
      return r.value;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.user.current(),
      });
    },
  });
}

/**
 * Soft-delete a vehicle the signed-in driver owns. The repo clears
 * `activeVehicleId` when the deleted VIN was active, so we invalidate
 * `user.current` to repaint the active-pointer state.
 */
export function useDeleteVehicleMutation(): UseMutationResult<
  true,
  AuthorizationError | NotFoundError | ValidationError,
  { readonly vin: Vin }
> {
  const useCases = useUseCases();
  const queryClient = useQueryClient();
  return useMutation<
    true,
    AuthorizationError | NotFoundError | ValidationError,
    { readonly vin: Vin }
  >({
    mutationFn: async (args: { readonly vin: Vin }): Promise<true> => {
      const r = await useCases.deleteVehicle.execute(args);
      if (!r.ok) throw r.error;
      return r.value;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.user.current(),
      });
    },
  });
}
