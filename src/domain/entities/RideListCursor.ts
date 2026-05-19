import { ValidationError } from '../errors/ValidationError';
import { brand, type Brand } from '../shared/Brand';
import { Result } from '../shared/Result';

import type { Ride } from './Ride';

/**
 * Opaque cursor for paginated `RideRepository.listByPassenger` /
 * `listByDriver` reads. Carries the boundary identity needed for
 * `startAfter` clauses (last page's last row).
 *
 * Encoded as `"${createdDateTimeMillis}:${docId}"`. The data adapter
 * uses ONLY the `createdDateTimeMillis` segment — single-field
 * `startAfter(<iso>)` against the query's `orderBy('createdDateTime',
 * 'desc')`. This matches the legacy yeride query shape (no composite
 * index required) and keeps Firestore's read cost minimal.
 *
 * Tie semantics: with single-field `startAfter(<iso>)` on a desc
 * order, Firestore skips ALL docs whose `createdDateTime` equals the
 * cursor's millisecond. If two rides on the same per-user timeline
 * shared the same `createdDateTime` to the millisecond, the
 * tie-mate(s) after the boundary would not appear on subsequent
 * pages. In practice this is functionally impossible — a single
 * passenger or driver can't create two ride docs in the same
 * millisecond — so the rewrite accepts the simpler single-field
 * shape. `docId` is still encoded in the cursor for forward
 * compatibility: if a future migration ever moves to composite
 * `orderBy + startAfter(iso, docId)` we can wire it on without a
 * cursor format change.
 *
 * The cursor is opaque to callers — only the Firestore adapter knows
 * how to interpret it. The in-memory fake matches the real adapter's
 * tie-skip semantics for test parity. Branded so a cursor cannot be
 * passed where another string-shaped id is expected.
 */
export type RideListCursor = Brand<string, 'RideListCursor'>;

const ENCODED_REGEX = /^([0-9]+):([A-Za-z0-9_-]+)$/;
const MAX_DOC_ID_LEN = 64;

export interface RideListCursorProps {
  /**
   * Last page's last row `createdDateTime` in milliseconds since
   * epoch. Must be `>= 0`.
   */
  readonly createdAtMillis: number;
  /**
   * Last page's last row Firestore document id. Must be non-empty and
   * match the Firestore-doc-id charset (alphanumeric + `_` + `-`).
   */
  readonly docId: string;
}

export const RideListCursor = {
  /**
   * Build a cursor from the page-boundary identity. Returns
   * `ValidationError` for negative timestamps, empty doc ids, or
   * malformed doc-id characters.
   */
  create(props: RideListCursorProps): Result<RideListCursor, ValidationError> {
    const { createdAtMillis, docId } = props;
    if (
      typeof createdAtMillis !== 'number' ||
      !Number.isFinite(createdAtMillis)
    ) {
      return Result.err(
        new ValidationError({
          code: 'ride_list_cursor_invalid_timestamp',
          message: 'RideListCursor.createdAtMillis must be a finite number',
          field: 'createdAtMillis',
        }),
      );
    }
    if (createdAtMillis < 0) {
      return Result.err(
        new ValidationError({
          code: 'ride_list_cursor_negative_timestamp',
          message: 'RideListCursor.createdAtMillis must be >= 0',
          field: 'createdAtMillis',
        }),
      );
    }
    if (typeof docId !== 'string' || docId.length === 0) {
      return Result.err(
        new ValidationError({
          code: 'ride_list_cursor_missing_doc_id',
          message: 'RideListCursor.docId must be a non-empty string',
          field: 'docId',
        }),
      );
    }
    if (docId.length > MAX_DOC_ID_LEN) {
      return Result.err(
        new ValidationError({
          code: 'ride_list_cursor_doc_id_too_long',
          message: `RideListCursor.docId must be <= ${String(MAX_DOC_ID_LEN)} characters`,
          field: 'docId',
        }),
      );
    }
    if (!/^[A-Za-z0-9_-]+$/.test(docId)) {
      return Result.err(
        new ValidationError({
          code: 'ride_list_cursor_invalid_doc_id',
          message:
            'RideListCursor.docId must contain only Firestore-doc-safe characters',
          field: 'docId',
        }),
      );
    }
    const encoded = `${String(Math.floor(createdAtMillis))}:${docId}`;
    return Result.ok(brand<string, 'RideListCursor'>(encoded));
  },

  /**
   * Decode a cursor back into its boundary fields. Only the data
   * adapter should call this — presentation/app code treats the
   * cursor as opaque.
   */
  decode(cursor: RideListCursor): Result<RideListCursorProps, ValidationError> {
    const match = ENCODED_REGEX.exec(cursor as unknown as string);
    if (!match || match[1] === undefined || match[2] === undefined) {
      return Result.err(
        new ValidationError({
          code: 'ride_list_cursor_decode_failed',
          message: 'RideListCursor is malformed',
          field: 'cursor',
        }),
      );
    }
    const createdAtMillis = Number(match[1]);
    if (!Number.isFinite(createdAtMillis)) {
      return Result.err(
        new ValidationError({
          code: 'ride_list_cursor_decode_failed',
          message: 'RideListCursor timestamp segment is not numeric',
          field: 'cursor',
        }),
      );
    }
    return Result.ok({ createdAtMillis, docId: match[2] });
  },
};

/**
 * A paginated page of rides + the cursor for the next page. `nextCursor`
 * is `null` when the end of the result set has been reached (the
 * returned page is shorter than the requested `limit`, OR the last row
 * exactly hit the end).
 *
 * Callers should treat the cursor as opaque — only the data adapter
 * knows how to use it (via `RideListCursor.decode`).
 */
export interface RidePage {
  readonly rides: readonly Ride[];
  readonly nextCursor: RideListCursor | null;
}
