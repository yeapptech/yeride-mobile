import { RideServiceId } from '../entities/RideServiceId';
import type { VehicleClass } from '../entities/VehicleClass';

/**
 * Domain service for the manual-entry vehicle-classification path. Pure
 * functions, no I/O, no HTTP — same shape as `FareCalculator`.
 *
 * The VIN-decoded path runs through `NhtsaVinDecoderService` (data layer),
 * which classifies based on physical dimensions (wheelbase + GVWR) returned
 * by NHTSA. When the driver enters vehicle data manually we don't have
 * those dimensions, so we use a simpler set of inputs (`vehicleSize` for
 * sedans, plus `seats` count for SUVs) ported from legacy
 * `yeride/src/api/nhtsa/VinDecoder.js#determineVehicleClassManual`.
 *
 * Both paths converge on the same `VehicleClass` and the same
 * `eligibleServices: RideServiceId[]` mapping (via `computeEligibleServices`),
 * so a vehicle classified as `'comfort'` here gets the same eligible
 * services as one decoded that way.
 *
 * `checkManualEligibility` takes `now: Date` as an explicit input rather
 * than reading `Date.now()` directly — same convention as FareCalculator,
 * matters for fake-timer-driven unit tests.
 */
export interface ClassifyManualArgs {
  /** Make / brand. Case-insensitive matching against the luxury-brand list. */
  readonly make: string;
  /**
   * Body type as a free-form string. Compared lowercase against `'sedan'`,
   * `'suv'`, `'minivan'`, `'van'`, `'crossover'`, `'wagon'`, `'coupe'`,
   * `'hatchback'`. Empty / unrecognized values fall through to `'economy'`.
   */
  readonly bodyClass: string;
  /**
   * Distinguishes compact from mid-size sedans. Only consulted when
   * `bodyClass` resolves to a sedan; ignored otherwise. Recognized values
   * (case-insensitive substring match): `'compact'`, `'mid-size'`. Anything
   * else (or empty) means "compact" — defaults economy.
   */
  readonly vehicleSize: string | null;
  /**
   * Seat count. ≥7 forces XL even when bodyClass would otherwise resolve
   * to a sedan/coupe (legacy parity).
   */
  readonly seats: number | null;
}

export interface CheckManualEligibilityArgs {
  /** Model year. Vehicles older than 15 years (relative to `now`) are blocked. */
  readonly year: number | null;
  /**
   * Body type. Vehicles whose body type contains `'motorcycle'`, `'trailer'`,
   * `'motorhome'`, `'bus'`, or `'truck'` are blocked.
   */
  readonly bodyClass: string;
  /** Door count. Fewer than 4 doors blocks ineligibility unless it's a coupe. */
  readonly doors: number | null;
  /** Seat count. Fewer than 4 seats blocks. */
  readonly seats: number | null;
  /** "Now" reference for the age check. Defaults to `new Date()` if absent. */
  readonly now?: Date;
}

const LUXURY_BRANDS: readonly string[] = [
  'mercedes-benz',
  'bmw',
  'audi',
  'lexus',
  'cadillac',
  'porsche',
  'jaguar',
  'land rover',
  'tesla',
  'genesis',
  'lincoln',
  'infiniti',
];

const INELIGIBLE_TYPES: readonly string[] = [
  'motorcycle',
  'trailer',
  'motorhome',
  'bus',
  'truck',
];

const MAX_VEHICLE_AGE_YEARS = 15;
const MIN_DOORS = 4;
const MIN_SEATS = 4;

export const VehicleClassifier = {
  /**
   * Classify a manually-entered vehicle into one of the four `VehicleClass`
   * tiers. Total — never throws, always returns a tier (defaulting to
   * `'economy'` when nothing else matches).
   *
   * Decision order (matches legacy):
   *   1. Luxury brand (highest priority — beats every body-class signal).
   *   2. SUV / minivan / van / 7+ seats → `'xl'`.
   *   3. Crossover → `'comfort'`.
   *   4. Sedan: `'comfort'` if `vehicleSize` says mid-size, else `'economy'`.
   *   5. Wagon → `'comfort'`.
   *   6. Coupe / hatchback → `'economy'`.
   *   7. Default → `'economy'`.
   */
  classifyManual(args: ClassifyManualArgs): VehicleClass {
    const make = args.make.toLowerCase();
    const bodyClass = args.bodyClass.toLowerCase();
    const seats = args.seats ?? 0;

    // 1. Luxury brand wins.
    if (LUXURY_BRANDS.some((brand) => make.includes(brand))) {
      return 'luxury';
    }

    // 2. XL: SUVs, minivans, vans, or 7+ seats.
    if (
      bodyClass.includes('suv') ||
      bodyClass.includes('minivan') ||
      bodyClass.includes('van') ||
      seats >= 7
    ) {
      return 'xl';
    }

    // 3. Crossovers → comfort.
    if (bodyClass.includes('crossover')) {
      return 'comfort';
    }

    // 4. Sedan: vehicleSize disambiguates compact ↔ mid-size.
    if (bodyClass.includes('sedan')) {
      if (
        args.vehicleSize !== null &&
        args.vehicleSize.toLowerCase().includes('mid-size')
      ) {
        return 'comfort';
      }
      return 'economy';
    }

    // 5. Wagons → comfort.
    if (bodyClass.includes('wagon')) {
      return 'comfort';
    }

    // 6. Coupes / hatchbacks → economy.
    if (bodyClass.includes('coupe') || bodyClass.includes('hatchback')) {
      return 'economy';
    }

    // 7. Default.
    return 'economy';
  },

  /**
   * Check whether a manually-entered vehicle passes the rideshare
   * eligibility heuristics. Returns `true` when the vehicle is at most
   * 15 model years old, isn't a motorcycle / trailer / motorhome / bus /
   * truck, has at least 4 doors (coupes excepted), and at least 4 seats.
   *
   * `null` for an optional input means "unknown" — the rule for that
   * field is skipped (mirrors legacy: `if (doors && doors < 4 && ...)`
   * — a missing door count doesn't disqualify on its own, but a missing
   * year does).
   */
  checkManualEligibility(args: CheckManualEligibilityArgs): boolean {
    const now = args.now ?? new Date();
    const currentYear = now.getFullYear();

    if (args.year === null || currentYear - args.year > MAX_VEHICLE_AGE_YEARS) {
      return false;
    }

    const bodyClass = args.bodyClass.toLowerCase();
    if (INELIGIBLE_TYPES.some((t) => bodyClass.includes(t))) {
      return false;
    }

    if (
      args.doors !== null &&
      args.doors < MIN_DOORS &&
      !bodyClass.includes('coupe')
    ) {
      return false;
    }

    if (args.seats !== null && args.seats < MIN_SEATS) {
      return false;
    }

    return true;
  },

  /**
   * Compute the list of `RideServiceId`s a vehicle of the given class
   * is eligible to serve. Mirrors legacy `getEligibleServices` and the
   * rewrite's `NhtsaVinDecoderService.getEligibleServices` so the two
   * registration paths produce identical service lists for equivalent
   * inputs.
   *
   *   `economy` → `[economy, deliver]`
   *   `comfort` → `[economy, comfort, deliver]`
   *   `xl`      → `[economy, comfort, xl, deliver]`
   *   `luxury`  → `[comfort, luxury, deliver]`
   *
   * When `isEligible === false` the returned list is empty — registration
   * still proceeds (admin review is the final gate) but the dispatcher
   * won't match the vehicle until eligibility flips.
   */
  computeEligibleServices(
    vehicleClass: VehicleClass,
    isEligible: boolean,
  ): readonly RideServiceId[] {
    if (!isEligible) return [];
    const slugs: string[] = [];
    switch (vehicleClass) {
      case 'economy':
        slugs.push('economy');
        break;
      case 'comfort':
        slugs.push('economy', 'comfort');
        break;
      case 'xl':
        slugs.push('economy', 'comfort', 'xl');
        break;
      case 'luxury':
        slugs.push('comfort', 'luxury');
        break;
    }
    // Every eligible vehicle can also do delivery (legacy parity).
    slugs.push('deliver');

    // Validate each slug through `RideServiceId.create`; skip invalid
    // entries rather than failing the whole list. In practice the slugs
    // above always validate — defense in depth against future edits.
    const out: RideServiceId[] = [];
    for (const slug of slugs) {
      const r = RideServiceId.create(slug);
      if (r.ok) out.push(r.value);
    }
    return out;
  },
};
