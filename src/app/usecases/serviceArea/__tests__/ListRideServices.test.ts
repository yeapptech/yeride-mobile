import { ServiceAreaId } from '@domain/entities/ServiceAreaId';
import { InMemoryServiceAreaRepository } from '@shared/testing';

import { ListRideServices } from '../ListRideServices';

function areaId(value: string) {
  const r = ServiceAreaId.create(value);
  if (!r.ok) throw r.error;
  return r.value;
}

describe('ListRideServices', () => {
  it('returns the seeded ride services for SoFL', async () => {
    const repo = new InMemoryServiceAreaRepository();
    const sut = new ListRideServices(repo);
    const r = await sut.execute(areaId('us-fl-south-florida'));
    expect(r.ok).toBe(true);
    if (r.ok) {
      const names = r.value.map((s) => s.name);
      expect(names).toContain('Economy');
      expect(names).toContain('XL');
    }
  });

  it('returns an empty list for an unknown area', async () => {
    const repo = new InMemoryServiceAreaRepository();
    const sut = new ListRideServices(repo);
    const r = await sut.execute(areaId('us-xx-nowhere'));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual([]);
  });

  it('hits the repository each call (no implicit caching)', async () => {
    const repo = new InMemoryServiceAreaRepository();
    const sut = new ListRideServices(repo);
    await sut.execute(areaId('us-fl-south-florida'));
    await sut.execute(areaId('us-fl-south-florida'));
    expect(repo.spies.listRideServices).toBe(2);
  });
});
