import { Vin } from '../Vin';

/**
 * Two real-world VINs used as the happy-path fixtures. Both have valid
 * NHTSA check digits (9th character):
 *   - `1HGBH41JXMN109186` — Honda; check digit 'X' (value 10)
 *   - `5UXKR0C58JL074657` — BMW X5; check digit '8' (value 8)
 *
 * The 9th character of a valid VIN is always either a digit 0–9 or the
 * letter 'X' — never any other letter — because that's the only set of
 * outputs the NHTSA algorithm produces.
 */
const VALID_VIN_HONDA = '1HGBH41JXMN109186';
const VALID_VIN_BMW = '5UXKR0C58JL074657';

describe('Vin.create', () => {
  it('accepts a valid VIN with a digit check character', () => {
    const r = Vin.create(VALID_VIN_BMW);
    expect(r.ok).toBe(true);
    if (r.ok) expect(String(r.value)).toBe(VALID_VIN_BMW);
  });

  it('accepts a valid VIN with an X check character (value 10)', () => {
    const r = Vin.create(VALID_VIN_HONDA);
    expect(r.ok).toBe(true);
    if (r.ok) expect(String(r.value)).toBe(VALID_VIN_HONDA);
  });

  it('uppercases lowercase input before validating', () => {
    const r = Vin.create(VALID_VIN_HONDA.toLowerCase());
    expect(r.ok).toBe(true);
    if (r.ok) expect(String(r.value)).toBe(VALID_VIN_HONDA);
  });

  it('rejects non-string input', () => {
    const r = Vin.create(123 as unknown as string);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('vin_not_a_string');
  });

  it('rejects empty string (length)', () => {
    const r = Vin.create('');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('vin_invalid_length');
  });

  it('rejects a VIN that is too short', () => {
    const r = Vin.create('1HGBH41JXMN10918');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('vin_invalid_length');
  });

  it('rejects a VIN that is too long', () => {
    const r = Vin.create('1HGBH41JXMN1091866');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('vin_invalid_length');
  });

  it('rejects a VIN containing the letter I (reserved)', () => {
    // Replace position 0 with I; pad to 17 chars; same length as a real VIN.
    const r = Vin.create('IHGBH41JXMN109186');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('vin_invalid_format');
  });

  it('rejects a VIN containing the letter O (reserved)', () => {
    const r = Vin.create('OHGBH41JXMN109186');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('vin_invalid_format');
  });

  it('rejects a VIN containing the letter Q (reserved)', () => {
    const r = Vin.create('QHGBH41JXMN109186');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('vin_invalid_format');
  });

  it('rejects a VIN with a non-alphanumeric character', () => {
    const r = Vin.create('1HGBH41J!MN109186');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('vin_invalid_format');
  });

  it('rejects a VIN whose check digit does not match', () => {
    // Replace the X check digit with '0'; format is still legal but
    // the algorithm will not derive '0' from these characters.
    const r = Vin.create('1HGBH41J0MN109186');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('vin_invalid_check_digit');
  });

  it('rejects a VIN with a single mistyped character', () => {
    // Flip one digit anywhere outside position 9 — almost always
    // breaks the check digit.
    const r = Vin.create('1HGBH51JXMN109186');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('vin_invalid_check_digit');
  });

  it('returns a branded value the type system distinguishes from string', () => {
    const r = Vin.create(VALID_VIN_HONDA);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Branded values still serialize as strings.
    expect(typeof r.value).toBe('string');
    expect(String(r.value)).toBe(VALID_VIN_HONDA);
  });
});
