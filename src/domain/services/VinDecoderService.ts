import type { RideServiceId } from '../entities/RideServiceId';
import type { VehicleClass } from '../entities/VehicleClass';
import type { VehicleSpecs } from '../entities/VehicleSpecs';
import type { Vin } from '../entities/Vin';
import type { NetworkError } from '../errors';
import type { Result } from '../shared/Result';

/**
 * Abstraction over the NHTSA VIN-decode service. The data layer's
 * `NhtsaVinDecoderService` (Turn 2) speaks HTTPS against
 * `vpic.nhtsa.dot.gov/api/vehicles` (no API key required) and the
 * SafetyRatings endpoint for stock photos.
 *
 * Why a service and not a repository: VIN decode is a stateless lookup
 * against an external system; nothing is persisted or re-read by id.
 *
 * Result semantics:
 *   - `Result.ok(decode)` — NHTSA returned usable data; pre-fill the
 *     registration form with these fields. Manual editing is still
 *     allowed.
 *   - `Result.ok(null)` — request succeeded but NHTSA returned no usable
 *     match for this VIN (uncommon — it can happen for rare or future
 *     model years). Surface as "Couldn't auto-fill, please enter manually".
 *   - `Result.err(NetworkError)` — actual transport failure. Same UI
 *     fallback as `null`, but logged as transient.
 */
export interface VinDecodeResult {
  readonly vin: Vin;
  readonly make: string;
  readonly model: string;
  readonly year: number;
  readonly trim: string | null;
  readonly bodyClass: string | null;
  readonly vehicleClass: VehicleClass;
  readonly seats: number | null;
  readonly doors: number | null;
  readonly eligibleServices: readonly RideServiceId[];
  readonly stockPhoto: string | null;
  readonly specs: VehicleSpecs;
  /**
   * Whether NHTSA's eligibility heuristics (vehicle age ≤ 15 years,
   * passenger vehicle, ≥ 4 doors, ≥ 4 seats) say this VIN is rideshare-
   * eligible. The presentation layer surfaces a warning banner if `false`
   * but does NOT block registration — admin review is the final gate.
   */
  readonly isEligible: boolean;
}

export interface VinDecoderService {
  /**
   * Decode a VIN. Returns `null` on no-match, `Result.err(NetworkError)`
   * on transport failure.
   */
  decode(vin: Vin): Promise<Result<VinDecodeResult | null, NetworkError>>;
}
