import type { UserId } from '../entities/UserId';
import type { UserLocation } from '../entities/UserLocation';
import type { NetworkError } from '../errors';
import type { Result } from '../shared/Result';

/**
 * Live-location read/write surface for the GPS pipeline. Backed by
 * `locations/{userId}` in Firestore; the rider's UI uses the subscription
 * to track the driver, the driver's UI doesn't observe its own location
 * (it has the GPS sensor directly), and admin tooling uses both.
 *
 * Note on subscribe shape: legacy yeride's `subscribeToUserLocation`
 * returns a `Promise<unsubscribe>` (it does an async permissions check
 * under the hood), which the legacy CLAUDE.md explicitly flagged as a
 * footgun — React's effect cleanup contract is synchronous, so the
 * legacy callsites need a `cancelled` flag dance. The rewrite fixes
 * this: we return a synchronous unsubscribe like every other observer
 * in the codebase. The auth check that legacy's subscribe waited on
 * happens via Firestore rules at query time instead.
 */
export interface LocationRepository {
  /**
   * Write the user's latest GPS reading. The implementation is responsible
   * for retry / backoff on transient errors — the caller doesn't have to
   * know.
   *
   * NetworkError when retries are exhausted. The caller can choose to
   * surface a "GPS upload failed" toast or silently swallow (the next
   * GPS tick will produce another write anyway).
   */
  updateLocation(location: UserLocation): Promise<Result<true, NetworkError>>;

  /**
   * Subscribe to a user's live location. Emits `null` when the doc is
   * missing (no GPS uploaded yet) and on stream errors. Returns a
   * synchronous unsubscribe function.
   */
  subscribeToLocation(args: {
    userId: UserId;
    callback: (location: UserLocation | null) => void;
  }): () => void;

  /**
   * One-shot read of the user's last known location. Used for "resume the
   * trip on app cold start" flows where we need the driver's last GPS
   * reading before the live stream attaches.
   */
  getLastKnown(
    userId: UserId,
  ): Promise<Result<UserLocation | null, NetworkError>>;
}
