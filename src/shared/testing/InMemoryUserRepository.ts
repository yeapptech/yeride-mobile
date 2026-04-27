import type { SavedPlace, SavedPlaceId } from '@domain/entities/SavedPlace';
import type { User } from '@domain/entities/User';
import {
  upsertSavedPlace,
  removeSavedPlace as removePlaceFromUser,
} from '@domain/entities/User';
import type { UserId } from '@domain/entities/UserId';
import { ConflictError, NotFoundError, ValidationError } from '@domain/errors';
import type { UserRepository } from '@domain/repositories';
import { Result } from '@domain/shared/Result';

/**
 * In-memory UserRepository for use-case tests. Stores users by UID, and
 * notifies observers on any mutation that touches their user.
 *
 * Avatar upload returns a stable fake URL — tests assert on the URL pattern,
 * not the bytes uploaded.
 */
export class InMemoryUserRepository implements UserRepository {
  private users = new Map<UserId, User>();
  private observers = new Map<UserId, Set<(user: User | null) => void>>();

  /** Spy: each test can assert how many times update was called. */
  public spies = {
    update: 0,
    uploadAvatar: 0,
  };

  /* ────────── UserRepository ────────── */

  async getById(id: UserId): Promise<Result<User, NotFoundError>> {
    const u = this.users.get(id);
    if (!u) {
      return Result.err(
        new NotFoundError({
          code: 'user_not_found',
          message: 'User not found',
          resource: 'user',
          id: String(id),
        }),
      );
    }
    return Result.ok(u);
  }

  observeById(id: UserId, callback: (user: User | null) => void): () => void {
    let set = this.observers.get(id);
    if (!set) {
      set = new Set();
      this.observers.set(id, set);
    }
    set.add(callback);
    callback(this.users.get(id) ?? null);
    return () => {
      const cur = this.observers.get(id);
      if (cur) cur.delete(callback);
    };
  }

  async create(user: User): Promise<Result<User, ConflictError>> {
    if (this.users.has(user.id)) {
      return Result.err(
        new ConflictError({
          code: 'user_already_exists',
          message: 'A user with that id already exists',
        }),
      );
    }
    this.users.set(user.id, user);
    this.notify(user.id, user);
    return Result.ok(user);
  }

  async update(user: User): Promise<Result<User, NotFoundError>> {
    if (!this.users.has(user.id)) {
      return Result.err(
        new NotFoundError({
          code: 'user_not_found',
          message: 'User not found',
          resource: 'user',
          id: String(user.id),
        }),
      );
    }
    this.spies.update += 1;
    this.users.set(user.id, user);
    this.notify(user.id, user);
    return Result.ok(user);
  }

  async uploadAvatar(args: {
    userId: UserId;
    imageUri: string;
  }): Promise<Result<string, ValidationError>> {
    this.spies.uploadAvatar += 1;
    if (typeof args.imageUri !== 'string' || args.imageUri.length === 0) {
      return Result.err(
        new ValidationError({
          code: 'avatar_invalid_image_uri',
          message: 'imageUri is required',
          field: 'imageUri',
        }),
      );
    }
    const url = `https://avatars.fake/yeride/${String(args.userId)}.png`;
    return Result.ok(url);
  }

  async addSavedPlace(args: {
    userId: UserId;
    place: SavedPlace;
  }): Promise<Result<SavedPlace, NotFoundError | ConflictError>> {
    const user = this.users.get(args.userId);
    if (!user) {
      return Result.err(
        new NotFoundError({
          code: 'user_not_found',
          message: 'User not found',
          resource: 'user',
          id: String(args.userId),
        }),
      );
    }
    if (user.savedPlaces.some((p) => p.id === args.place.id)) {
      return Result.err(
        new ConflictError({
          code: 'saved_place_already_exists',
          message: 'A saved place with that id already exists',
        }),
      );
    }
    const next = upsertSavedPlace(user, args.place, new Date());
    this.users.set(args.userId, next);
    this.notify(args.userId, next);
    return Result.ok(args.place);
  }

  async updateSavedPlace(args: {
    userId: UserId;
    place: SavedPlace;
  }): Promise<Result<SavedPlace, NotFoundError>> {
    const user = this.users.get(args.userId);
    if (!user) {
      return Result.err(
        new NotFoundError({
          code: 'user_not_found',
          message: 'User not found',
          resource: 'user',
          id: String(args.userId),
        }),
      );
    }
    if (!user.savedPlaces.some((p) => p.id === args.place.id)) {
      return Result.err(
        new NotFoundError({
          code: 'saved_place_not_found',
          message: 'Saved place not found',
          resource: 'savedPlace',
          id: String(args.place.id),
        }),
      );
    }
    const next = upsertSavedPlace(user, args.place, new Date());
    this.users.set(args.userId, next);
    this.notify(args.userId, next);
    return Result.ok(args.place);
  }

  async removeSavedPlace(args: {
    userId: UserId;
    placeId: SavedPlaceId;
  }): Promise<Result<true, NotFoundError>> {
    const user = this.users.get(args.userId);
    if (!user) {
      return Result.err(
        new NotFoundError({
          code: 'user_not_found',
          message: 'User not found',
          resource: 'user',
          id: String(args.userId),
        }),
      );
    }
    if (!user.savedPlaces.some((p) => p.id === args.placeId)) {
      return Result.err(
        new NotFoundError({
          code: 'saved_place_not_found',
          message: 'Saved place not found',
          resource: 'savedPlace',
          id: String(args.placeId),
        }),
      );
    }
    const next = removePlaceFromUser(user, args.placeId, new Date());
    this.users.set(args.userId, next);
    this.notify(args.userId, next);
    return Result.ok(true);
  }

  /* ────────── Test-only helpers ────────── */

  /** Seed a user into the store for tests that need an existing record. */
  seed(user: User): void {
    this.users.set(user.id, user);
  }

  size(): number {
    return this.users.size;
  }

  private notify(id: UserId, user: User | null): void {
    const set = this.observers.get(id);
    if (!set) return;
    for (const cb of set) cb(user);
  }
}
