/**
 * The vehicle's intrinsic classification, used by the dispatcher to match
 * the vehicle to compatible `RideService` tiers in a ServiceArea.
 *
 *   - `economy` — compact / subcompact passenger car
 *   - `comfort` — mid-size sedan, crossover, wagon
 *   - `luxury`  — recognized luxury brand or trim
 *   - `xl`      — SUV / minivan / 7+ seats
 *
 * Distinct from `RideServiceId`: vehicleClass is the property of the
 * vehicle itself; `eligibleServices: RideServiceId[]` is the derived list
 * of tiers the vehicle is authorised to serve in a given service area.
 *
 * Determination logic (legacy `determineVehicleClass`,
 * `determineVehicleClassManual`) lives in the data layer / a dedicated
 * helper; the entity treats this as an authoritative input.
 */
export type VehicleClass = 'economy' | 'comfort' | 'luxury' | 'xl';

export const VEHICLE_CLASSES: readonly VehicleClass[] = [
  'economy',
  'comfort',
  'luxury',
  'xl',
] as const;
