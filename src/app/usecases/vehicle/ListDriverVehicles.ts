import type { UserId } from '@domain/entities/UserId';
import type { Vehicle } from '@domain/entities/Vehicle';
import type { VehicleRepository } from '@domain/repositories';

/**
 * Subscription-shaped: returns a synchronous unsubscribe. Mirrors how
 * `ListRidesByDriver` (Phase 4) accepts `driverId` from the view-model
 * rather than reaching into auth — admin tooling can list any driver's
 * vehicles in the future. The auth-required mutations
 * (`SetActiveVehicle`, `DeleteVehicle`, `UploadVehiclePhotos`) DO pull
 * from `AuthRepository.currentUserId()`.
 */
export class ListDriverVehicles {
  constructor(private readonly vehicles: VehicleRepository) {}

  /**
   * Subscribe to the driver's vehicle list. Emits the current state
   * synchronously on subscribe + on every change. Returns a synchronous
   * unsubscribe.
   */
  subscribe(args: {
    driverId: UserId;
    callback: (vehicles: readonly Vehicle[]) => void;
  }): () => void {
    return this.vehicles.subscribeByDriver({
      driverId: args.driverId,
      callback: args.callback,
    });
  }
}
