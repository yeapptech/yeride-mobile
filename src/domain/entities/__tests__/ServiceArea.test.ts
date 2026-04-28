import { Coordinates } from '../Coordinates';
import { ServiceArea } from '../ServiceArea';
import { ServiceAreaId } from '../ServiceAreaId';

function id(value: string) {
  const r = ServiceAreaId.create(value);
  if (!r.ok) throw r.error;
  return r.value;
}

function coords(lat: number, lng: number): Coordinates {
  const r = Coordinates.create(lat, lng);
  if (!r.ok) throw r.error;
  return r.value;
}

const SOFL_ID = id('us-fl-south-florida');
const MIAMI = coords(25.7617, -80.1918);

describe('ServiceArea', () => {
  it('constructs from valid props', () => {
    const r = ServiceArea.create({
      id: SOFL_ID,
      identifier: 'us-fl-south-florida',
      center: MIAMI,
      radiusMeters: 500_000,
      notifyOnEntry: true,
      notifyOnDwell: false,
      notifyOnExit: true,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.identifier).toBe('us-fl-south-florida');
      expect(r.value.radiusMeters).toBe(500_000);
      expect(r.value.notifyOnExit).toBe(true);
    }
  });

  it('rejects a radius below the floor', () => {
    const r = ServiceArea.create({
      id: SOFL_ID,
      identifier: 'us-fl-south-florida',
      center: MIAMI,
      radiusMeters: 50,
      notifyOnEntry: true,
      notifyOnDwell: false,
      notifyOnExit: true,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('service_area_invalid_radius');
  });

  it('rejects a radius above the ceiling', () => {
    const r = ServiceArea.create({
      id: SOFL_ID,
      identifier: 'us-fl-south-florida',
      center: MIAMI,
      radiusMeters: 99_999_999,
      notifyOnEntry: true,
      notifyOnDwell: false,
      notifyOnExit: true,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('service_area_invalid_radius');
  });

  it('rejects an empty identifier', () => {
    const r = ServiceArea.create({
      id: SOFL_ID,
      identifier: '   ',
      center: MIAMI,
      radiusMeters: 500_000,
      notifyOnEntry: true,
      notifyOnDwell: false,
      notifyOnExit: true,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('service_area_empty_identifier');
  });

  describe('containsPoint', () => {
    const sofl = (() => {
      const r = ServiceArea.create({
        id: SOFL_ID,
        identifier: 'us-fl-south-florida',
        center: MIAMI,
        radiusMeters: 500_000, // 500 km
        notifyOnEntry: true,
        notifyOnDwell: false,
        notifyOnExit: true,
      });
      if (!r.ok) throw r.error;
      return r.value;
    })();

    it('includes the center', () => {
      expect(sofl.containsPoint(MIAMI)).toBe(true);
    });

    it('includes a point inside the radius', () => {
      // Fort Lauderdale ≈ 40 km north of Miami — well inside.
      expect(sofl.containsPoint(coords(26.1224, -80.1373))).toBe(true);
    });

    it('excludes a point outside the radius', () => {
      // San Francisco — across the continent, ~4_180 km away.
      expect(sofl.containsPoint(coords(37.7749, -122.4194))).toBe(false);
    });
  });
});
