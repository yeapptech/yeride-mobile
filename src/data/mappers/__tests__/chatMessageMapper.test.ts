import { PersonName } from '@domain/entities/PersonName';

import { parseDoc, toDocOnSend, toDomain } from '../chatMessageMapper';

function name(first = 'Ada', last = 'Lovelace'): PersonName {
  const r = PersonName.create({ first, last });
  if (!r.ok) throw new Error('test setup: PersonName.create failed');
  return r.value;
}

describe('chatMessageMapper.parseDoc', () => {
  it('returns Result.ok for a well-formed doc', () => {
    const r = parseDoc({
      text: 'hi',
      senderId: 'a'.repeat(28),
      createdAt: new Date('2026-05-19T12:00:00.000Z'),
      user: { _id: 'a'.repeat(28), name: 'Ada' },
    });
    expect(r.ok).toBe(true);
  });

  it('returns ValidationError with chat_message_doc_invalid_shape on schema failure', () => {
    const r = parseDoc({ text: '', senderId: '', createdAt: null });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('chat_message_doc_invalid_shape');
  });
});

describe('chatMessageMapper.toDomain', () => {
  const FRESH_DOC_ID = 'msg_abc12_xy3'; // 12 chars; satisfies Firestore-doc-safe regex
  const SENDER_UID = 'a'.repeat(28);

  it('constructs a ChatMessage from a valid doc', () => {
    const createdAt = new Date('2026-05-19T12:00:00.000Z');
    const parsed = parseDoc({
      text: '  hi  ',
      senderId: SENDER_UID,
      createdAt,
      user: { _id: SENDER_UID, name: 'Ada' },
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const r = toDomain(FRESH_DOC_ID, parsed.value);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(String(r.value.id)).toBe(FRESH_DOC_ID);
      expect(String(r.value.senderId)).toBe(SENDER_UID);
      expect(r.value.text).toBe('hi'); // trimmed
      expect(r.value.createdAt).toEqual(createdAt);
      expect(r.value.readAt).toBe(null);
    }
  });

  it('substitutes the client clock when createdAt is null (server-timestamp local placeholder)', () => {
    const fakeNow = new Date('2026-05-19T13:00:00.000Z');
    const parsed = parseDoc({
      text: 'hi',
      senderId: SENDER_UID,
      createdAt: null,
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const r = toDomain(FRESH_DOC_ID, parsed.value, () => fakeNow);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.createdAt).toEqual(fakeNow);
  });

  it('returns ValidationError when senderId is malformed', () => {
    const parsed = parseDoc({
      text: 'hi',
      senderId: 'short',
      createdAt: new Date(),
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const r = toDomain(FRESH_DOC_ID, parsed.value);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toMatch(/^user_id_/);
  });

  it('returns ValidationError when text is whitespace-only', () => {
    const parsed = parseDoc({
      text: '   ',
      senderId: SENDER_UID,
      createdAt: new Date(),
    });
    // Schema accepts non-empty string; entity-level rejects whitespace.
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const r = toDomain(FRESH_DOC_ID, parsed.value);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('chat_message_empty_text');
  });

  it('returns ValidationError when docId is too short', () => {
    const parsed = parseDoc({
      text: 'hi',
      senderId: SENDER_UID,
      createdAt: new Date(),
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const r = toDomain('x', parsed.value);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('chat_message_id_invalid_length');
  });
});

describe('chatMessageMapper.toDocOnSend', () => {
  it('emits the canonical legacy wire shape', () => {
    const sentinel = { __sentinel: 'serverTimestamp' };
    const wire = toDocOnSend({
      messageId: 'msg_abc123_xyz',
      sender: { id: 'a'.repeat(28), name: name('Ada', 'Lovelace') },
      text: 'On my way.',
      serverTimestamp: sentinel,
    });
    expect(wire).toEqual({
      _id: 'msg_abc123_xyz',
      text: 'On my way.',
      senderId: 'a'.repeat(28),
      createdAt: sentinel,
      user: { _id: 'a'.repeat(28), name: 'Ada Lovelace' },
    });
  });

  it('does NOT inline a Date — only the supplied sentinel reaches createdAt', () => {
    const sentinel = 'SERVER_TIMESTAMP_SENTINEL';
    const wire = toDocOnSend({
      messageId: 'msg_abc123_xyz',
      sender: { id: 'a'.repeat(28), name: name() },
      text: 'hi',
      serverTimestamp: sentinel,
    });
    expect(wire.createdAt).toBe(sentinel);
    expect(wire.createdAt).not.toBeInstanceOf(Date);
  });

  it('joins PersonName.full into user.name for the Cloud Function push title', () => {
    const wire = toDocOnSend({
      messageId: 'msg_abc123_xyz',
      sender: { id: 'a'.repeat(28), name: name('Grace', 'Hopper') },
      text: 'hi',
      serverTimestamp: 0,
    });
    expect(wire.user.name).toBe('Grace Hopper');
  });
});
