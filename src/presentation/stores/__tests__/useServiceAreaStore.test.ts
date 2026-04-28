import { Coordinates } from '@domain/entities/Coordinates';
import { Money } from '@domain/entities/Money';
import { RideService } from '@domain/entities/RideService';
import { RideServiceId } from '@domain/entities/RideServiceId';
import { ServiceArea } from '@domain/entities/ServiceArea';
import { ServiceAreaId } from '@domain/entities/ServiceAreaId';

import { useServiceAreaStore } from '../useServiceAreaStore';

function unwrap<T>(r: { ok: true; value: T } | { ok: false; error: Error }): T {
  if (!r.ok) throw r.error;
  return r.value;
}

function fixtureArea(id: string, lat = 25, lng = -80) {
  return unwrap(
    ServiceArea.create({
      id: unwrap(ServiceAreaId.create(id)),
      identifier: id,
      center: unwrap(Coordinates.create(lat, lng)),
      radiusMeters: 500_000,
      notifyOnEntry: true,
      notifyOnDwell: false,
      notifyOnExit: true,
    }),
  );
}

function fixtureService(id: string, areaId: ServiceAreaId) {
  return unwrap(
    RideService.create({
      id: unwrap(RideServiceId.create(id)),
      areaId,
      name: id,
      description: '',
      baseFare: unwrap(Money.fromMajor(2.5, 'USD')),
      minimumFare: unwrap(Money.fromMajor(5, 'USD')),
      cancelationFee: unwrap(Money.fromMajor(2, 'USD')),
      seatCapacity: 4,
      costPerKm: unwrap(Money.fromMajor(1.25, 'USD')),
      costPerMinute: unwrap(Money.fromMajor(0.2, 'USD')),
    }),
  );
}

describe('useServiceAreaStore', () => {
  beforeEach(() => {
    useServiceAreaStore.getState().reset();
  });

  it('starts idle with no areas, no active area, no services', () => {
    const s = useServiceAreaStore.getState();
    expect(s.status).toBe('idle');
    expect(s.areas).toEqual([]);
    expect(s.activeAreaId).toBeNull();
    expect(s.services).toEqual([]);
    expect(s.error).toBeNull();
  });

  it('setLoading clears error and flips status', () => {
    useServiceAreaStore.getState().setError(new Error('boom'));
    useServiceAreaStore.getState().setLoading();
    const s = useServiceAreaStore.getState();
    expect(s.status).toBe('loading');
    expect(s.error).toBeNull();
  });

  it('setReady stores areas and resets active selection', () => {
    const sofl = fixtureArea('us-fl-south-florida');
    const bay = fixtureArea('us-ca-bay-area', 37, -122);
    useServiceAreaStore.getState().setActiveArea(sofl.id);
    useServiceAreaStore
      .getState()
      .setServices([fixtureService('economy', sofl.id)]);
    useServiceAreaStore.getState().setReady([sofl, bay]);
    const s = useServiceAreaStore.getState();
    expect(s.status).toBe('ready');
    expect(s.areas).toEqual([sofl, bay]);
    expect(s.activeAreaId).toBeNull();
    expect(s.services).toEqual([]);
  });

  it('setError keeps prior areas (resilient UX)', () => {
    const sofl = fixtureArea('us-fl-south-florida');
    useServiceAreaStore.getState().setReady([sofl]);
    useServiceAreaStore.getState().setError(new Error('refresh failed'));
    const s = useServiceAreaStore.getState();
    expect(s.status).toBe('error');
    expect(s.error?.message).toBe('refresh failed');
    expect(s.areas).toEqual([sofl]); // preserved
  });

  it('setActiveArea sets the id and clears stale services', () => {
    const sofl = fixtureArea('us-fl-south-florida');
    useServiceAreaStore.getState().setReady([sofl]);
    useServiceAreaStore.getState().setActiveArea(sofl.id);
    useServiceAreaStore
      .getState()
      .setServices([fixtureService('economy', sofl.id)]);
    expect(useServiceAreaStore.getState().services).toHaveLength(1);
    // Switching active area should clear services.
    useServiceAreaStore.getState().setActiveArea(null);
    const s = useServiceAreaStore.getState();
    expect(s.activeAreaId).toBeNull();
    expect(s.services).toEqual([]);
  });

  it('reset returns to the idle initial state', () => {
    const sofl = fixtureArea('us-fl-south-florida');
    useServiceAreaStore.getState().setReady([sofl]);
    useServiceAreaStore.getState().setActiveArea(sofl.id);
    useServiceAreaStore.getState().reset();
    const s = useServiceAreaStore.getState();
    expect(s.status).toBe('idle');
    expect(s.areas).toEqual([]);
    expect(s.activeAreaId).toBeNull();
  });
});
