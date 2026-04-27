import { brand, type Brand } from '../Brand';

type TripId = Brand<string, 'TripId'>;
type UserId = Brand<string, 'UserId'>;

describe('Brand', () => {
  it('preserves the runtime value', () => {
    const id: TripId = brand<string, 'TripId'>('abc123');
    expect(id).toBe('abc123');
    expect(typeof id).toBe('string');
  });

  it('survives serialization round-trips', () => {
    const id: TripId = brand<string, 'TripId'>('abc123');
    const json = JSON.stringify({ id });
    const parsed = JSON.parse(json) as { id: string };
    expect(parsed.id).toBe('abc123');
  });

  // Type-level assertion: the following must NOT compile.
  // Uncommenting it would surface the failure at `tsc --noEmit`.
  //
  //   const t = brand<string, 'TripId'>('t');
  //   const u: UserId = t;       // ❌ Type 'TripId' is not assignable to 'UserId'
  //
  // We can't assert non-compilation in Jest; instead we trust the type
  // system and assert that the helper's runtime behavior is a no-op.
  it('two brands of the same primitive are interchangeable at runtime only', () => {
    const trip: TripId = brand<string, 'TripId'>('shared-string');
    const user: UserId = brand<string, 'UserId'>('shared-string');
    expect(trip).toBe(user);
  });
});
