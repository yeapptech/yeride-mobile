import { ValidationError } from '../errors/ValidationError';
import { brand, type Brand } from '../shared/Brand';
import { Result } from '../shared/Result';

/**
 * Vehicle Identification Number — the 17-character alphanumeric identifier
 * stamped on every road-going vehicle since 1981. Used as the document id
 * for `vehicles/{vin}` in Firestore (legacy convention preserved).
 *
 * Branded so a `Vin` cannot be passed where a generic string is expected.
 *
 * Validity rules (NHTSA):
 *   1. Exactly 17 characters.
 *   2. Allowed character set: A–Z and 0–9, EXCLUDING `I`, `O`, `Q` — those
 *      are visually similar to 1, 0, 0 and are reserved.
 *   3. The 9th character is a check digit derived from the other 16 via a
 *      transliteration + weighted-sum algorithm. The check digit is either
 *      a digit `0`–`9` or the letter `X` (value 10). `Vin.create` enforces
 *      the algorithm so a typo'd VIN cannot construct.
 *
 * The factory uppercases input before validating, so callers don't have to
 * worry about case. This matches the legacy convention of writing VINs to
 * Firestore as uppercased.
 *
 * The check-digit algorithm is ported verbatim from the legacy
 * `src/api/nhtsa/VinDecoder.js` `validateCheckDigit` to guarantee parity:
 * a VIN that the legacy app writes to Firestore must hydrate as a `Vin`
 * here, and vice versa.
 */
export type Vin = Brand<string, 'Vin'>;

const VIN_LENGTH = 17;
const VIN_REGEX = /^[A-HJ-NPR-Z0-9]{17}$/;
const CHECK_DIGIT_INDEX = 8; // 0-indexed; the 9th character

const POSITION_WEIGHTS: readonly number[] = [
  8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2,
] as const;

const TRANSLITERATIONS: Readonly<Record<string, number>> = {
  A: 1,
  B: 2,
  C: 3,
  D: 4,
  E: 5,
  F: 6,
  G: 7,
  H: 8,
  J: 1,
  K: 2,
  L: 3,
  M: 4,
  N: 5,
  P: 7,
  R: 9,
  S: 2,
  T: 3,
  U: 4,
  V: 5,
  W: 6,
  X: 7,
  Y: 8,
  Z: 9,
  '0': 0,
  '1': 1,
  '2': 2,
  '3': 3,
  '4': 4,
  '5': 5,
  '6': 6,
  '7': 7,
  '8': 8,
  '9': 9,
};

export const Vin = {
  create(value: string): Result<Vin, ValidationError> {
    if (typeof value !== 'string') {
      return Result.err(
        new ValidationError({
          code: 'vin_not_a_string',
          message: 'VIN must be a string',
          field: 'vin',
        }),
      );
    }
    const upper = value.toUpperCase();
    if (upper.length !== VIN_LENGTH) {
      return Result.err(
        new ValidationError({
          code: 'vin_invalid_length',
          message: `VIN must be exactly ${String(VIN_LENGTH)} characters`,
          field: 'vin',
        }),
      );
    }
    if (!VIN_REGEX.test(upper)) {
      return Result.err(
        new ValidationError({
          code: 'vin_invalid_format',
          message: 'VIN must contain only A–Z and 0–9 (excluding I, O, Q)',
          field: 'vin',
        }),
      );
    }
    if (!isCheckDigitValid(upper)) {
      return Result.err(
        new ValidationError({
          code: 'vin_invalid_check_digit',
          message:
            'VIN check digit (9th character) does not match — VIN may be mistyped',
          field: 'vin',
        }),
      );
    }
    return Result.ok(brand<string, 'Vin'>(upper));
  },
};

/**
 * NHTSA check-digit algorithm. Returns true if the 9th character of `vin`
 * matches the digit derived from positions 0..16 using the
 * transliteration table and position weights above.
 *
 * Pre-condition: `vin` is uppercase and matches `VIN_REGEX` (callers in
 * `Vin.create` ensure this). If a character somehow isn't in
 * `TRANSLITERATIONS` we conservatively return false.
 */
function isCheckDigitValid(vin: string): boolean {
  let sum = 0;
  for (let i = 0; i < VIN_LENGTH; i += 1) {
    const ch = vin[i];
    if (ch === undefined) return false;
    const value = TRANSLITERATIONS[ch];
    if (value === undefined) return false;
    const weight = POSITION_WEIGHTS[i];
    if (weight === undefined) return false;
    sum += value * weight;
  }
  const remainder = sum % 11;
  const expected = remainder === 10 ? 'X' : String(remainder);
  return vin[CHECK_DIGIT_INDEX] === expected;
}
