import { RideServiceId } from '@domain/entities/RideServiceId';
import type { VehicleClass } from '@domain/entities/VehicleClass';
import type {
  VehicleEngineSpecs,
  VehicleSpecs,
  VehicleDimensionSpecs,
  VehicleSafetySpecs,
  VehicleTransmissionSpecs,
  VehicleManufacturerSpecs,
} from '@domain/entities/VehicleSpecs';
import type { Vin } from '@domain/entities/Vin';
import { NetworkError } from '@domain/errors';
import type {
  VinDecodeResult,
  VinDecoderService,
} from '@domain/services/VinDecoderService';
import { Result } from '@domain/shared/Result';
import { LOG } from '@shared/logger';

const logger = LOG.extend('NHTSA');

const DECODE_BASE = 'https://vpic.nhtsa.dot.gov/api/vehicles';
const SAFETY_RATINGS_BASE = 'https://api.nhtsa.gov/SafetyRatings';

/**
 * Concrete `VinDecoderService` backed by NHTSA's public vPIC API
 * (`vpic.nhtsa.dot.gov`) for vehicle decoding and the SafetyRatings API
 * (`api.nhtsa.gov`) for stock photos.
 *
 * Both endpoints are keyless — NHTSA serves them as part of the federal
 * open-data program — so this adapter has no env-var dependency and ships
 * unconditionally in every build.
 *
 * Result mapping (locked at Phase 5 Turn 2 kickoff):
 *
 *   - `Results[0].ErrorCode !== '0'`        → `Result.ok(null)` (NHTSA's
 *     own "no usable match" signal — uncommon but real for rare/future
 *     model years; surface as "Couldn't auto-fill, please enter manually")
 *   - missing required fields (Make/Model/ModelYear after parse)
 *                                           → `Result.ok(null)` (same UX)
 *   - HTTP non-2xx, JSON parse failure, fetch threw
 *                                           → `Result.err(NetworkError)`
 *
 * Stock-photo fetch is best-effort: a failure there logs at `LOG.warn`
 * but does NOT degrade the decode result — the VIN is decoded, we just
 * return `stockPhoto: null`.
 *
 * `vehicleClass`, `isEligible`, and `eligibleServices` derivation is
 * ported verbatim from legacy `yeride/src/api/nhtsa/VinDecoder.js`
 * (`determineVehicleClass`, `checkEligibility`, `getEligibleServices`)
 * so a VIN that the legacy app classifies as "comfort" decodes the same
 * way here.
 */
export class NhtsaVinDecoderService implements VinDecoderService {
  async decode(
    vin: Vin,
  ): Promise<Result<VinDecodeResult | null, NetworkError>> {
    const url = `${DECODE_BASE}/DecodeVinValues/${String(vin)}?format=json`;

    let response: Response;
    try {
      response = await fetch(url);
    } catch (e) {
      logger.warn('decode fetch threw', { code: 'fetch_failure' });
      return Result.err(
        new NetworkError({
          code: 'nhtsa_request_failed',
          message: 'NHTSA decode request failed',
          cause: e,
        }),
      );
    }

    if (!response.ok) {
      logger.warn('decode returned non-2xx', {
        status: String(response.status),
      });
      return Result.err(
        new NetworkError({
          code: 'nhtsa_request_failed',
          message: `NHTSA decode returned HTTP ${String(response.status)}`,
        }),
      );
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch (e) {
      return Result.err(
        new NetworkError({
          code: 'nhtsa_response_invalid_json',
          message: 'NHTSA decode returned non-JSON',
          cause: e,
        }),
      );
    }

    const results = (json as { Results?: unknown }).Results;
    if (!Array.isArray(results) || results.length === 0) {
      // Empty or missing Results — treat as no-match. NHTSA shouldn't ever
      // actually return this for a syntactically valid VIN, but we don't
      // want to crash the registration flow if it does.
      return Result.ok(null);
    }

    const raw = results[0] as Record<string, unknown>;
    const errorCode =
      typeof raw['ErrorCode'] === 'string' ? raw['ErrorCode'] : '0';
    if (errorCode !== '0') {
      // NHTSA-reported decode failure (unusual VIN, future model year).
      // Treat as no-match — caller falls back to manual entry.
      logger.info('decode reports ErrorCode', {
        errorCode,
        errorText: typeof raw['ErrorText'] === 'string' ? raw['ErrorText'] : '',
      });
      return Result.ok(null);
    }

    const make = readString(raw['Make']) ?? readString(raw['Manufacturer']);
    const model = readString(raw['Model']);
    const year = readInt(raw['ModelYear']);

    if (!make || !model || year === null) {
      // NHTSA returned ErrorCode 0 but didn't populate the basics.
      // Same UX as ErrorCode != 0: surface as "Couldn't auto-fill".
      return Result.ok(null);
    }

    const vehicleClass = determineVehicleClass(raw);
    const isEligible = checkEligibility(raw);
    const eligibleServices = getEligibleServices(vehicleClass, isEligible);

    // Best-effort stock-photo fetch. Failures here MUST NOT degrade the
    // decode — return decoded data with stockPhoto: null. Logged at warn.
    const stockPhoto = await this.fetchStockPhoto(year, make, model);

    const decoded: VinDecodeResult = {
      vin,
      make,
      model,
      year,
      trim: readString(raw['Trim']) ?? null,
      bodyClass: readString(raw['BodyClass']) ?? null,
      vehicleClass,
      seats: readInt(raw['Seats']),
      doors: readInt(raw['Doors']),
      eligibleServices,
      stockPhoto,
      specs: extractSpecs(raw),
      isEligible,
    };
    return Result.ok(decoded);
  }

  /**
   * Two-step SafetyRatings fetch:
   *   1. modelyear/{year}/make/{make}/model/{model} → variants list
   *   2. VehicleId/{id} → details (carries `VehiclePicture`)
   *
   * Returns null on ANY failure — this is best-effort and never blocks
   * the decode.
   */
  private async fetchStockPhoto(
    year: number,
    make: string,
    model: string,
  ): Promise<string | null> {
    try {
      const variantsUrl = `${SAFETY_RATINGS_BASE}/modelyear/${String(year)}/make/${encodeURIComponent(make)}/model/${encodeURIComponent(model)}`;
      const variantsResponse = await fetch(variantsUrl);
      if (!variantsResponse.ok) {
        logger.warn('stock-photo variants fetch non-2xx', {
          status: String(variantsResponse.status),
        });
        return null;
      }
      const variantsJson = (await variantsResponse.json()) as {
        Count?: number;
        Results?: Array<{ VehicleId?: number }>;
      };
      const variants = Array.isArray(variantsJson.Results)
        ? variantsJson.Results
        : [];
      if (variants.length === 0) return null;
      const first = variants[0];
      const vehicleId = first?.VehicleId;
      if (typeof vehicleId !== 'number') return null;

      const detailsUrl = `${SAFETY_RATINGS_BASE}/VehicleId/${String(vehicleId)}`;
      const detailsResponse = await fetch(detailsUrl);
      if (!detailsResponse.ok) {
        logger.warn('stock-photo details fetch non-2xx', {
          status: String(detailsResponse.status),
        });
        return null;
      }
      const detailsJson = (await detailsResponse.json()) as {
        Results?: Array<{ VehiclePicture?: string }>;
      };
      const detailsResults = Array.isArray(detailsJson.Results)
        ? detailsJson.Results
        : [];
      const detailsFirst = detailsResults[0];
      const picture =
        typeof detailsFirst?.VehiclePicture === 'string' &&
        detailsFirst.VehiclePicture.length > 0
          ? detailsFirst.VehiclePicture
          : null;
      return picture;
    } catch (e) {
      logger.warn('stock-photo fetch threw', { code: 'fetch_failure' });
      // Cause is intentionally not surfaced — best-effort path.
      void e;
      return null;
    }
  }
}

/* ────────── classification helpers (ported verbatim from legacy) ────────── */

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

function determineVehicleClass(raw: Record<string, unknown>): VehicleClass {
  const bodyClass = (readString(raw['BodyClass']) ?? '').toLowerCase();
  const make = (readString(raw['Make']) ?? '').toLowerCase();
  const seats = readInt(raw['Seats']);

  // 1. Luxury brands take priority over body classification.
  if (LUXURY_BRANDS.some((brand) => make.includes(brand))) {
    return 'luxury';
  }

  // 2. XL: SUVs, minivans, vans, or 7+ seats.
  if (
    bodyClass.includes('suv') ||
    bodyClass.includes('minivan') ||
    bodyClass.includes('van') ||
    (seats !== null && seats >= 7)
  ) {
    return 'xl';
  }

  // 3. Crossovers → comfort.
  if (bodyClass.includes('crossover')) {
    return 'comfort';
  }

  // 4. Sedans/cars: use wheelbase + GVWR to distinguish compact ↔ mid-size.
  const wheelBase = readWheelBase(raw);
  const gvwrLbs = readGvwrLbs(raw);

  if (bodyClass.includes('sedan') || bodyClass.includes('car')) {
    if (wheelBase !== null) {
      if (wheelBase >= 110) {
        // Mid-size sedan if GVWR also looks like one (or GVWR not reported).
        if (gvwrLbs !== null && gvwrLbs >= 4400) return 'comfort';
        if (gvwrLbs === null) return 'comfort';
        // Long wheelbase + light GVWR is unusual; fall through to label test.
      } else {
        return 'economy';
      }
    }
    if (bodyClass.includes('compact') || bodyClass.includes('subcompact')) {
      return 'economy';
    }
  }

  // 5. Coupes / hatchbacks → economy.
  if (bodyClass.includes('coupe') || bodyClass.includes('hatchback')) {
    return 'economy';
  }

  // Default: economy.
  return 'economy';
}

function checkEligibility(raw: Record<string, unknown>): boolean {
  const currentYear = new Date().getFullYear();
  const year = readInt(raw['ModelYear']);
  if (year === null || currentYear - year > 15) return false;

  const vehicleType = (readString(raw['VehicleType']) ?? '').toLowerCase();
  const bodyClass = (readString(raw['BodyClass']) ?? '').toLowerCase();
  if (
    INELIGIBLE_TYPES.some(
      (t) => vehicleType.includes(t) || bodyClass.includes(t),
    )
  ) {
    return false;
  }

  const doors = readInt(raw['Doors']);
  if (doors !== null && doors < 4 && !bodyClass.includes('coupe')) {
    return false;
  }

  const seats = readInt(raw['Seats']);
  if (seats !== null && seats < 4) {
    return false;
  }

  return true;
}

function getEligibleServices(
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

  // Validate each slug through RideServiceId; skip any that fail rather
  // than failing the whole decode. In practice the slugs above always
  // validate — this is defense in depth.
  const out: RideServiceId[] = [];
  for (const slug of slugs) {
    const r = RideServiceId.create(slug);
    if (r.ok) out.push(r.value);
  }
  return out;
}

function extractSpecs(raw: Record<string, unknown>): VehicleSpecs {
  const engine: VehicleEngineSpecs = {};
  const cylinders = readInt(raw['EngineCylinders']);
  if (cylinders !== null)
    (engine as { cylinders: number }).cylinders = cylinders;
  const displacementL = readFloat(raw['DisplacementL']);
  if (displacementL !== null) {
    (engine as { displacementL: number }).displacementL = displacementL;
  }
  const fuelType = readString(raw['FuelTypePrimary']);
  if (fuelType !== undefined)
    (engine as { fuelType: string }).fuelType = fuelType;
  const configuration = readString(raw['EngineConfiguration']);
  if (configuration !== undefined) {
    (engine as { configuration: string }).configuration = configuration;
  }
  const engineModel = readString(raw['EngineModel']);
  if (engineModel !== undefined)
    (engine as { model: string }).model = engineModel;
  const turbo = readString(raw['Turbo']);
  if (turbo !== undefined) (engine as { turbo: string }).turbo = turbo;

  const transmission: VehicleTransmissionSpecs = {};
  const style = readString(raw['TransmissionStyle']);
  if (style !== undefined) {
    (transmission as { style: string }).style = style;
  }
  const speeds = readInt(raw['TransmissionSpeeds']);
  if (speeds !== null) {
    (transmission as { speeds: number }).speeds = speeds;
  }

  const safety: VehicleSafetySpecs = {};
  const airbagLocations = readString(raw['AirBagLocFront']);
  if (airbagLocations !== undefined) {
    (safety as { airbagLocations: string }).airbagLocations = airbagLocations;
  }
  const seatBelts = readString(raw['SeatBeltsAll']);
  if (seatBelts !== undefined) {
    (safety as { seatBelts: string }).seatBelts = seatBelts;
  }
  const abs = readString(raw['ABS']);
  if (abs !== undefined) (safety as { abs: string }).abs = abs;
  const esc = readString(raw['ESC']);
  if (esc !== undefined) (safety as { esc: string }).esc = esc;
  const tractionControl = readString(raw['TractionControl']);
  if (tractionControl !== undefined) {
    (safety as { tractionControl: string }).tractionControl = tractionControl;
  }

  const dimensions: VehicleDimensionSpecs = {};
  const doors = readInt(raw['Doors']);
  if (doors !== null) (dimensions as { doors: number }).doors = doors;
  const seats = readInt(raw['Seats']);
  if (seats !== null) (dimensions as { seats: number }).seats = seats;
  const wheelBase = readWheelBase(raw);
  if (wheelBase !== null) {
    (dimensions as { wheelBase: number }).wheelBase = wheelBase;
  }
  const gvwr = readString(raw['GVWR']);
  if (gvwr !== undefined) (dimensions as { gvwr: string }).gvwr = gvwr;

  const manufacturer: VehicleManufacturerSpecs = {};
  const manufacturerName = readString(raw['Manufacturer']);
  if (manufacturerName !== undefined) {
    (manufacturer as { manufacturer: string }).manufacturer = manufacturerName;
  }
  const plantCity = readString(raw['PlantCity']);
  if (plantCity !== undefined) {
    (manufacturer as { plantCity: string }).plantCity = plantCity;
  }
  const plantState = readString(raw['PlantState']);
  if (plantState !== undefined) {
    (manufacturer as { plantState: string }).plantState = plantState;
  }
  const plantCountry = readString(raw['PlantCountry']);
  if (plantCountry !== undefined) {
    (manufacturer as { plantCountry: string }).plantCountry = plantCountry;
  }

  const out: VehicleSpecs = {};
  if (Object.keys(engine).length > 0)
    (out as { engine: VehicleEngineSpecs }).engine = engine;
  if (Object.keys(transmission).length > 0) {
    (out as { transmission: VehicleTransmissionSpecs }).transmission =
      transmission;
  }
  if (Object.keys(safety).length > 0) {
    (out as { safety: VehicleSafetySpecs }).safety = safety;
  }
  if (Object.keys(dimensions).length > 0) {
    (out as { dimensions: VehicleDimensionSpecs }).dimensions = dimensions;
  }
  if (Object.keys(manufacturer).length > 0) {
    (out as { manufacturer: VehicleManufacturerSpecs }).manufacturer =
      manufacturer;
  }
  return out;
}

/* ────────── primitive readers (NHTSA fields are all optional strings) ────────── */

function readString(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const trimmed = v.trim();
  if (trimmed.length === 0) return undefined;
  // NHTSA also returns "Not Applicable" for a lot of fields — treat as missing.
  if (trimmed === 'Not Applicable') return undefined;
  return trimmed;
}

function readInt(v: unknown): number | null {
  if (typeof v === 'number' && Number.isInteger(v)) return v;
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  if (trimmed.length === 0) return null;
  const n = Number.parseInt(trimmed, 10);
  return Number.isFinite(n) ? n : null;
}

function readFloat(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  if (trimmed.length === 0) return null;
  const n = Number.parseFloat(trimmed);
  return Number.isFinite(n) ? n : null;
}

/**
 * NHTSA reports wheelbase across THREE fields: WheelBase (the canonical
 * one when present), WheelBaseShort, WheelBaseLong. Legacy reads them in
 * "short || long || canonical" order; we preserve the order so the
 * classification result matches.
 */
function readWheelBase(raw: Record<string, unknown>): number | null {
  return (
    readFloat(raw['WheelBaseShort']) ??
    readFloat(raw['WheelBaseLong']) ??
    readFloat(raw['WheelBase'])
  );
}

/**
 * NHTSA's GVWR field is a label like "Class 1A: 3,000 lb or less". Strip
 * non-numeric characters and parse — same approach as legacy.
 */
function readGvwrLbs(raw: Record<string, unknown>): number | null {
  const s = readString(raw['GVWR']);
  if (!s) return null;
  const cleaned = s.replace(/[^0-9.]/g, '');
  if (cleaned.length === 0) return null;
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}
