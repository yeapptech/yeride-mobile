import {
  arrayRemove,
  arrayUnion,
  doc,
  getDoc,
  getFirestore,
  onSnapshot,
  setDoc,
  updateDoc,
  type FirebaseFirestoreTypes,
} from '@react-native-firebase/firestore';
import {
  getStorage,
  putFile,
  ref as storageRef,
  getDownloadURL,
} from '@react-native-firebase/storage';

import type { SavedPlace, SavedPlaceId } from '@domain/entities/SavedPlace';
import type { User } from '@domain/entities/User';
import type { UserId } from '@domain/entities/UserId';
import { ConflictError, NotFoundError, ValidationError } from '@domain/errors';
import type { UserRepository } from '@domain/repositories';
import { Result } from '@domain/shared/Result';
import { LOG } from '@shared/logger';

import { parseUserDoc, toDoc, toDomain } from '../mappers/userMapper';

const logger = LOG.extend('FirestoreUser');

const USERS_COLLECTION = 'users';

/**
 * Concrete `UserRepository` backed by `@react-native-firebase/firestore` and
 * `/storage`. Uses the modular API.
 *
 *   - `getById` does a one-shot fetch and returns NotFound when the doc is
 *     missing.
 *   - `observeById` subscribes via `onSnapshot` and emits `null` when the
 *     doc disappears (sign-out / account-delete race).
 *   - Saved-place writes use Firestore `arrayUnion` / `arrayRemove` against
 *     the `savedPlaces` array — atomic with respect to other clients,
 *     unlike read-modify-write on the whole user doc.
 *   - Avatar upload writes the bytes to Storage at `users/{uid}/avatar.jpg`,
 *     fetches a download URL, and returns it; the caller writes the URL
 *     back into the user doc via `update`.
 */
export class FirestoreUserRepository implements UserRepository {
  private readonly firestore = getFirestore();
  private readonly storage = getStorage();

  async getById(id: UserId): Promise<Result<User, NotFoundError>> {
    const ref = this.docRef(id);
    const snap = await getDoc(ref);
    const raw = snap.data();
    if (!raw) {
      return Result.err(this.notFound(id));
    }
    return this.dataToDomain(id, raw);
  }

  observeById(id: UserId, callback: (user: User | null) => void): () => void {
    const ref = this.docRef(id);
    return onSnapshot(
      ref,
      (snap) => {
        const raw = snap.data();
        if (!raw) {
          callback(null);
          return;
        }
        const r = this.dataToDomain(id, raw);
        callback(r.ok ? r.value : null);
      },
      (err: Error) => {
        logger.error('observeById error', err);
        callback(null);
      },
    );
  }

  async create(user: User): Promise<Result<User, ConflictError>> {
    const ref = this.docRef(user.id);
    const existing = await getDoc(ref);
    if (existing.exists()) {
      return Result.err(
        new ConflictError({
          code: 'user_already_exists',
          message: 'A user with that id already exists',
        }),
      );
    }
    await setDoc(ref, toDoc(user));
    return Result.ok(user);
  }

  async update(user: User): Promise<Result<User, NotFoundError>> {
    const ref = this.docRef(user.id);
    const existing = await getDoc(ref);
    if (!existing.exists()) {
      return Result.err(this.notFound(user.id));
    }
    // setDoc with merge:true behaves like Firestore's "update with deep
    // merge" for nested fields, while still respecting our toDoc shape.
    await setDoc(ref, toDoc(user), { merge: true });
    return Result.ok(user);
  }

  async uploadAvatar(args: {
    userId: UserId;
    imageUri: string;
  }): Promise<Result<string, ValidationError>> {
    if (typeof args.imageUri !== 'string' || args.imageUri.length === 0) {
      return Result.err(
        new ValidationError({
          code: 'avatar_invalid_image_uri',
          message: 'imageUri is required',
          field: 'imageUri',
        }),
      );
    }
    const path = `users/${String(args.userId)}/avatar.jpg`;
    const ref = storageRef(this.storage, path);
    await putFile(ref, args.imageUri);
    const url = await getDownloadURL(ref);
    return Result.ok(url);
  }

  async addSavedPlace(args: {
    userId: UserId;
    place: SavedPlace;
  }): Promise<Result<SavedPlace, NotFoundError | ConflictError>> {
    const ref = this.docRef(args.userId);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      return Result.err(this.notFound(args.userId));
    }
    const data = snap.data() ?? {};
    const places = Array.isArray(
      (data as { savedPlaces?: unknown }).savedPlaces,
    )
      ? ((data as { savedPlaces: { place_id?: string }[] }).savedPlaces ?? [])
      : [];
    if (places.some((p) => p.place_id === String(args.place.id))) {
      return Result.err(
        new ConflictError({
          code: 'saved_place_already_exists',
          message: 'A saved place with that id already exists',
        }),
      );
    }
    await updateDoc(ref, {
      savedPlaces: arrayUnion(savedPlaceToDocShape(args.place)),
      updatedDateTime: new Date().toISOString(),
    });
    return Result.ok(args.place);
  }

  async updateSavedPlace(args: {
    userId: UserId;
    place: SavedPlace;
  }): Promise<Result<SavedPlace, NotFoundError>> {
    // Firestore can't "replace within array by id" atomically — we have to
    // read, mutate, write. Concurrent edits to the same place are last-
    // write-wins, which matches the legacy behavior.
    const ref = this.docRef(args.userId);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      return Result.err(this.notFound(args.userId));
    }
    const data = snap.data() ?? {};
    const places = Array.isArray(
      (data as { savedPlaces?: unknown }).savedPlaces,
    )
      ? [
          ...((data as { savedPlaces: { place_id?: string }[] }).savedPlaces ??
            []),
        ]
      : [];
    const idx = places.findIndex((p) => p.place_id === String(args.place.id));
    if (idx === -1) {
      return Result.err(
        new NotFoundError({
          code: 'saved_place_not_found',
          message: 'Saved place not found',
          resource: 'savedPlace',
          id: String(args.place.id),
        }),
      );
    }
    places[idx] = savedPlaceToDocShape(args.place);
    await updateDoc(ref, {
      savedPlaces: places,
      updatedDateTime: new Date().toISOString(),
    });
    return Result.ok(args.place);
  }

  async removeSavedPlace(args: {
    userId: UserId;
    placeId: SavedPlaceId;
  }): Promise<Result<true, NotFoundError>> {
    const ref = this.docRef(args.userId);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      return Result.err(this.notFound(args.userId));
    }
    const data = snap.data() ?? {};
    const places = Array.isArray(
      (data as { savedPlaces?: unknown }).savedPlaces,
    )
      ? ((data as { savedPlaces: { place_id?: string }[] }).savedPlaces ?? [])
      : [];
    const target = places.find((p) => p.place_id === String(args.placeId));
    if (!target) {
      return Result.err(
        new NotFoundError({
          code: 'saved_place_not_found',
          message: 'Saved place not found',
          resource: 'savedPlace',
          id: String(args.placeId),
        }),
      );
    }
    await updateDoc(ref, {
      savedPlaces: arrayRemove(target),
      updatedDateTime: new Date().toISOString(),
    });
    return Result.ok(true);
  }

  /* ─────────────────────────── private ────────────────────────── */

  private docRef(id: UserId) {
    return doc(this.firestore, USERS_COLLECTION, String(id));
  }

  private notFound(id: UserId): NotFoundError {
    return new NotFoundError({
      code: 'user_not_found',
      message: 'User not found',
      resource: 'user',
      id: String(id),
    });
  }

  private dataToDomain(
    id: UserId,
    raw: FirebaseFirestoreTypes.DocumentData,
  ): Result<User, NotFoundError> {
    const parsed = parseUserDoc(raw);
    if (!parsed.ok) {
      logger.error('user doc failed schema validation', {
        userId: String(id),
        cause: parsed.error.message,
      });
      // Schema-invalid doc — surface as not_found rather than crashing the
      // session. Should never happen in practice; if it does, the user
      // signs out cleanly and we still get the error in Crashlytics.
      return Result.err(this.notFound(id));
    }
    const user = toDomain(id, parsed.value);
    if (!user.ok) {
      logger.error('user doc failed domain validation', {
        userId: String(id),
        cause: user.error.message,
      });
      return Result.err(this.notFound(id));
    }
    return Result.ok(user.value);
  }
}

/* ─────────────────────────── helpers ──────────────────────────── */

function savedPlaceToDocShape(place: SavedPlace): {
  place_id: string;
  label: string;
  address: string;
  latitude: number;
  longitude: number;
} {
  return {
    place_id: String(place.id),
    label: place.label,
    address: place.address.label,
    latitude: place.address.coordinates.latitude,
    longitude: place.address.coordinates.longitude,
  };
}
