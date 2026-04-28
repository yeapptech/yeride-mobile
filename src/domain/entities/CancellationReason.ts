import { ValidationError } from '../errors/ValidationError';
import { Result } from '../shared/Result';

/**
 * Why a trip was cancelled. Mirrors the legacy yeride enum exactly so the
 * rewrite can read legacy `trip.cancelReason` documents and write new ones
 * the legacy app can read.
 *
 * Codes are split by who's allowed to use them:
 *   Common (either party):
 *     - 'changed_mind'
 *     - 'vehicle_malfunction'
 *     - 'vehicle_accident'
 *     - 'safety_concerns'
 *     - 'other'
 *   Rider-only:
 *     - 'driver_no_show'
 *   Driver-only:
 *     - 'passenger_no_show'
 *
 * The role-specific allowed-set check lives on the use-case boundary
 * (`CancelRideByRider` / `CancelRideByDriver` in turn 3b) — the value object
 * accepts the union and trusts the caller. That keeps this type usable on
 * the read path (parsing legacy data where we don't know who cancelled).
 *
 * `reasonText` is freeform extra context. Required when code === 'other',
 * optional otherwise.
 */
export type CancellationReasonCode =
  | 'changed_mind'
  | 'vehicle_malfunction'
  | 'vehicle_accident'
  | 'safety_concerns'
  | 'driver_no_show'
  | 'passenger_no_show'
  | 'other';

const ALL_CODES: readonly CancellationReasonCode[] = [
  'changed_mind',
  'vehicle_malfunction',
  'vehicle_accident',
  'safety_concerns',
  'driver_no_show',
  'passenger_no_show',
  'other',
];

const RIDER_ALLOWED_CODES: ReadonlySet<CancellationReasonCode> = new Set([
  'changed_mind',
  'vehicle_malfunction',
  'vehicle_accident',
  'safety_concerns',
  'driver_no_show',
  'other',
]);

const DRIVER_ALLOWED_CODES: ReadonlySet<CancellationReasonCode> = new Set([
  'changed_mind',
  'vehicle_malfunction',
  'vehicle_accident',
  'safety_concerns',
  'passenger_no_show',
  'other',
]);

const REASON_TEXT_MAX_LEN = 500;

export interface CancellationReasonProps {
  readonly code: CancellationReasonCode;
  readonly reasonText: string | null;
}

export class CancellationReason {
  private constructor(private readonly props: CancellationReasonProps) {}

  static create(
    props: CancellationReasonProps,
  ): Result<CancellationReason, ValidationError> {
    if (!ALL_CODES.includes(props.code)) {
      return Result.err(
        new ValidationError({
          code: 'cancellation_reason_unknown_code',
          message: `Unknown cancellation reason code "${String(props.code)}"`,
          field: 'code',
        }),
      );
    }
    if (props.reasonText !== null) {
      if (typeof props.reasonText !== 'string') {
        return Result.err(
          new ValidationError({
            code: 'cancellation_reason_text_not_a_string',
            message: 'reasonText must be a string or null',
            field: 'reasonText',
          }),
        );
      }
      if (props.reasonText.length > REASON_TEXT_MAX_LEN) {
        return Result.err(
          new ValidationError({
            code: 'cancellation_reason_text_too_long',
            message: `reasonText must be ${String(REASON_TEXT_MAX_LEN)} characters or fewer`,
            field: 'reasonText',
          }),
        );
      }
    }
    if (props.code === 'other') {
      const trimmed = props.reasonText?.trim() ?? '';
      if (trimmed.length === 0) {
        return Result.err(
          new ValidationError({
            code: 'cancellation_reason_text_required',
            message:
              'reasonText is required when the cancellation code is "other"',
            field: 'reasonText',
          }),
        );
      }
    }
    return Result.ok(new CancellationReason(props));
  }

  get code(): CancellationReasonCode {
    return this.props.code;
  }
  get reasonText(): string | null {
    return this.props.reasonText;
  }

  /** Whether the given code is in the rider-allowed set. */
  static isRiderCode(code: CancellationReasonCode): boolean {
    return RIDER_ALLOWED_CODES.has(code);
  }

  /** Whether the given code is in the driver-allowed set. */
  static isDriverCode(code: CancellationReasonCode): boolean {
    return DRIVER_ALLOWED_CODES.has(code);
  }
}
