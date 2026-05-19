import { PersonName } from '@domain/entities/PersonName';
import { RideId } from '@domain/entities/RideId';
import { UserId } from '@domain/entities/UserId';
import { InMemoryChatRepository } from '@shared/testing';

import { ObserveChatMessages } from '../ObserveChatMessages';

function rideId(suffix = '1'): RideId {
  const r = RideId.create(`ride_test_${suffix}`);
  if (!r.ok) throw new Error('test setup');
  return r.value;
}

function userId(): UserId {
  const r = UserId.create('a'.repeat(28));
  if (!r.ok) throw new Error('test setup');
  return r.value;
}

function name(): PersonName {
  const r = PersonName.create({ first: 'Ada', last: 'Lovelace' });
  if (!r.ok) throw new Error('test setup');
  return r.value;
}

describe('ObserveChatMessages', () => {
  it('delegates to ChatRepository.observeMessages', () => {
    const repo = new InMemoryChatRepository();
    const uc = new ObserveChatMessages(repo);
    const cb = jest.fn();
    uc.execute({ rideId: rideId(), callback: cb });
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0]?.[0]).toEqual([]);
  });

  it('re-emits on send', async () => {
    const repo = new InMemoryChatRepository();
    const uc = new ObserveChatMessages(repo);
    const cb = jest.fn();
    uc.execute({ rideId: rideId(), callback: cb });
    await repo.send({
      rideId: rideId(),
      sender: { id: userId(), name: name() },
      text: 'hi',
    });
    expect(cb).toHaveBeenCalledTimes(2);
    expect((cb.mock.calls[1]?.[0] as Array<{ text: string }>)[0]?.text).toBe(
      'hi',
    );
  });

  it('isolates state across rides', async () => {
    const repo = new InMemoryChatRepository();
    const uc = new ObserveChatMessages(repo);
    const cbA = jest.fn();
    const cbB = jest.fn();
    uc.execute({ rideId: rideId('A'), callback: cbA });
    uc.execute({ rideId: rideId('B'), callback: cbB });
    await repo.send({
      rideId: rideId('A'),
      sender: { id: userId(), name: name() },
      text: 'A1',
    });
    expect((cbA.mock.calls[1]?.[0] as unknown[]).length).toBe(1);
    expect(cbB).toHaveBeenCalledTimes(1);
  });

  it('stops emitting after unsubscribe', async () => {
    const repo = new InMemoryChatRepository();
    const uc = new ObserveChatMessages(repo);
    const cb = jest.fn();
    const dispose = uc.execute({ rideId: rideId(), callback: cb });
    dispose();
    await repo.send({
      rideId: rideId(),
      sender: { id: userId(), name: name() },
      text: 'hi',
    });
    expect(cb).toHaveBeenCalledTimes(1);
  });
});
