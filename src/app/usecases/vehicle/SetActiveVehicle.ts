import type { Vin } from '@domain/entities/Vin';
import {
  AuthorizationError,
  type NotFoundError,
  type ValidationError,
} from '@domain/errors';
import type { AuthRepository, VehicleRepository } from '@domain/repositories';
import { Result } from '@domain/shared/Result';

/**
 * Set (or clear) the signed-in driver's active vehicle.
 *
 * Authorization is server-context: we ALWAYS pass the current user's UID
 * to `vehicles.setActive`, never an arg-supplied driverId. This way a
 * malicious view-model can't activate someone else's vehicle even if it
 * were to construct a `UserId` that doesn't match the JWT.
 *
 * `vin = null` clears the active pointer; `vin = Vin` flips to that
 * vehicle (which must be approved + owned by the driver — the repo
 * enforces that).
 */
export class SetActiveVehicle {
  constructor(
    private readonly auth: AuthRepository,
    private readonly vehicles: VehicleRepository,
  ) {}

  async execute(args: {
    vin: Vin | null;
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
    return this.vehicles.setActive({ driverId: uid, vin: args.vin });
  }
}
