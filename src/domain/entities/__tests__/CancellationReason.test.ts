import { CancellationReason } from '../CancellationReason';

describe('CancellationReason.create', () => {
  it('accepts a known code with no reasonText', () => {
    const r = CancellationReason.create({
      code: 'changed_mind',
      reasonText: null,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.code).toBe('changed_mind');
      expect(r.value.reasonText).toBeNull();
    }
  });

  it('accepts a known code with optional reasonText', () => {
    const r = CancellationReason.create({
      code: 'safety_concerns',
      reasonText: 'Driver was clearly intoxicated',
    });
    expect(r.ok).toBe(true);
  });

  it('requires reasonText when code is "other"', () => {
    const r = CancellationReason.create({ code: 'other', reasonText: null });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('cancellation_reason_text_required');
  });

  it('rejects whitespace-only reasonText for "other"', () => {
    const r = CancellationReason.create({
      code: 'other',
      reasonText: '   ',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('cancellation_reason_text_required');
  });

  it('rejects reasonText longer than 500 chars', () => {
    const r = CancellationReason.create({
      code: 'changed_mind',
      reasonText: 'x'.repeat(501),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('cancellation_reason_text_too_long');
  });

  it('rejects an unknown code', () => {
    const r = CancellationReason.create({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      code: 'banana' as any,
      reasonText: null,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('cancellation_reason_unknown_code');
  });
});

describe('CancellationReason role gates', () => {
  it('allows driver_no_show for riders only', () => {
    expect(CancellationReason.isRiderCode('driver_no_show')).toBe(true);
    expect(CancellationReason.isDriverCode('driver_no_show')).toBe(false);
  });

  it('allows passenger_no_show for drivers only', () => {
    expect(CancellationReason.isDriverCode('passenger_no_show')).toBe(true);
    expect(CancellationReason.isRiderCode('passenger_no_show')).toBe(false);
  });

  it('allows common codes for both roles', () => {
    for (const code of [
      'changed_mind',
      'vehicle_malfunction',
      'vehicle_accident',
      'safety_concerns',
      'other',
    ] as const) {
      expect(CancellationReason.isRiderCode(code)).toBe(true);
      expect(CancellationReason.isDriverCode(code)).toBe(true);
    }
  });
});
