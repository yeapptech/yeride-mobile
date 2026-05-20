import { ChatMessage, ChatMessageId } from '../ChatMessage';
import { UserId } from '../UserId';

function uid(): UserId {
  const r = UserId.create('a'.repeat(28));
  if (!r.ok) throw new Error('test setup: UserId.create failed');
  return r.value;
}

function msgId(raw: string = 'msg_abc123_xyz'): ChatMessageId {
  const r = ChatMessageId.create(raw);
  if (!r.ok) throw new Error('test setup: ChatMessageId.create failed');
  return r.value;
}

describe('ChatMessageId', () => {
  describe('create', () => {
    it('accepts a Firestore-style alphanumeric id', () => {
      const r = ChatMessageId.create('aBc012XYZ34567890123');
      expect(r.ok).toBe(true);
    });

    it('accepts underscores and hyphens', () => {
      expect(ChatMessageId.create('abc_def-XYZ').ok).toBe(true);
    });

    it('rejects non-strings', () => {
      const r = ChatMessageId.create(42 as unknown as string);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe('chat_message_id_not_a_string');
    });

    it('rejects too-short ids', () => {
      const r = ChatMessageId.create('abc');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe('chat_message_id_invalid_length');
    });

    it('rejects too-long ids', () => {
      const r = ChatMessageId.create('a'.repeat(65));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe('chat_message_id_invalid_length');
    });

    it('rejects ids with disallowed characters', () => {
      const r = ChatMessageId.create('abc/def?xyz');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe('chat_message_id_invalid_format');
    });
  });
});

describe('ChatMessage', () => {
  describe('create', () => {
    it('accepts a well-formed message and trims the text', () => {
      const r = ChatMessage.create({
        id: msgId(),
        senderId: uid(),
        text: '  On my way.  ',
        createdAt: new Date('2026-05-19T12:00:00Z'),
      });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.value.text).toBe('On my way.');
        expect(r.value.readAt).toBe(null);
      }
    });

    it('defaults readAt to null when omitted', () => {
      const r = ChatMessage.create({
        id: msgId(),
        senderId: uid(),
        text: 'hi',
        createdAt: new Date(),
      });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value.readAt).toBe(null);
    });

    it('accepts an explicit readAt Date', () => {
      const readAt = new Date('2026-05-19T13:00:00Z');
      const r = ChatMessage.create({
        id: msgId(),
        senderId: uid(),
        text: 'hi',
        createdAt: new Date('2026-05-19T12:00:00Z'),
        readAt,
      });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value.readAt).toEqual(readAt);
    });

    it('rejects non-string text', () => {
      const r = ChatMessage.create({
        id: msgId(),
        senderId: uid(),
        text: 42 as unknown as string,
        createdAt: new Date(),
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe('chat_message_text_not_a_string');
    });

    it('rejects empty text', () => {
      const r = ChatMessage.create({
        id: msgId(),
        senderId: uid(),
        text: '',
        createdAt: new Date(),
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe('chat_message_empty_text');
    });

    it('rejects whitespace-only text', () => {
      const r = ChatMessage.create({
        id: msgId(),
        senderId: uid(),
        text: '   \n\t   ',
        createdAt: new Date(),
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe('chat_message_empty_text');
    });

    it('rejects overlong text', () => {
      const r = ChatMessage.create({
        id: msgId(),
        senderId: uid(),
        text: 'x'.repeat(1001),
        createdAt: new Date(),
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe('chat_message_text_too_long');
    });

    it('accepts text at the exact 1000-char cap', () => {
      const r = ChatMessage.create({
        id: msgId(),
        senderId: uid(),
        text: 'x'.repeat(1000),
        createdAt: new Date(),
      });
      expect(r.ok).toBe(true);
    });

    it('rejects NaN-Date createdAt', () => {
      const r = ChatMessage.create({
        id: msgId(),
        senderId: uid(),
        text: 'hi',
        createdAt: new Date('not a real date'),
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe('chat_message_invalid_created_at');
    });

    it('rejects non-Date createdAt', () => {
      const r = ChatMessage.create({
        id: msgId(),
        senderId: uid(),
        text: 'hi',
        createdAt: '2026-05-19T12:00:00Z' as unknown as Date,
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe('chat_message_invalid_created_at');
    });

    it('rejects NaN-Date readAt', () => {
      const r = ChatMessage.create({
        id: msgId(),
        senderId: uid(),
        text: 'hi',
        createdAt: new Date(),
        readAt: new Date('not a real date'),
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe('chat_message_invalid_read_at');
    });

    it('defaults senderName to null when omitted', () => {
      const r = ChatMessage.create({
        id: msgId(),
        senderId: uid(),
        text: 'hi',
        createdAt: new Date(),
      });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value.senderName).toBe(null);
    });

    it('trims senderName and preserves it', () => {
      const r = ChatMessage.create({
        id: msgId(),
        senderId: uid(),
        text: 'hi',
        createdAt: new Date(),
        senderName: '  Ada Lovelace  ',
      });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value.senderName).toBe('Ada Lovelace');
    });

    it('collapses empty / whitespace-only senderName to null', () => {
      const r = ChatMessage.create({
        id: msgId(),
        senderId: uid(),
        text: 'hi',
        createdAt: new Date(),
        senderName: '   ',
      });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value.senderName).toBe(null);
    });

    it('accepts explicit null senderName', () => {
      const r = ChatMessage.create({
        id: msgId(),
        senderId: uid(),
        text: 'hi',
        createdAt: new Date(),
        senderName: null,
      });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value.senderName).toBe(null);
    });
  });

  describe('markRead', () => {
    it('returns a new instance with the supplied Date', () => {
      const original = (() => {
        const r = ChatMessage.create({
          id: msgId(),
          senderId: uid(),
          text: 'hi',
          createdAt: new Date('2026-05-19T12:00:00Z'),
        });
        if (!r.ok) throw new Error('setup');
        return r.value;
      })();
      const readAt = new Date('2026-05-19T13:00:00Z');
      const r = original.markRead(readAt);
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.value).not.toBe(original);
        expect(r.value.readAt).toEqual(readAt);
        expect(r.value.id).toBe(original.id);
        expect(r.value.text).toBe(original.text);
        expect(original.readAt).toBe(null); // original unchanged
      }
    });

    it('rejects NaN-Date', () => {
      const original = (() => {
        const r = ChatMessage.create({
          id: msgId(),
          senderId: uid(),
          text: 'hi',
          createdAt: new Date(),
        });
        if (!r.ok) throw new Error('setup');
        return r.value;
      })();
      const r = original.markRead(new Date('not a real date'));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe('chat_message_invalid_read_at');
    });
  });
});
