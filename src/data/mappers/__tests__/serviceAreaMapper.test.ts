import { parseServiceAreaDoc, toDomain } from '../serviceAreaMapper';

describe('parseServiceAreaDoc', () => {
  it('accepts a fully-populated legacy doc', () => {
    const r = parseServiceAreaDoc({
      identifier: 'us-fl-south-florida',
      latitude: 25.7617,
      longitude: -80.1918,
      radius: 500_000,
      notifyOnEntry: true,
      notifyOnDwell: false,
      notifyOnExit: true,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.identifier).toBe('us-fl-south-florida');
      expect(r.value.radius).toBe(500_000);
    }
  });

  it('applies sensible defaults for missing notify flags', () => {
    const r = parseServiceAreaDoc({
      identifier: 'us-fl-south-florida',
      latitude: 25.7617,
      longitude: -80.1918,
      radius: 500_000,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.notifyOnEntry).toBe(true);
      expect(r.value.notifyOnDwell).toBe(false);
      expect(r.value.notifyOnExit).toBe(true);
    }
  });

  it('rejects a doc with out-of-range latitude', () => {
    const r = parseServiceAreaDoc({
      identifier: 'us-fl-south-florida',
      latitude: 95,
      longitude: 0,
      radius: 500_000,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('service_area_doc_invalid_shape');
  });

  it('rejects a doc with non-positive radius', () => {
    const r = parseServiceAreaDoc({
      identifier: 'us-fl-south-florida',
      latitude: 25,
      longitude: -80,
      radius: 0,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('service_area_doc_invalid_shape');
  });

  it('rejects a doc missing the identifier field', () => {
    const r = parseServiceAreaDoc({
      latitude: 25,
      longitude: -80,
      radius: 500_000,
    });
    expect(r.ok).toBe(false);
  });
});

describe('toDomain', () => {
  it('builds a ServiceArea from a parsed doc', () => {
    const docR = parseServiceAreaDoc({
      identifier: 'us-fl-south-florida',
      latitude: 25.7617,
      longitude: -80.1918,
      radius: 500_000,
      notifyOnEntry: true,
      notifyOnDwell: false,
      notifyOnExit: true,
    });
    if (!docR.ok) throw docR.error;
    const r = toDomain('us-fl-south-florida', docR.value);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(String(r.value.id)).toBe('us-fl-south-florida');
      expect(r.value.identifier).toBe('us-fl-south-florida');
      expect(r.value.center.latitude).toBe(25.7617);
      expect(r.value.radiusMeters).toBe(500_000);
      expect(r.value.notifyOnExit).toBe(true);
    }
  });

  it('rejects when the doc id is not a valid slug', () => {
    const docR = parseServiceAreaDoc({
      identifier: 'bad',
      latitude: 0,
      longitude: 0,
      radius: 1_000,
    });
    if (!docR.ok) throw docR.error;
    const r = toDomain('NOT VALID', docR.value);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('service_area_id_invalid_format');
  });

  it('refuses an entity-level radius below the floor', () => {
    const docR = parseServiceAreaDoc({
      identifier: 'us-fl-south-florida',
      latitude: 25,
      longitude: -80,
      radius: 50, // below ServiceArea floor (100)
    });
    if (!docR.ok) throw docR.error;
    const r = toDomain('us-fl-south-florida', docR.value);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('service_area_invalid_radius');
  });
});
