import { InMemoryServiceAreaRepository } from '@shared/testing';

import { ListServiceAreas } from '../ListServiceAreas';

describe('ListServiceAreas', () => {
  it('returns the seeded fixtures', async () => {
    const repo = new InMemoryServiceAreaRepository();
    const sut = new ListServiceAreas(repo);
    const r = await sut.execute();
    expect(r.ok).toBe(true);
    if (r.ok) {
      const ids = r.value.map((a) => String(a.id));
      expect(ids).toEqual(['us-fl-south-florida', 'us-ca-bay-area']);
    }
  });

  it('returns an empty list when the repository has nothing', async () => {
    const repo = new InMemoryServiceAreaRepository();
    repo.reset({ areas: [], services: {} });
    const sut = new ListServiceAreas(repo);
    const r = await sut.execute();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual([]);
  });

  it('hits the repository exactly once per call', async () => {
    const repo = new InMemoryServiceAreaRepository();
    const sut = new ListServiceAreas(repo);
    await sut.execute();
    await sut.execute();
    expect(repo.spies.listAll).toBe(2);
  });
});
