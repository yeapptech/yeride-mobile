import {
  doc,
  getDoc,
  getFirestore,
  onSnapshot,
  setDoc,
} from '@react-native-firebase/firestore';

import type { UserId } from '@domain/entities/UserId';
import type { UserLocation } from '@domain/entities/UserLocation';
import { NetworkError } from '@domain/errors';
import type { LocationRepository } from '@domain/repositories';
import { Result } from '@domain/shared/Result';
import { LOG } from '@shared/logger';

import * as userLocationMapper from '../mappers/userLocationMapper';

const logger = LOG.extend('FirestoreLocation');

const LOCATIONS = 'locations';

/**
 * Retry policy for `updateLocation`. Mirrors the legacy yeride pipeline:
 * up to 3 attempts with exponential backoff (1s / 2s / 4s) on transient
 * Firestore errors. Permission/auth/argument errors fail fast — retrying
 * those is just wasted bandwidth.
 */
const TRANSIENT_CODES = new Set([
  'deadline-exceeded',
  'unavailable',
  'cancelled',
  'internal',
  // Network-layer error from the SDK doesn't have a Firestore code; we
  // catch it via the `code === 'unknown'` fallback.
]);
const RETRY_DELAYS_MS = [1_000, 2_000, 4_000];

export class FirestoreLocationRepository implements LocationRepository {
  private readonly firestore = getFirestore();

  async updateLocation(
    location: UserLocation,
  ): Promise<Result<true, NetworkError>> {
    const ref = doc(this.firestore, LOCATIONS, String(location.userId));
    const docData = userLocationMapper.toDoc(location);
    let lastError: unknown = null;
    // Initial attempt + up to 3 retries = 4 total attempts.
    for (let attempt = 0; attempt < RETRY_DELAYS_MS.length + 1; attempt += 1) {
      try {
        await setDoc(ref, docData, { merge: true });
        if (attempt > 0) {
          logger.info('updateLocation succeeded after retry', {
            attempt: String(attempt),
          });
        }
        return Result.ok(true);
      } catch (e) {
        lastError = e;
        const code = errCode(e);
        const isTransient = TRANSIENT_CODES.has(code) || code === 'unknown';
        if (!isTransient || attempt >= RETRY_DELAYS_MS.length) {
          break;
        }
        const delay = RETRY_DELAYS_MS[attempt] ?? 4_000;
        // stays warn — best-effort retry. The final exhaustion at L73
        // already logs at error AND the wrapped NetworkError is then
        // re-thrown by `useUpdateLocationMutation`'s mutationFn and
        // lands at `useGpsLifecycle`'s `onError` (Phase 9 turn 8 L266
        // flip). Per-attempt visibility is dev-time only; flipping
        // would double-report (one non-fatal per attempt + one per
        // final). Audit decision per Phase 9 turn 11 pre-checklist Q4.
        logger.warn('updateLocation failed, retrying', {
          attempt: String(attempt + 1),
          code,
          delayMs: String(delay),
        });
        await sleep(delay);
      }
    }
    logger.error('updateLocation failed after retries', lastError);
    return Result.err(
      new NetworkError({
        code: 'location_update_failed',
        message: 'Could not write location after 3 retries',
        cause: lastError,
      }),
    );
  }

  subscribeToLocation(args: {
    userId: UserId;
    callback: (location: UserLocation | null) => void;
  }): () => void {
    const ref = doc(this.firestore, LOCATIONS, String(args.userId));
    return onSnapshot(
      ref,
      (snap) => {
        const raw = snap.data();
        if (!raw) {
          args.callback(null);
          return;
        }
        const parsed = userLocationMapper.parseUserLocationDoc(raw);
        if (!parsed.ok) {
          // Phase 9 turn 11 — flipped from warn to error. Per-doc
          // schema-validation failure on the locations stream. Plain-
          // object meta would skip the rawMeta channel's recordError
          // fan-out, so we construct an Error with a stable
          // `location_doc_invalid_schema` prefix that gives Crashlytics
          // a useful grouping key (the `code` suffix differentiates
          // distinct validation failures). Audit decision per Phase 9
          // turn 11 pre-checklist Q2 (flip per-doc validation).
          logger.error(
            'subscribeToLocation: doc failed schema validation',
            new Error(`location_doc_invalid_schema: ${parsed.error.code}`),
          );
          args.callback(null);
          return;
        }
        const domain = userLocationMapper.toDomain(
          String(args.userId),
          parsed.value,
        );
        if (!domain.ok) {
          // Phase 9 turn 11 — flipped from warn to error. Same shape
          // as the schema-validation site above; domain.error.code
          // suffixes the stable `location_doc_invalid_entity` prefix.
          logger.error(
            'subscribeToLocation: doc failed entity construction',
            new Error(`location_doc_invalid_entity: ${domain.error.code}`),
          );
          args.callback(null);
          return;
        }
        args.callback(domain.value);
      },
      (e) => {
        // Phase 9 turn 11 — flipped from warn to error. Firestore
        // stream-error callback. The SDK passes a real Error with a
        // `code` field (e.g. `'permission-denied'`, `'unavailable'`).
        // Pass `e` through directly — `extractError`'s `instanceof
        // Error` check resolves it via the rawMeta channel without a
        // constructed wrapper. Audit decision per Phase 9 turn 11
        // pre-checklist Q2 (flip per-doc validation / stream errors).
        logger.error('subscribeToLocation stream error', e);
        args.callback(null);
      },
    );
  }

  async getLastKnown(
    userId: UserId,
  ): Promise<Result<UserLocation | null, NetworkError>> {
    const ref = doc(this.firestore, LOCATIONS, String(userId));
    try {
      const snap = await getDoc(ref);
      const raw = snap.data();
      if (!raw) return Result.ok(null);
      const parsed = userLocationMapper.parseUserLocationDoc(raw);
      if (!parsed.ok) return Result.ok(null);
      const domain = userLocationMapper.toDomain(String(userId), parsed.value);
      return Result.ok(domain.ok ? domain.value : null);
    } catch (e) {
      // Phase 9 turn 11 — flipped from warn to error. Pre-empts the
      // stream subscription with a one-shot read; failure here means
      // the user sees a brief loading state instead of a stale-cache
      // hit (degraded UX path). The SDK throw is a real Error with a
      // `code` field, so passing `e` directly lets `extractError`
      // resolve it via the rawMeta channel without a constructed
      // wrapper. Audit decision per Phase 9 turn 11 pre-checklist Q3
      // (flip getLastKnown).
      logger.error('getLastKnown failed', e);
      return Result.err(
        new NetworkError({
          code: 'location_read_failed',
          message: 'Could not read last known location',
          cause: e,
        }),
      );
    }
  }
}

function errCode(e: unknown): string {
  if (typeof e === 'object' && e !== null && 'code' in e) {
    return String((e as { code: unknown }).code).replace(/^firestore\//, '');
  }
  return 'unknown';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
