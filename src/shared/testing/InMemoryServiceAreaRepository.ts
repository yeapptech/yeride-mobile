import { Coordinates } from '@domain/entities/Coordinates';
import { Money } from '@domain/entities/Money';
import { RideService } from '@domain/entities/RideService';
import { RideServiceId } from '@domain/entities/RideServiceId';
import { ServiceArea } from '@domain/entities/ServiceArea';
import { ServiceAreaId } from '@domain/entities/ServiceAreaId';
import { NotFoundError } from '@domain/errors';
import type { ServiceAreaRepository } from '@domain/repositories';
import { Result } from '@domain/shared/Result';

/**
 * In-memory ServiceAreaRepository for use-case unit tests and the dev fakes
 * branch in the DI container. Seeded with two fixtures matching the legacy
 * yeride production data (us-fl-south-florida) plus a second region so
 * resolve-active-area logic can be exercised with multiple candidates.
 *
 * The fixtures are populated lazily on first call so test files don't pay
 * the construction cost when they only test other paths.
 */
export class InMemoryServiceAreaRepository implements ServiceAreaRepository {
  private areas: ServiceArea[] | null = null;

  private services = new Map<string, RideService[]>();

  /** Test-only knobs: spy on whether each method got called. */
  public spies = {
    listAll: 0,
    findById: 0,
    listRideServices: 0,
  };

  async listAll(): Promise<Result<readonly ServiceArea[], never>> {
    this.spies.listAll += 1;
    return Result.ok(this.seed());
  }

  async findById(
    id: ServiceAreaId,
  ): Promise<Result<ServiceArea, NotFoundError>> {
    this.spies.findById += 1;
    const all = this.seed();
    const found = all.find((a) => a.id === id);
    if (!found) {
      return Result.err(
        new NotFoundError({
          code: 'service_area_not_found',
          message: `No service area with id ${String(id)}`,
          resource: 'service_area',
          id: String(id),
        }),
      );
    }
    return Result.ok(found);
  }

  async listRideServices(
    areaId: ServiceAreaId,
  ): Promise<Result<readonly RideService[], never>> {
    this.spies.listRideServices += 1;
    this.seed();
    const list = this.services.get(String(areaId)) ?? [];
    return Result.ok(list);
  }

  /* ────────── Test-only helpers ────────── */

  /**
   * Replace the seeded fixtures with a custom set. Useful for use-case tests
   * that want to assert empty / single-area / multi-area scenarios without
   * coupling to production-shaped fixtures.
   */
  reset(args: {
    areas: ServiceArea[];
    services: Record<string, RideService[]>;
  }): void {
    this.areas = args.areas;
    this.services = new Map(Object.entries(args.services));
    this.spies = { listAll: 0, findById: 0, listRideServices: 0 };
  }

  /* ────────── private ────────── */

  private seed(): readonly ServiceArea[] {
    if (this.areas !== null) return this.areas;
    const sofl = mustOk(
      ServiceArea.create({
        id: mustOk(ServiceAreaId.create('us-fl-south-florida')),
        identifier: 'us-fl-south-florida',
        center: mustOk(Coordinates.create(25.7617, -80.1918)), // Miami
        radiusMeters: 500_000, // 500 km — matches legacy fixture
        notifyOnEntry: true,
        notifyOnDwell: false,
        notifyOnExit: true,
      }),
    );
    const bay = mustOk(
      ServiceArea.create({
        id: mustOk(ServiceAreaId.create('us-ca-bay-area')),
        identifier: 'us-ca-bay-area',
        center: mustOk(Coordinates.create(37.7749, -122.4194)), // San Francisco
        radiusMeters: 100_000, // 100 km — covers SF + Oakland + San Jose
        notifyOnEntry: true,
        notifyOnDwell: false,
        notifyOnExit: true,
      }),
    );
    this.areas = [sofl, bay];

    this.services.set(String(sofl.id), [
      makeRideService({
        id: 'economy',
        areaId: sofl.id,
        name: 'Economy',
        description: 'Affordable everyday rides',
        baseFare: 2.5,
        minimumFare: 5,
        cancelationFee: 2,
        seatCapacity: 4,
        costPerKm: 1.25,
        costPerMinute: 0.2,
      }),
      makeRideService({
        id: 'xl',
        areaId: sofl.id,
        name: 'XL',
        description: 'Up to six passengers',
        baseFare: 4,
        minimumFare: 8,
        cancelationFee: 3,
        seatCapacity: 6,
        costPerKm: 2,
        costPerMinute: 0.3,
      }),
    ]);
    this.services.set(String(bay.id), [
      makeRideService({
        id: 'economy',
        areaId: bay.id,
        name: 'Economy',
        description: 'Affordable everyday rides',
        baseFare: 3,
        minimumFare: 6,
        cancelationFee: 2,
        seatCapacity: 4,
        costPerKm: 1.5,
        costPerMinute: 0.25,
      }),
      makeRideService({
        id: 'premium',
        areaId: bay.id,
        name: 'Premium',
        description: 'Higher-end vehicles',
        baseFare: 6,
        minimumFare: 12,
        cancelationFee: 5,
        seatCapacity: 4,
        costPerKm: 2.75,
        costPerMinute: 0.4,
      }),
    ]);

    return this.areas;
  }
}

function mustOk<T>(r: { ok: true; value: T } | { ok: false; error: Error }): T {
  if (!r.ok) throw r.error;
  return r.value;
}

interface MakeRideServiceArgs {
  id: string;
  areaId: ServiceAreaId;
  name: string;
  description: string;
  baseFare: number;
  minimumFare: number;
  cancelationFee: number;
  seatCapacity: number;
  costPerKm: number;
  costPerMinute: number;
}

function makeRideService(args: MakeRideServiceArgs): RideService {
  return mustOk(
    RideService.create({
      id: mustOk(RideServiceId.create(args.id)),
      areaId: args.areaId,
      name: args.name,
      description: args.description,
      baseFare: mustOk(Money.fromMajor(args.baseFare, 'USD')),
      minimumFare: mustOk(Money.fromMajor(args.minimumFare, 'USD')),
      cancelationFee: mustOk(Money.fromMajor(args.cancelationFee, 'USD')),
      seatCapacity: args.seatCapacity,
      costPerKm: mustOk(Money.fromMajor(args.costPerKm, 'USD')),
      costPerMinute: mustOk(Money.fromMajor(args.costPerMinute, 'USD')),
    }),
  );
}
