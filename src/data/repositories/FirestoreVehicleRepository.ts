import {
  arrayRemove,
  arrayUnion,
  doc,
  getDoc,
  getFirestore,
  onSnapshot,
  setDoc,
  updateDoc,
  writeBatch,
  type FirebaseFirestoreTypes,
} from '@react-native-firebase/firestore';

import type { UserId } from '@domain/entities/UserId';
import type { Vehicle } from '@domain/entities/Vehicle';
import type { Vin } from '@domain/entities/Vin';
import {
  AuthorizationError,
  ConflictError,
  NetworkError,
  NotFoundError,
  ValidationError,
} from '@domain/errors';
import type { VehicleRepository } from '@domain/repositories';
import { Result } from '@domain/shared/Result';
import { LOG } from '@shared/logger';

import { parseVehicleDoc, toDoc, toDomain } from '../mappers/vehicleMapper';

const logger = LOG.extend('FirestoreVehicle');

const VEHICLES = 'vehicles';
const USERS = 'users';

/**
 * Concrete `VehicleRepository` backed by `@react-native-firebase/firestore`
 * (modular API).
 *
 *   - `vehicles/{VIN}` is the global vehicles collection. VIN is the
 *     document id; `getByVin` / `existsByVin` / `getDoc` use direct refs.
 *   - `users/{driverId}.vehicleIds[]`, `.activeVehicleId`, `.services.ride`
 *     are the cross-aggregate fields. Mutations to those fields go
 *     through THIS repo, not `UserRepository` — vehicle ownership is a
 *     vehicle-aggregate concern.
 *
 * Cross-aggregate writes use `writeBatch` so the user doc never observes a
 * `vehicleIds[]` array out of sync with the vehicles collection. We use a
 * batch (rather than `runTransaction`) because none of the write paths
 * actually need to read inside the transaction window — the read happens
 * before the batch, and Firestore's `arrayUnion` / `arrayRemove`
 * sentinels are themselves atomic per-doc.
 *
 * `setDoc(..., { merge: true })` everywhere, so any forward-compat fields
 * the legacy app may write (and we don't yet model) are preserved.
 *
 * Subscription methods return synchronous unsubscribe — the
 * `subscribeByDriver` teardown closes the user-doc watch AND every fan-
 * out per-vehicle watch.
 */
export class FirestoreVehicleRepository implements VehicleRepository {
  private readonly firestore = getFirestore();

  /* ────────── reads ────────── */

  async getByVin(vin: Vin): Promise<Result<Vehicle, NotFoundError>> {
    const ref = this.vehicleRef(vin);
    const snap = await getDoc(ref);
    const raw = snap.data();
    if (!raw) return Result.err(this.notFound(vin));
    return this.toDomainOrCorrupt(String(vin), raw);
  }

  async existsByVin(vin: Vin): Promise<Result<boolean, NetworkError>> {
    try {
      const ref = this.vehicleRef(vin);
      const snap = await getDoc(ref);
      const raw = snap.data();
      if (!raw) return Result.ok(false);
      // Match legacy `isVINRegistered`: pending or approved blocks
      // re-registration; rejected / suspended / deleted does not.
      const status = (raw as { status?: unknown }).status;
      return Result.ok(status === 'pending' || status === 'approved');
    } catch (e) {
      logger.warn('existsByVin failed', { code: errCode(e) });
      return Result.err(
        new NetworkError({
          code: 'vehicle_exists_check_failed',
          message: 'Could not check VIN registration',
          cause: e,
        }),
      );
    }
  }

  async listByDriver(args: {
    driverId: UserId;
  }): Promise<Result<readonly Vehicle[], NetworkError>> {
    try {
      const ids = await this.readDriverVehicleIds(args.driverId);
      if (ids.length === 0) return Result.ok([]);

      // Fetch each vehicle by VIN. Per-doc validation failures are skipped,
      // matching legacy `getDriverVehicles` (which silently filtered nulls).
      const fetches = await Promise.all(
        ids.map(async (vin) => {
          try {
            const snap = await getDoc(this.vehicleRefRaw(vin));
            const raw = snap.data();
            if (!raw) return null;
            const r = this.toDomainOrCorrupt(vin, raw);
            return r.ok ? r.value : null;
          } catch {
            return null;
          }
        }),
      );
      const out = fetches.filter((v): v is Vehicle => v !== null);
      out.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      return Result.ok(out);
    } catch (e) {
      logger.warn('listByDriver failed', { code: errCode(e) });
      return Result.err(
        new NetworkError({
          code: 'vehicle_list_failed',
          message: 'Could not load driver vehicles',
          cause: e,
        }),
      );
    }
  }

  subscribeByDriver(args: {
    driverId: UserId;
    callback: (vehicles: readonly Vehicle[]) => void;
  }): () => void {
    // Mirrors legacy `subscribeToDriverVehicles`:
    //   1. Watch the user doc for vehicleIds changes.
    //   2. On every emission, dedupe vehicleIds, tear down old per-VIN
    //      subscriptions, fan out fresh ones.
    //   3. Each per-VIN listener updates a shared map; the map is sorted
    //      by createdAt desc and pushed through `callback` on every change.
    //
    // Synchronous unsubscribe closes the user-doc watch + every per-VIN
    // watch.
    const userRef = doc(this.firestore, USERS, String(args.driverId));
    let perVehicleUnsubs: Array<() => void> = [];
    const currentVehicles = new Map<string, Vehicle>();

    const emit = () => {
      const out = Array.from(currentVehicles.values()).sort(
        (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
      );
      args.callback(out);
    };

    const userUnsub = onSnapshot(
      userRef,
      (userSnap) => {
        const data = userSnap.data();
        if (!data) {
          // User doc doesn't exist (deleted / sign-out race) — emit empty.
          for (const u of perVehicleUnsubs) u();
          perVehicleUnsubs = [];
          currentVehicles.clear();
          args.callback([]);
          return;
        }
        const ids = readVehicleIdsFromUserDoc(data);

        // Tear down old per-VIN subs and reset the map. Could be smarter
        // by diffing, but legacy redoes this on every user-doc emission
        // and the per-VIN re-subscribe is O(n) doc reads — acceptable
        // given a driver typically has 1-2 vehicles.
        for (const u of perVehicleUnsubs) u();
        perVehicleUnsubs = [];
        currentVehicles.clear();

        if (ids.length === 0) {
          args.callback([]);
          return;
        }

        for (const vin of ids) {
          const vehicleRef = this.vehicleRefRaw(vin);
          const vUnsub = onSnapshot(
            vehicleRef,
            (vSnap) => {
              const raw = vSnap.data();
              if (!raw) {
                currentVehicles.delete(vin);
                emit();
                return;
              }
              const r = this.toDomainOrCorrupt(vin, raw);
              if (r.ok) {
                currentVehicles.set(vin, r.value);
              } else {
                currentVehicles.delete(vin);
              }
              emit();
            },
            (e) => {
              logger.warn('subscribeByDriver per-vehicle error', {
                vin,
                code: errCode(e),
              });
            },
          );
          perVehicleUnsubs.push(vUnsub);
        }
      },
      (e) => {
        logger.warn('subscribeByDriver user error', { code: errCode(e) });
        args.callback([]);
      },
    );

    return () => {
      userUnsub();
      for (const u of perVehicleUnsubs) u();
      perVehicleUnsubs = [];
      currentVehicles.clear();
    };
  }

  /* ────────── writes ────────── */

  async create(args: {
    driverId: UserId;
    vehicle: Vehicle;
  }): Promise<Result<Vehicle, ConflictError | ValidationError>> {
    const vinKey = String(args.vehicle.vin);
    const ref = this.vehicleRefRaw(vinKey);
    const userRef = doc(this.firestore, USERS, String(args.driverId));

    // Pre-flight conflict check: matches legacy `isVINRegistered` filter.
    const existing = await getDoc(ref);
    if (existing.exists()) {
      const status = (existing.data() as { status?: unknown }).status;
      if (status === 'pending' || status === 'approved') {
        return Result.err(
          new ConflictError({
            code: 'vehicle_already_exists',
            message: `Vehicle ${vinKey} already exists`,
          }),
        );
      }
      // Re-registering a previously rejected / suspended / deleted vehicle
      // is allowed — legacy parity. Fall through to the write.
    }

    // Atomic write: vehicle doc + user.vehicleIds[] in one batch.
    const batch = writeBatch(this.firestore);
    batch.set(ref, toDoc(args.vehicle), { merge: true });
    batch.set(
      userRef,
      {
        vehicleIds: arrayUnion(vinKey),
        updatedAt: new Date().toISOString(),
      },
      { merge: true },
    );
    await batch.commit();
    return Result.ok(args.vehicle);
  }

  async update(
    vehicle: Vehicle,
  ): Promise<
    Result<Vehicle, NotFoundError | AuthorizationError | ValidationError>
  > {
    const ref = this.vehicleRef(vehicle.vin);
    try {
      // Use setDoc with merge so any fields we don't track are preserved.
      // We do NOT pre-check existence: the entity transition that produced
      // this `vehicle` was applied to a hydrated entity that came from a
      // doc that DID exist. If a concurrent delete races us we'd silently
      // recreate the doc — acceptable, because the soft-delete path
      // unlinks the VIN from the driver anyway.
      await setDoc(ref, toDoc(vehicle), { merge: true });
      return Result.ok(vehicle);
    } catch (e) {
      logger.error('update failed', e);
      const code = errCode(e);
      if (code === 'permission-denied') {
        return Result.err(
          new AuthorizationError({
            code: 'vehicle_update_forbidden',
            message: 'Not allowed to update this vehicle',
            cause: e,
          }),
        );
      }
      throw e;
    }
  }

  async softDelete(args: {
    driverId: UserId;
    vin: Vin;
  }): Promise<Result<true, NotFoundError | ValidationError>> {
    const vinKey = String(args.vin);
    const vehicleRef = this.vehicleRefRaw(vinKey);
    const userRef = doc(this.firestore, USERS, String(args.driverId));

    const vehicleSnap = await getDoc(vehicleRef);
    const raw = vehicleSnap.data();
    if (!raw) return Result.err(this.notFound(args.vin));

    const vehicleR = this.toDomainOrCorrupt(vinKey, raw);
    if (!vehicleR.ok) {
      return Result.err(
        new ValidationError({
          code: 'vehicle_doc_invalid_shape',
          message: vehicleR.error.message,
          field: 'vehicle',
        }),
      );
    }

    // Verify ownership before mutating the user doc — defense in depth on
    // top of Firestore Security Rules. The user's vehicleIds[] is the
    // authoritative source of ownership.
    const ids = await this.readDriverVehicleIds(args.driverId);
    if (!ids.includes(vinKey)) {
      return Result.err(
        new ValidationError({
          code: 'vehicle_not_owned_by_driver',
          message: `Driver ${String(args.driverId)} does not own vehicle ${vinKey}`,
          field: 'vin',
        }),
      );
    }

    const markedR = vehicleR.value.markDeleted(new Date());
    if (!markedR.ok) return markedR;

    // Read the current activeVehicleId so we can conditionally clear it.
    const userSnap = await getDoc(userRef);
    const activeVehicleId = userSnap.exists()
      ? (userSnap.data() as { activeVehicleId?: unknown }).activeVehicleId
      : null;

    const batch = writeBatch(this.firestore);
    batch.set(vehicleRef, toDoc(markedR.value), { merge: true });
    const userUpdate: Record<string, unknown> = {
      vehicleIds: arrayRemove(vinKey),
      updatedAt: new Date().toISOString(),
    };
    if (activeVehicleId === vinKey) {
      userUpdate['activeVehicleId'] = null;
    }
    batch.set(userRef, userUpdate, { merge: true });
    await batch.commit();
    return Result.ok(true);
  }

  async setActive(args: {
    driverId: UserId;
    vin: Vin | null;
  }): Promise<
    Result<true, NotFoundError | AuthorizationError | ValidationError>
  > {
    const userRef = doc(this.firestore, USERS, String(args.driverId));

    // Clear path: just null out activeVehicleId. Legacy doesn't reset
    // services.ride here either — driver going offline still has the
    // services list cached on user.
    if (args.vin === null) {
      await updateDoc(userRef, {
        activeVehicleId: null,
        updatedAt: new Date().toISOString(),
      });
      return Result.ok(true);
    }

    const vinKey = String(args.vin);

    // 1. Verify ownership.
    const ids = await this.readDriverVehicleIds(args.driverId);
    if (!ids.includes(vinKey)) {
      return Result.err(
        new ValidationError({
          code: 'vehicle_not_owned_by_driver',
          message: `Driver ${String(args.driverId)} does not own vehicle ${vinKey}`,
          field: 'vin',
        }),
      );
    }

    // 2. Read the vehicle to surface eligibleServices.
    const vehicleSnap = await getDoc(this.vehicleRefRaw(vinKey));
    const raw = vehicleSnap.data();
    if (!raw) return Result.err(this.notFound(args.vin));
    const vehicleR = this.toDomainOrCorrupt(vinKey, raw);
    if (!vehicleR.ok) {
      return Result.err(
        new ValidationError({
          code: 'vehicle_doc_invalid_shape',
          message: vehicleR.error.message,
          field: 'vehicle',
        }),
      );
    }
    const vehicle = vehicleR.value;

    if (vehicle.status !== 'approved') {
      return Result.err(
        new ValidationError({
          code: 'vehicle_not_approved',
          message: `Vehicle ${vinKey} is not approved (status="${vehicle.status}")`,
          field: 'status',
        }),
      );
    }

    // 3. Single-doc write: activeVehicleId + services.ride.
    await setDoc(
      userRef,
      {
        activeVehicleId: vinKey,
        services: { ride: vehicle.eligibleServices.map(String) },
        updatedAt: new Date().toISOString(),
      },
      { merge: true },
    );
    return Result.ok(true);
  }

  /* ────────── private ────────── */

  private vehicleRef(vin: Vin) {
    return doc(this.firestore, VEHICLES, String(vin));
  }

  private vehicleRefRaw(vin: string) {
    return doc(this.firestore, VEHICLES, vin);
  }

  private notFound(vin: Vin): NotFoundError {
    return new NotFoundError({
      code: 'vehicle_not_found',
      message: `Vehicle ${String(vin)} not found`,
      resource: 'vehicle',
      id: String(vin),
    });
  }

  private async readDriverVehicleIds(driverId: UserId): Promise<string[]> {
    const userRef = doc(this.firestore, USERS, String(driverId));
    const snap = await getDoc(userRef);
    if (!snap.exists()) return [];
    return readVehicleIdsFromUserDoc(snap.data() ?? {});
  }

  private toDomainOrCorrupt(
    vinDocId: string,
    raw: FirebaseFirestoreTypes.DocumentData,
  ): Result<Vehicle, NotFoundError> {
    const parsed = parseVehicleDoc(raw);
    if (!parsed.ok) {
      logger.error('vehicle doc failed schema validation', {
        vin: vinDocId,
        cause: parsed.error.message,
      });
      return Result.err(
        new NotFoundError({
          code: 'vehicle_doc_corrupt',
          message: 'Vehicle doc failed schema validation',
          resource: 'vehicle',
          id: vinDocId,
        }),
      );
    }
    const vehicleR = toDomain(vinDocId, parsed.value);
    if (!vehicleR.ok) {
      logger.error('vehicle doc failed domain validation', {
        vin: vinDocId,
        cause: vehicleR.error.message,
      });
      return Result.err(
        new NotFoundError({
          code: 'vehicle_doc_corrupt',
          message: 'Vehicle doc failed domain validation',
          resource: 'vehicle',
          id: vinDocId,
        }),
      );
    }
    return Result.ok(vehicleR.value);
  }
}

/* ────────── shared helpers ────────── */

function readVehicleIdsFromUserDoc(
  data: FirebaseFirestoreTypes.DocumentData,
): string[] {
  const raw = (data as { vehicleIds?: unknown }).vehicleIds;
  if (!Array.isArray(raw)) return [];
  // Dedupe + filter to non-empty strings, mirroring legacy
  // `[...new Set(driverData?.vehicleIds || [])]`.
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== 'string' || v.length === 0) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

function errCode(e: unknown): string {
  if (typeof e === 'object' && e !== null && 'code' in e) {
    const code = (e as { code: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return 'unknown';
}
