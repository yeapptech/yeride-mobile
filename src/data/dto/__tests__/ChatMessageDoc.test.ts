import { ChatMessageDocSchema } from '../ChatMessageDoc';

describe('ChatMessageDocSchema', () => {
  it('accepts a Firestore-style doc with a Timestamp createdAt', () => {
    const fakeTimestamp = {
      seconds: 1_700_000_000,
      nanoseconds: 0,
      toDate: () => new Date(1_700_000_000_000),
    };
    const r = ChatMessageDocSchema.safeParse({
      _id: 'msg_abc123',
      text: 'On my way.',
      senderId: 'a'.repeat(28),
      createdAt: fakeTimestamp,
      user: { _id: 'a'.repeat(28), name: 'Ada Lovelace' },
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.createdAt).toBeInstanceOf(Date);
      expect((r.data.createdAt as Date).getTime()).toBe(1_700_000_000_000);
    }
  });

  it('accepts an ISO-string createdAt (defensive)', () => {
    const r = ChatMessageDocSchema.safeParse({
      text: 'hi',
      senderId: 'a'.repeat(28),
      createdAt: '2026-05-19T12:00:00.000Z',
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.createdAt).toBeInstanceOf(Date);
    }
  });

  it('accepts a Date instance createdAt (defensive)', () => {
    const d = new Date('2026-05-19T12:00:00.000Z');
    const r = ChatMessageDocSchema.safeParse({
      text: 'hi',
      senderId: 'a'.repeat(28),
      createdAt: d,
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.createdAt).toEqual(d);
  });

  it('coerces a null createdAt to null (serverTimestamp local placeholder)', () => {
    const r = ChatMessageDocSchema.safeParse({
      text: 'hi',
      senderId: 'a'.repeat(28),
      createdAt: null,
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.createdAt).toBe(null);
  });

  it('coerces a NaN-Date createdAt to null', () => {
    const r = ChatMessageDocSchema.safeParse({
      text: 'hi',
      senderId: 'a'.repeat(28),
      createdAt: new Date('not a date'),
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.createdAt).toBe(null);
  });

  it('coerces a non-Timestamp object createdAt to null', () => {
    const r = ChatMessageDocSchema.safeParse({
      text: 'hi',
      senderId: 'a'.repeat(28),
      createdAt: { foo: 'bar' },
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.createdAt).toBe(null);
  });

  it('rejects a missing text field', () => {
    const r = ChatMessageDocSchema.safeParse({
      senderId: 'a'.repeat(28),
      createdAt: null,
    });
    expect(r.success).toBe(false);
  });

  it('rejects an empty text field', () => {
    const r = ChatMessageDocSchema.safeParse({
      text: '',
      senderId: 'a'.repeat(28),
      createdAt: null,
    });
    expect(r.success).toBe(false);
  });

  it('rejects a missing senderId field', () => {
    const r = ChatMessageDocSchema.safeParse({
      text: 'hi',
      createdAt: null,
    });
    expect(r.success).toBe(false);
  });

  it('passes through additional user fields (gifted-chat avatar etc.)', () => {
    const r = ChatMessageDocSchema.safeParse({
      text: 'hi',
      senderId: 'a'.repeat(28),
      createdAt: null,
      user: {
        _id: 'a'.repeat(28),
        name: 'Ada',
        avatar: 'https://example.com/a.png',
      },
    });
    expect(r.success).toBe(true);
    if (r.success) {
      // Passthrough preserves unknown keys.
      expect(
        (r.data.user as { avatar?: string } | null | undefined)?.avatar,
      ).toBe('https://example.com/a.png');
    }
  });

  it('accepts a doc without the optional gifted-chat _id field', () => {
    const r = ChatMessageDocSchema.safeParse({
      text: 'hi',
      senderId: 'a'.repeat(28),
      createdAt: null,
    });
    expect(r.success).toBe(true);
  });
});
