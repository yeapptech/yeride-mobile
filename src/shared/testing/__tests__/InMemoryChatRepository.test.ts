import { ChatMessage, ChatMessageId } from '@domain/entities/ChatMessage';
import { PersonName } from '@domain/entities/PersonName';
import { RideId } from '@domain/entities/RideId';
import { UserId } from '@domain/entities/UserId';
import { NetworkError } from '@domain/errors';

import { InMemoryChatRepository } from '../InMemoryChatRepository';

function rideId(suffix = '1'): RideId {
  const r = RideId.create(`ride_test_${suffix}`);
  if (!r.ok) throw new Error('test setup: RideId.create failed');
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

function preloadedMessage(text: string, msAgo: number): ChatMessage {
  const idR = ChatMessageId.create(`seeded_${text.replace(/\s/g, '_')}`);
  if (!idR.ok) throw new Error('test setup');
  const r = ChatMessage.create({
    id: idR.value,
    senderId: userId(),
    text,
    createdAt: new Date(Date.now() - msAgo),
    readAt: null,
  });
  if (!r.ok) throw new Error('test setup');
  return r.value;
}

describe('InMemoryChatRepository.observeMessages', () => {
  it('emits an empty list synchronously on subscribe', () => {
    const repo = new InMemoryChatRepository();
    const cb = jest.fn();
    repo.observeMessages({ rideId: rideId(), callback: cb });
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0]?.[0]).toEqual([]);
  });

  it('re-emits with the new message after send', async () => {
    const repo = new InMemoryChatRepository();
    const cb = jest.fn();
    repo.observeMessages({ rideId: rideId(), callback: cb });
    expect(cb).toHaveBeenCalledTimes(1);

    const r = await repo.send({
      rideId: rideId(),
      sender: { id: userId(), name: name() },
      text: 'hi',
    });
    expect(r.ok).toBe(true);
    expect(cb).toHaveBeenCalledTimes(2);
    const second = cb.mock.calls[1]?.[0] as Array<{ text: string }>;
    expect(second).toHaveLength(1);
    expect(second[0]?.text).toBe('hi');
  });

  it('isolates state across rides', async () => {
    const repo = new InMemoryChatRepository();
    const cbA = jest.fn();
    const cbB = jest.fn();
    repo.observeMessages({ rideId: rideId('A'), callback: cbA });
    repo.observeMessages({ rideId: rideId('B'), callback: cbB });

    await repo.send({
      rideId: rideId('A'),
      sender: { id: userId(), name: name() },
      text: 'A1',
    });

    expect((cbA.mock.calls[1]?.[0] as Array<{ text: string }>)[0]?.text).toBe(
      'A1',
    );
    // cbB unchanged after the initial empty emit
    expect(cbB).toHaveBeenCalledTimes(1);
    expect(cbB.mock.calls[0]?.[0]).toEqual([]);
  });

  it('stops delivering after unsubscribe', async () => {
    const repo = new InMemoryChatRepository();
    const cb = jest.fn();
    const dispose = repo.observeMessages({ rideId: rideId(), callback: cb });
    dispose();
    await repo.send({
      rideId: rideId(),
      sender: { id: userId(), name: name() },
      text: 'after',
    });
    expect(cb).toHaveBeenCalledTimes(1); // only the initial empty emit
  });

  it('emits seeded messages in descending createdAt order', () => {
    const repo = new InMemoryChatRepository();
    const m1 = preloadedMessage('old', 10_000);
    const m2 = preloadedMessage('new', 1_000);
    repo.seed(rideId(), [m1, m2]);
    const cb = jest.fn();
    repo.observeMessages({ rideId: rideId(), callback: cb });
    const emitted = cb.mock.calls[0]?.[0] as Array<{ text: string }>;
    expect(emitted[0]?.text).toBe('new');
    expect(emitted[1]?.text).toBe('old');
  });
});

describe('InMemoryChatRepository.observeLatestMessage', () => {
  it('emits null on subscribe when no messages exist', () => {
    const repo = new InMemoryChatRepository();
    const cb = jest.fn();
    repo.observeLatestMessage({ rideId: rideId(), callback: cb });
    expect(cb).toHaveBeenCalledWith(null);
  });

  it('emits the most-recent message after send', async () => {
    const repo = new InMemoryChatRepository();
    const cb = jest.fn();
    repo.observeLatestMessage({ rideId: rideId(), callback: cb });
    await repo.send({
      rideId: rideId(),
      sender: { id: userId(), name: name() },
      text: 'one',
    });
    await repo.send({
      rideId: rideId(),
      sender: { id: userId(), name: name() },
      text: 'two',
    });
    const last = cb.mock.calls[cb.mock.calls.length - 1]?.[0] as {
      text: string;
    } | null;
    expect(last?.text).toBe('two');
  });
});

describe('InMemoryChatRepository.markMessagesRead', () => {
  it('tracks calls per (rideId, role)', async () => {
    const repo = new InMemoryChatRepository();
    await repo.markMessagesRead({ rideId: rideId(), role: 'rider' });
    await repo.markMessagesRead({ rideId: rideId(), role: 'rider' });
    await repo.markMessagesRead({ rideId: rideId(), role: 'driver' });

    expect(repo.getMarkReadCallsFor(rideId(), 'rider')).toBe(2);
    expect(repo.getMarkReadCallsFor(rideId(), 'driver')).toBe(1);
  });

  it('rejects invalid role with chat_invalid_role', async () => {
    const repo = new InMemoryChatRepository();
    const r = await repo.markMessagesRead({
      rideId: rideId(),
      role: 'admin' as unknown as 'rider',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('chat_invalid_role');
  });

  it('honors mockNextMarkReadResult', async () => {
    const repo = new InMemoryChatRepository();
    repo.mockNextMarkReadResult({
      error: new NetworkError({
        code: 'chat_mark_read_failed',
        message: 'offline',
      }),
    });
    const r = await repo.markMessagesRead({ rideId: rideId(), role: 'rider' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('chat_mark_read_failed');
    // Counter should still be untouched on the failure path.
    expect(repo.getMarkReadCallsFor(rideId(), 'rider')).toBe(0);
  });
});

describe('InMemoryChatRepository.send', () => {
  it('returns the constructed ChatMessage', async () => {
    const repo = new InMemoryChatRepository();
    const r = await repo.send({
      rideId: rideId(),
      sender: { id: userId(), name: name() },
      text: 'hi',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.text).toBe('hi');
      expect(String(r.value.senderId)).toBe('a'.repeat(28));
    }
  });

  it('rejects empty text via the entity factory', async () => {
    const repo = new InMemoryChatRepository();
    const r = await repo.send({
      rideId: rideId(),
      sender: { id: userId(), name: name() },
      text: '   ',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('chat_message_empty_text');
  });

  it('honors mockNextSendResult', async () => {
    const repo = new InMemoryChatRepository();
    repo.mockNextSendResult({
      error: new NetworkError({
        code: 'chat_send_failed',
        message: 'offline',
      }),
    });
    const r = await repo.send({
      rideId: rideId(),
      sender: { id: userId(), name: name() },
      text: 'hi',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('chat_send_failed');
    // The next call should succeed (the mock is consumed after one call).
    const ok = await repo.send({
      rideId: rideId(),
      sender: { id: userId(), name: name() },
      text: 'hi2',
    });
    expect(ok.ok).toBe(true);
  });
});

describe('InMemoryChatRepository.reset', () => {
  it('clears stored state but keeps observers', async () => {
    const repo = new InMemoryChatRepository();
    const cb = jest.fn();
    repo.observeMessages({ rideId: rideId(), callback: cb });
    await repo.send({
      rideId: rideId(),
      sender: { id: userId(), name: name() },
      text: 'first',
    });
    repo.reset();
    // After reset, sending again should produce a list of length 1, not 2.
    await repo.send({
      rideId: rideId(),
      sender: { id: userId(), name: name() },
      text: 'second',
    });
    const last = cb.mock.calls[cb.mock.calls.length - 1]?.[0] as Array<{
      text: string;
    }>;
    expect(last).toHaveLength(1);
    expect(last[0]?.text).toBe('second');
  });
});
