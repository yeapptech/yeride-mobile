import { Coordinates } from '@domain/entities/Coordinates';
import { Money } from '@domain/entities/Money';
import { Route } from '@domain/entities/Route';
import { NetworkError, NotFoundError, ValidationError } from '@domain/errors';
import type {
  ComputeRoutesArgs,
  RoutesEndpoint,
  RoutesService,
} from '@domain/services';
import { Result } from '@domain/shared/Result';
import { LOG } from '@shared/logger';

const logger = LOG.extend('GoogleRoutesService');

const ROUTES_ENDPOINT =
  'https://routes.googleapis.com/directions/v2:computeRoutes';

/**
 * Curated FieldMask matching the legacy yeride app exactly. Tightening this
 * is the primary cost lever — Google bills per requested field tier — so
 * we only ask for what consumers actually use:
 *
 *   - distanceMeters / duration / staticDuration → fare + ETA math
 *   - polyline.encodedPolyline                    → MapView (Phase 3)
 *   - description / routeLabels                   → "Recommended" / "Most
 *                                                    Economical" labels
 *   - travelAdvisory.tollInfo                     → toll-price display
 *   - localizedValues.{distance,duration,…}       → display strings
 *   - legs.{startLocation,endLocation}            → geometry endpoints
 *   - routeToken                                  → Navigation SDK replay
 *
 * Adding fields here without ALSO consuming them is waste. Removing fields
 * that have current consumers will break those consumers silently — Google
 * just omits the field rather than erroring.
 */
const FIELD_MASK = [
  'routes.duration',
  'routes.staticDuration',
  'routes.distanceMeters',
  'routes.polyline.encodedPolyline',
  'routes.description',
  'routes.routeLabels',
  'routes.travelAdvisory.tollInfo',
  'routes.localizedValues.distance',
  'routes.localizedValues.duration',
  'routes.localizedValues.staticDuration',
  'routes.legs.startLocation',
  'routes.legs.endLocation',
  'routes.routeToken',
].join(',');

const DURATION_PATTERN = /^(-?\d+(?:\.\d+)?)s$/;

/**
 * Concrete `RoutesService` backed by the Google Routes API
 * (`v2:computeRoutes`). Speaks raw `fetch` — no SDK dependency — because
 * Google doesn't ship an RN-native client and the wire shape is stable.
 *
 * The adapter is a thin pure-function wrapper:
 *   1. Translate domain `ComputeRoutesArgs` to the Google request body.
 *   2. POST with the curated FieldMask.
 *   3. Translate the response to `Route[]`.
 *   4. Map errors to DomainError subtypes.
 *
 * Programming errors (e.g. malformed JSON in the response, an unexpected
 * shape) bubble up as plain `Error` — they're infra bugs, not user-facing.
 */
export class GoogleRoutesService implements RoutesService {
  constructor(private readonly apiKey: string) {}

  async computeRoutes(
    args: ComputeRoutesArgs,
  ): Promise<
    Result<readonly Route[], NetworkError | NotFoundError | ValidationError>
  > {
    const originBody = encodeEndpoint(args.origin);
    if (!originBody.ok) return originBody;
    const destBody = encodeEndpoint(args.destination);
    if (!destBody.ok) return destBody;

    const body = {
      origin: originBody.value,
      destination: destBody.value,
      travelMode: 'DRIVE',
      routingPreference: 'TRAFFIC_AWARE',
      computeAlternativeRoutes: args.options?.alternatives ?? false,
      extraComputations: args.options?.tolls ? ['TOLLS'] : [],
      units: 'IMPERIAL',
      routeModifiers: { avoidFerries: true },
    };

    let response: Response;
    try {
      response = await fetch(ROUTES_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': this.apiKey,
          'X-Goog-FieldMask': FIELD_MASK,
        },
        body: JSON.stringify(body),
      });
    } catch (e) {
      logger.warn('computeRoutes fetch threw', { code: 'fetch_failure' });
      return Result.err(
        new NetworkError({
          code: 'routes_request_failed',
          message: 'Routes API request failed',
          cause: e,
        }),
      );
    }

    if (!response.ok) {
      logger.warn('computeRoutes returned non-2xx', {
        status: String(response.status),
      });
      return Result.err(
        new NetworkError({
          code: 'routes_request_failed',
          message: `Routes API returned HTTP ${String(response.status)}`,
        }),
      );
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch (e) {
      return Result.err(
        new NetworkError({
          code: 'routes_response_invalid_json',
          message: 'Routes API returned non-JSON',
          cause: e,
        }),
      );
    }

    const routesField = (json as { routes?: unknown }).routes;
    if (!Array.isArray(routesField) || routesField.length === 0) {
      return Result.err(
        new NotFoundError({
          code: 'routes_not_found',
          message: 'No drivable route between origin and destination',
          resource: 'route',
        }),
      );
    }

    const out: Route[] = [];
    for (const raw of routesField) {
      const mapped = mapRoute(raw);
      if (!mapped.ok) {
        // A single bad route in a multi-route response is worth logging but
        // not worth failing the whole call over. We skip it.
        logger.warn('computeRoutes: skipping route that failed mapping', {
          code: mapped.error.code,
        });
        continue;
      }
      out.push(mapped.value);
    }
    if (out.length === 0) {
      return Result.err(
        new NotFoundError({
          code: 'routes_all_invalid',
          message: 'Every returned route failed validation',
          resource: 'route',
        }),
      );
    }
    return Result.ok(out);
  }
}

/* ───── encoding domain → wire ───── */

function encodeEndpoint(
  e: RoutesEndpoint,
): Result<Record<string, unknown>, ValidationError> {
  if ('placeId' in e) {
    if (typeof e.placeId !== 'string' || e.placeId.length === 0) {
      return Result.err(
        new ValidationError({
          code: 'routes_invalid_place_id',
          message: 'placeId must be a non-empty string',
          field: 'placeId',
        }),
      );
    }
    return Result.ok({ placeId: e.placeId });
  }
  return Result.ok({
    location: {
      latLng: {
        latitude: e.coordinates.latitude,
        longitude: e.coordinates.longitude,
      },
    },
  });
}

/* ───── decoding wire → domain ───── */

interface RawRoute {
  distanceMeters?: unknown;
  duration?: unknown;
  polyline?: { encodedPolyline?: unknown };
  description?: unknown;
  routeLabels?: unknown;
  travelAdvisory?: { tollInfo?: unknown };
  localizedValues?: {
    distance?: { text?: unknown };
    duration?: { text?: unknown };
  };
  legs?: Array<{
    startLocation?: { latLng?: { latitude?: unknown; longitude?: unknown } };
    endLocation?: { latLng?: { latitude?: unknown; longitude?: unknown } };
  }>;
  routeToken?: unknown;
}

function mapRoute(raw: unknown): Result<Route, ValidationError> {
  if (typeof raw !== 'object' || raw === null) {
    return Result.err(invalid('route', 'route entry is not an object'));
  }
  const r = raw as RawRoute;

  const distanceMeters =
    typeof r.distanceMeters === 'number' ? r.distanceMeters : 0;
  const durationSeconds = parseDurationSeconds(r.duration);

  const distanceText =
    typeof r.localizedValues?.distance?.text === 'string'
      ? r.localizedValues.distance.text
      : '';
  const durationText =
    typeof r.localizedValues?.duration?.text === 'string'
      ? r.localizedValues.duration.text
      : '';

  const encodedPolyline =
    typeof r.polyline?.encodedPolyline === 'string'
      ? r.polyline.encodedPolyline
      : '';

  const leg =
    Array.isArray(r.legs) && r.legs.length > 0 ? r.legs[0] : undefined;
  const startCoordsR = readLatLng(leg?.startLocation?.latLng);
  if (!startCoordsR.ok) return startCoordsR;
  const endCoordsR = readLatLng(leg?.endLocation?.latLng);
  if (!endCoordsR.ok) return endCoordsR;

  const routeLabels: readonly string[] = Array.isArray(r.routeLabels)
    ? r.routeLabels.filter((x): x is string => typeof x === 'string')
    : [];

  const tollPrice = readTollPrice(r.travelAdvisory?.tollInfo);

  const routeToken = typeof r.routeToken === 'string' ? r.routeToken : '';
  const description = typeof r.description === 'string' ? r.description : '';

  return Route.create({
    distanceMeters,
    durationSeconds,
    distanceText,
    durationText,
    encodedPolyline,
    startLocation: startCoordsR.value,
    endLocation: endCoordsR.value,
    routeLabels,
    tollPrice,
    routeToken,
    description,
  });
}

/**
 * Google returns durations as protobuf Duration strings — "420s", "0.075s",
 * etc. Strip the trailing "s" and parse. Anything else → 0.
 */
function parseDurationSeconds(d: unknown): number {
  if (typeof d !== 'string') return 0;
  const match = DURATION_PATTERN.exec(d.trim());
  if (!match) return 0;
  const seconds = Number.parseFloat(match[1] ?? '0');
  return Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds) : 0;
}

function readLatLng(
  ll: { latitude?: unknown; longitude?: unknown } | undefined,
): Result<Coordinates, ValidationError> {
  const lat = typeof ll?.latitude === 'number' ? ll.latitude : NaN;
  const lng = typeof ll?.longitude === 'number' ? ll.longitude : NaN;
  return Coordinates.create(lat, lng);
}

/**
 * Google's tollInfo shape:
 *   { estimatedPrice: [{ currencyCode: 'USD', units: '4', nanos: 250000000 }] }
 * - `units` is the integer dollar part as a STRING.
 * - `nanos` is the fractional billionths.
 *
 * Convert to Money in USD minor units:
 *   minor = units * 100 + Math.round(nanos / 1e7)
 *
 * Multi-currency tolls return multiple entries; we read the first.
 */
function readTollPrice(tollInfo: unknown): Money | null {
  if (typeof tollInfo !== 'object' || tollInfo === null) return null;
  const ti = tollInfo as { estimatedPrice?: unknown };
  if (!Array.isArray(ti.estimatedPrice) || ti.estimatedPrice.length === 0) {
    return null;
  }
  const first = ti.estimatedPrice[0] as
    | {
        currencyCode?: unknown;
        units?: unknown;
        nanos?: unknown;
      }
    | undefined;
  if (!first || first.currencyCode !== 'USD') return null;

  const unitsStr = typeof first.units === 'string' ? first.units : '0';
  const nanosNum = typeof first.nanos === 'number' ? first.nanos : 0;
  const units = Number.parseInt(unitsStr, 10);
  if (!Number.isFinite(units) || units < 0) return null;
  const minor = units * 100 + Math.round(nanosNum / 1e7);
  const r = Money.create(minor, 'USD');
  return r.ok ? r.value : null;
}

function invalid(field: string, message: string): ValidationError {
  return new ValidationError({
    code: 'routes_response_invalid_shape',
    message,
    field,
  });
}
