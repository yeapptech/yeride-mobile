import { PersonName } from '@domain/entities/PersonName';
import { RideId } from '@domain/entities/RideId';
import { UserId } from '@domain/entities/UserId';
import { NetworkError } from '@domain/errors';
import { InMemoryChatRepository } from '@shared/testing';

import { SendChatMessage } from '../SendChatMessage';

function rideId(): RideId {
  const r = RideId.create('ride_send_test');
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

describe('SendChatMessage', () => {
  it('returns the constructed ChatMessage on success', async () => {
    const repo = new InMemoryChatRepository();
    const uc = new SendChatMessage(repo);
    const r = await uc.execute({
      rideId: rideId(),
      sender: { id: userId(), name: name() },
      text: '  On my way.  ',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.text).toBe('On my way.');
    }
  });

  it('rejects empty text with chat_message_empty_text BEFORE the repo is called', async () => {
    const repo = new InMemoryChatRepository();
    const uc = new SendChatMessage(repo);
    const r = await uc.execute({
      rideId: rideId(),
      sender: { id: userId(), name: name() },
      text: '',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('chat_message_empty_text');
    expect(repo.spies.send).toBe(0);
  });

  it('rejects whitespace-only text', async () => {
    const repo = new InMemoryChatRepository();
    const uc = new SendChatMessage(repo);
    const r = await uc.execute({
      rideId: rideId(),
      sender: { id: userId(), name: name() },
      text: '   \n  ',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('chat_message_empty_text');
    expect(repo.spies.send).toBe(0);
  });

  it('rejects overlong text with chat_message_text_too_long', async () => {
    const repo = new InMemoryChatRepository();
    const uc = new SendChatMessage(repo);
    const r = await uc.execute({
      rideId: rideId(),
      sender: { id: userId(), name: name() },
      text: 'x'.repeat(1001),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('chat_message_text_too_long');
    expect(repo.spies.send).toBe(0);
  });

  it('rejects non-string text with chat_message_text_not_a_string', async () => {
    const repo = new InMemoryChatRepository();
    const uc = new SendChatMessage(repo);
    const r = await uc.execute({
      rideId: rideId(),
      sender: { id: userId(), name: name() },
      text: 42 as unknown as string,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('chat_message_text_not_a_string');
  });

  it('propagates repository NetworkError as-is', async () => {
    const repo = new InMemoryChatRepository();
    repo.mockNextSendResult({
      error: new NetworkError({
        code: 'chat_send_failed',
        message: 'offline',
      }),
    });
    const uc = new SendChatMessage(repo);
    const r = await uc.execute({
      rideId: rideId(),
      sender: { id: userId(), name: name() },
      text: 'hi',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('chat_send_failed');
  });

  it('trims text before passing to the repo', async () => {
    const repo = new InMemoryChatRepository();
    const uc = new SendChatMessage(repo);
    await uc.execute({
      rideId: rideId(),
      sender: { id: userId(), name: name() },
      text: '   hello   ',
    });
    expect(repo.spies.lastSendArgs?.text).toBe('hello');
  });
});
