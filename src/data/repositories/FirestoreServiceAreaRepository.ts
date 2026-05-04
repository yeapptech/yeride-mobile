import {
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  orderBy,
  query,
} from '@react-native-firebase/firestore';

import type { RideService } from '@domain/entities/RideService';
import type { ServiceArea } from '@domain/entities/ServiceArea';
import type { ServiceAreaId } from '@domain/entities/ServiceAreaId';
import { NotFoundError } from '@domain/errors';
import type { ServiceAreaRepository } from '@domain/repositories';
import { Result } from '@domain/shared/Result';
import { LOG } from '@shared/logger';

import * as rideServiceMapper from '../mappers/rideServiceMapper';
import * as serviceAreaMapper from '../mappers/serviceAreaMapper';

const logger = LOG.extend('FirestoreServiceArea');

const COLLECTION = 'serviceAreas';
const RIDE_SERVICES_SUBCOLLECTION = 'rideServices';

/**
 * Concrete `ServiceAreaRepository` backed by
 * `@react-native-firebase/firestore` (modular API).
 *
 * Read-only — Firestore rules deny client writes (admin-only via Cloud
 * Functions). Matches the legacy yeride load-once pattern: one-shot
 * `getDocs` rather than a live subscription, since service-area
 * configuration is effectively static within a session.
 *
 * Mapper failures (a Firestore doc that doesn't conform to the schema) are
 * logged and the offending doc is skipped, so a single corrupt record
 * doesn't take down the whole catalog. The caller sees a list with N-1
 * entries and a warn-level log.
 */
export class FirestoreServiceAreaRepository implements ServiceAreaRepository {
  private readonly firestore = getFirestore();

  async listAll(): Promise<Result<readonly ServiceArea[], never>> {
    const snap = await getDocs(collection(this.firestore, COLLECTION));
    const out: ServiceArea[] = [];
    snap.forEach((d) => {
      const parsed = serviceAreaMapper.parseServiceAreaDoc(d.data());
      if (!parsed.ok) {
        // Phase 9 turn 11 — flipped from warn to error. Per-doc schema
        // validation on the service-areas catalog. Read-once (one
        // session = one read) so volume is low. Stable
        // `service_area_doc_invalid_schema` prefix; `parsed.error`
        // (a ValidationError wrapping the zod ZodError) flows through
        // the `error` meta field via the rawMeta channel. Audit
        // decision per Phase 9 turn 11 pre-checklist Q2.
        logger.error('listAll: skipping doc that failed schema validation', {
          id: d.id,
          error: new Error('service_area_doc_invalid_schema'),
        });
        return;
      }
      const domain = serviceAreaMapper.toDomain(d.id, parsed.value);
      if (!domain.ok) {
        // Phase 9 turn 11 — flipped from warn to error. Per-doc entity
        // construction failure. Stable
        // `service_area_doc_invalid_entity` prefix; domain.error.code
        // suffixes for grouping granularity.
        logger.error('listAll: skipping doc that failed entity construction', {
          id: d.id,
          error: new Error(
            `service_area_doc_invalid_entity: ${domain.error.code}`,
          ),
        });
        return;
      }
      out.push(domain.value);
    });
    // Stable ordering by doc id ascending — the resolve-active-area tie-break
    // documents this as load-bearing.
    out.sort((a, b) => String(a.id).localeCompare(String(b.id)));
    return Result.ok(out);
  }

  async findById(
    id: ServiceAreaId,
  ): Promise<Result<ServiceArea, NotFoundError>> {
    const snap = await getDoc(doc(this.firestore, COLLECTION, String(id)));
    const raw = snap.data();
    if (!raw) {
      return Result.err(
        new NotFoundError({
          code: 'service_area_not_found',
          message: `No service area with id ${String(id)}`,
          resource: 'service_area',
          id: String(id),
        }),
      );
    }
    const parsed = serviceAreaMapper.parseServiceAreaDoc(raw);
    if (!parsed.ok) {
      logger.error('findById: doc failed schema validation', {
        id: String(id),
      });
      return Result.err(
        new NotFoundError({
          code: 'service_area_corrupt',
          message: `Service area ${String(id)} exists but failed schema validation`,
          resource: 'service_area',
          id: String(id),
          cause: parsed.error,
        }),
      );
    }
    const domain = serviceAreaMapper.toDomain(String(id), parsed.value);
    if (!domain.ok) {
      logger.error('findById: doc failed entity construction', {
        id: String(id),
        code: domain.error.code,
      });
      return Result.err(
        new NotFoundError({
          code: 'service_area_corrupt',
          message: `Service area ${String(id)} could not be constructed`,
          resource: 'service_area',
          id: String(id),
          cause: domain.error,
        }),
      );
    }
    return Result.ok(domain.value);
  }

  async listRideServices(
    areaId: ServiceAreaId,
  ): Promise<Result<readonly RideService[], never>> {
    const subcoll = collection(
      this.firestore,
      COLLECTION,
      String(areaId),
      RIDE_SERVICES_SUBCOLLECTION,
    );
    // Order by costPerKm asc — matches legacy RiderHome ordering so the
    // cheapest tier shows first.
    const snap = await getDocs(query(subcoll, orderBy('costPerKm', 'asc')));
    const out: RideService[] = [];
    snap.forEach((d) => {
      const parsed = rideServiceMapper.parseRideServiceDoc(d.data());
      if (!parsed.ok) {
        // Phase 9 turn 11 — flipped from warn to error. Per-doc schema
        // validation on the rideServices subcollection. Stable
        // `ride_service_doc_invalid_schema` prefix; same audit
        // rationale as the listAll site above.
        logger.error(
          'listRideServices: skipping doc that failed schema validation',
          {
            areaId: String(areaId),
            id: d.id,
            error: new Error('ride_service_doc_invalid_schema'),
          },
        );
        return;
      }
      const domain = rideServiceMapper.toDomain(d.id, areaId, parsed.value);
      if (!domain.ok) {
        // Phase 9 turn 11 — flipped from warn to error. Per-doc entity
        // construction failure. Stable `ride_service_doc_invalid_entity`
        // prefix; domain.error.code suffixes.
        logger.error(
          'listRideServices: skipping doc that failed entity construction',
          {
            areaId: String(areaId),
            id: d.id,
            error: new Error(
              `ride_service_doc_invalid_entity: ${domain.error.code}`,
            ),
          },
        );
        return;
      }
      out.push(domain.value);
    });
    return Result.ok(out);
  }
}
