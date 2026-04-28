import type { UserId } from '@domain/entities/UserId';
import type { UserLocation } from '@domain/entities/UserLocation';
import type { NetworkError } from '@domain/errors';
import type { LocationRepository } from '@domain/repositories';
import { Result } from '@domain/shared/Result';

/**
 * In-memory `LocationRepository` for use-case unit tests + the dev fakes
 * branch in the DI container. Stores locations keyed by userId, replays
 * writes through observers.
 *
 * Test seams:
 *   - `seed(location)` populates the store without writes.
 *   - `mockUpdateError(error)` makes the next `updateLocation` call return
 *     the given NetworkError.
 *   - `spies` counts every mutation method call.
 */
export class InMemoryLocationRepository implements LocationRepository {
  private locations = new Map<string, UserLocation>();
  private observers = new Map<
    string,
    Set<(loc: UserLocation | null) => void>
  >();

  public spies = {
    updateLocation: 0,
    getLastKnown: 0,
  };

  private nextUpdateError: NetworkError | null = null;

  async updateLocation(
    location: UserLocation,
  ): Promise<Result<true, NetworkError>> {
    this.spies.updateLocation += 1;
    if (this.nextUpdateError) {
      const e = this.nextUpdateError;
      this.nextUpdateError = null;
      return Result.err(e);
    }
    const key = String(location.userId);
    this.locations.set(key, location);
    this.notify(key, location);
    return Result.ok(true);
  }

  subscribeToLocation(args: {
    userId: UserId;
    callback: (location: UserLocation | null) => void;
  }): () => void {
    const key = String(args.userId);
    let set = this.observers.get(key);
    if (!set) {
      set = new Set();
      this.observers.set(key, set);
    }
    set.add(args.callback);
    args.callback(this.locations.get(key) ?? null);
    return () => {
      set?.delete(args.callback);
    };
  }

  async getLastKnown(
    userId: UserId,
  ): Promise<Result<UserLocation | null, NetworkError>> {
    this.spies.getLastKnown += 1;
    return Result.ok(this.locations.get(String(userId)) ?? null);
  }

  /* ────────── Test-only helpers ────────── */

  seed(location: UserLocation): void {
    this.locations.set(String(location.userId), location);
  }

  mockUpdateError(error: NetworkError): void {
    this.nextUpdateError = error;
  }

  reset(): void {
    this.locations.clear();
    this.observers.clear();
    this.nextUpdateError = null;
    this.spies = { updateLocation: 0, getLastKnown: 0 };
  }

  /* ────────── private ────────── */

  private notify(key: string, location: UserLocation | null): void {
    const set = this.observers.get(key);
    if (set) for (const o of set) o(location);
  }
}
