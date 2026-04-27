import type { SavedPlace, SavedPlaceId } from '../entities/SavedPlace';
import type { User } from '../entities/User';
import type { UserId } from '../entities/UserId';
import type { ConflictError, NotFoundError, ValidationError } from '../errors';
import type { Result } from '../shared/Result';

/**
 * Read/write access to user profile documents (Firestore `users/{uid}` in
 * production, in-memory in tests).
 *
 * `User` is the authoritative domain type. The data adapter is responsible
 * for mapping Firestore docs ↔ User entities; the use cases never see
 * Firestore types.
 *
 * `getById` returns NotFound when the doc doesn't exist. `observe` does NOT
 * — it emits `null` on missing/deleted, so subscribers can react to the
 * sign-out / account-deletion case.
 */
export interface UserRepository {
  /** One-shot fetch. NotFound when the document does not exist. */
  getById(id: UserId): Promise<Result<User, NotFoundError>>;

  /**
   * Live subscription to a user document. Emits `null` if the document is
   * missing or removed. Returns a synchronous unsubscribe function.
   */
  observeById(id: UserId, callback: (user: User | null) => void): () => void;

  /**
   * Create the user document. Caller has already created the Auth account.
   * Conflicts (doc already exists) are flagged so the caller can recover
   * instead of overwriting silently.
   */
  create(user: User): Promise<Result<User, ConflictError>>;

  /**
   * Persist updates to an existing user. Implementations must merge — they
   * must not overwrite the entire document and lose fields the client
   * doesn't know about.
   */
  update(user: User): Promise<Result<User, NotFoundError>>;

  /**
   * Upload a new avatar image and return its public URL. Caller is
   * responsible for then writing the URL into the User via `update`.
   *
   * `imageUri` is whatever the platform image picker returned — the data
   * adapter knows how to read it.
   */
  uploadAvatar(args: {
    userId: UserId;
    imageUri: string;
  }): Promise<Result<string, ValidationError>>;

  /**
   * Saved-places sub-API. These exist as separate methods so adapters can
   * use Firestore array-element transforms (faster + safer concurrency than
   * read-modify-write on the whole user doc).
   */
  addSavedPlace(args: {
    userId: UserId;
    place: SavedPlace;
  }): Promise<Result<SavedPlace, NotFoundError | ConflictError>>;

  updateSavedPlace(args: {
    userId: UserId;
    place: SavedPlace;
  }): Promise<Result<SavedPlace, NotFoundError>>;

  removeSavedPlace(args: {
    userId: UserId;
    placeId: SavedPlaceId;
  }): Promise<Result<true, NotFoundError>>;
}
