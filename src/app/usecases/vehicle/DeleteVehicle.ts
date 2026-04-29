import type { Vin } from '@domain/entities/Vin';
import {
  AuthorizationError,
  type NotFoundError,
  type ValidationError,
} from '@domain/errors';
import type { AuthRepository, VehicleRepository } from '@domain/repositories';
import { Result } from '@domain/shared/Result';

/**
 * Soft-delete the signed-in driver's vehicle.
 *
 * Authorization: as with `SetActiveVehicle`, we pass the current user's
 * UID to `vehicles.softDelete`, not an arg. `softDelete` flips the
 * vehicle's status to `'deleted'`, removes the VIN from the driver's
 * `vehicleIds[]`, and clears `activeVehicleId` if it pointed at this VIN.
 */
export class DeleteVehicle {
  constructor(
    private readonly auth: AuthRepository,
    private readonly vehicles: VehicleRepository,
  ) {}

  async execute(args: {
    vin: Vin;
  }): Promise<
    Result<true, AuthorizationError | NotFoundError | ValidationError>
  > {
    const uid = await this.auth.currentUserId();
    if (!uid) {
      return Result.err(
        new AuthorizationError({
          code: 'auth_no_current_user',
          message: 'No user is signed in',
        }),
      );
    }
    return this.vehicles.softDelete({ driverId: uid, vin: args.vin });
  }
}
