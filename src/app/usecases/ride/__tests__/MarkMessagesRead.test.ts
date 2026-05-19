import { RideId } from '@domain/entities/RideId';
import { NetworkError } from '@domain/errors';
import { InMemoryChatRepository } from '@shared/testing';

import { MarkMessagesRead } from '../MarkMessagesRead';

function rideId(): RideId {
  const r = RideId.create('ride_markread_test');
  if (!r.ok) throw new Error('test setup');
  return r.value;
}

describe('MarkMessagesRead', () => {
  it('invokes the repo with rider role', async () => {
    const repo = new InMemoryChatRepository();
    const uc = new MarkMessagesRead(repo);
    const r = await uc.execute({ rideId: rideId(), role: 'rider' });
    expect(r.ok).toBe(true);
    expect(repo.getMarkReadCallsFor(rideId(), 'rider')).toBe(1);
    expect(repo.getMarkReadCallsFor(rideId(), 'driver')).toBe(0);
  });

  it('invokes the repo with driver role', async () => {
    const repo = new InMemoryChatRepository();
    const uc = new MarkMessagesRead(repo);
    const r = await uc.execute({ rideId: rideId(), role: 'driver' });
    expect(r.ok).toBe(true);
    expect(repo.getMarkReadCallsFor(rideId(), 'driver')).toBe(1);
  });

  it('rejects an invalid role with chat_invalid_role BEFORE the repo is called', async () => {
    const repo = new InMemoryChatRepository();
    const uc = new MarkMessagesRead(repo);
    const r = await uc.execute({
      rideId: rideId(),
      role: 'admin' as unknown as 'rider',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('chat_invalid_role');
    expect(repo.spies.markMessagesRead).toBe(0);
  });

  it('propagates repository NetworkError as-is', async () => {
    const repo = new InMemoryChatRepository();
    repo.mockNextMarkReadResult({
      error: new NetworkError({
        code: 'chat_mark_read_failed',
        message: 'offline',
      }),
    });
    const uc = new MarkMessagesRead(repo);
    const r = await uc.execute({ rideId: rideId(), role: 'rider' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('chat_mark_read_failed');
  });
});
