import { ServiceAreaId } from '../ServiceAreaId';

describe('ServiceAreaId', () => {
  it('accepts the legacy slug shape', () => {
    const r = ServiceAreaId.create('us-fl-south-florida');
    expect(r.ok).toBe(true);
    if (r.ok) expect(String(r.value)).toBe('us-fl-south-florida');
  });

  it('accepts a short slug at the lower bound', () => {
    expect(ServiceAreaId.create('abc').ok).toBe(true);
  });

  it('rejects too-short input', () => {
    const r = ServiceAreaId.create('ab');
    if (!r.ok) expect(r.error.code).toBe('service_area_id_invalid_length');
    expect(r.ok).toBe(false);
  });

  it('rejects uppercase letters', () => {
    const r = ServiceAreaId.create('US-FL');
    if (!r.ok) expect(r.error.code).toBe('service_area_id_invalid_format');
    expect(r.ok).toBe(false);
  });

  it('rejects leading or trailing hyphen', () => {
    expect(ServiceAreaId.create('-leading').ok).toBe(false);
    expect(ServiceAreaId.create('trailing-').ok).toBe(false);
  });

  it('rejects whitespace and underscores', () => {
    expect(ServiceAreaId.create('us fl').ok).toBe(false);
    expect(ServiceAreaId.create('us_fl').ok).toBe(false);
  });
});
