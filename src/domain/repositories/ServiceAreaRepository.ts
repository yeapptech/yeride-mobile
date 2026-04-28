import type { RideService } from '../entities/RideService';
import type { ServiceArea } from '../entities/ServiceArea';
import type { ServiceAreaId } from '../entities/ServiceAreaId';
import type { NotFoundError } from '../errors';
import type { Result } from '../shared/Result';

/**
 * Read access to the static service-area catalog (Firestore
 * `serviceAreas/{id}` collection in production, in-memory in tests).
 *
 * Why no observe / write methods:
 *   - Service areas and ride services are admin-managed config — the legacy
 *     yeride app reads them once on Home screen mount and keeps the snapshot
 *     for the session. Firestore rules deny client writes (admin-only via
 *     Cloud Functions), so a write API would never be reachable.
 *   - If we later want live updates for ops staff, this contract grows to
 *     include `observeAll(callback)`. Not needed for the rider/driver flow
 *     in Phases 2–3.
 *
 * The presentation layer wraps these reads behind `useServiceAreaStore`
 * (Zustand), which caches results for the session.
 */
export interface ServiceAreaRepository {
  /**
   * One-shot fetch of every service area. Empty list is a valid result —
   * the caller should treat that as "we don't operate anywhere yet" and
   * surface an appropriate UI rather than treating it as an error.
   */
  listAll(): Promise<Result<readonly ServiceArea[], never>>;

  /**
   * One-shot fetch of a single service area by Firestore document id.
   */
  findById(id: ServiceAreaId): Promise<Result<ServiceArea, NotFoundError>>;

  /**
   * One-shot fetch of every ride-service tier that belongs to the given
   * service area, ordered by `costPerKm` ascending (matches legacy ordering
   * so the Economy tier shows first). Empty list is a valid result.
   */
  listRideServices(
    areaId: ServiceAreaId,
  ): Promise<Result<readonly RideService[], never>>;
}
