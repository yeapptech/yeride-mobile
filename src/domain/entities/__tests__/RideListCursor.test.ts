import { RideListCursor } from '../RideListCursor';

describe('RideListCursor', () => {
  describe('.create', () => {
    it('accepts a valid timestamp + Firestore doc id', () => {
      const r = RideListCursor.create({
        createdAtMillis: 1_700_000_000_000,
        docId: 'AbCdEf123-XyZ_45',
      });
      expect(r.ok).toBe(true);
      if (r.ok) {
        // Cursor is opaque — only verify it's a non-empty string and
        // decodes back to the same fields.
        expect(typeof (r.value as unknown as string)).toBe('string');
        const decoded = RideListCursor.decode(r.value);
        expect(decoded.ok).toBe(true);
        if (decoded.ok) {
          expect(decoded.value.createdAtMillis).toBe(1_700_000_000_000);
          expect(decoded.value.docId).toBe('AbCdEf123-XyZ_45');
        }
      }
    });

    it('accepts 0 as a boundary timestamp', () => {
      const r = RideListCursor.create({
        createdAtMillis: 0,
        docId: 'edgecase',
      });
      expect(r.ok).toBe(true);
    });

    it('floors a non-integer timestamp to milliseconds', () => {
      const r = RideListCursor.create({
        createdAtMillis: 1_700_000_000_001.9,
        docId: 'AbCdEf123',
      });
      expect(r.ok).toBe(true);
      if (r.ok) {
        const decoded = RideListCursor.decode(r.value);
        if (decoded.ok) {
          expect(decoded.value.createdAtMillis).toBe(1_700_000_000_001);
        }
      }
    });

    it('rejects a non-finite timestamp', () => {
      const r = RideListCursor.create({
        createdAtMillis: Number.NaN,
        docId: 'AbCdEf123',
      });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error.code).toBe('ride_list_cursor_invalid_timestamp');
      }
    });

    it('rejects a negative timestamp', () => {
      const r = RideListCursor.create({
        createdAtMillis: -1,
        docId: 'AbCdEf123',
      });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error.code).toBe('ride_list_cursor_negative_timestamp');
      }
    });

    it('rejects an empty docId', () => {
      const r = RideListCursor.create({
        createdAtMillis: 1_700_000_000_000,
        docId: '',
      });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error.code).toBe('ride_list_cursor_missing_doc_id');
      }
    });

    it('rejects a docId with invalid characters', () => {
      const r = RideListCursor.create({
        createdAtMillis: 1_700_000_000_000,
        docId: 'has spaces',
      });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error.code).toBe('ride_list_cursor_invalid_doc_id');
      }
    });

    it('rejects a docId longer than 64 characters', () => {
      const r = RideListCursor.create({
        createdAtMillis: 1_700_000_000_000,
        docId: 'a'.repeat(65),
      });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error.code).toBe('ride_list_cursor_doc_id_too_long');
      }
    });
  });

  describe('.decode', () => {
    it('round-trips a valid cursor', () => {
      const created = RideListCursor.create({
        createdAtMillis: 1_700_000_000_000,
        docId: 'AbCdEf123',
      });
      if (!created.ok) throw new Error('create failed');
      const decoded = RideListCursor.decode(created.value);
      expect(decoded.ok).toBe(true);
      if (decoded.ok) {
        expect(decoded.value).toEqual({
          createdAtMillis: 1_700_000_000_000,
          docId: 'AbCdEf123',
        });
      }
    });

    it('rejects a malformed cursor (missing colon separator)', () => {
      const bogus = 'not-a-valid-cursor' as unknown as Parameters<
        typeof RideListCursor.decode
      >[0];
      const decoded = RideListCursor.decode(bogus);
      expect(decoded.ok).toBe(false);
      if (!decoded.ok) {
        expect(decoded.error.code).toBe('ride_list_cursor_decode_failed');
      }
    });

    it('rejects a cursor with a non-numeric timestamp segment', () => {
      // Bypass the brand to construct a syntactically-shaped-but-
      // semantically-broken cursor.
      const bogus = 'notanumber:AbCdEf123' as unknown as Parameters<
        typeof RideListCursor.decode
      >[0];
      const decoded = RideListCursor.decode(bogus);
      expect(decoded.ok).toBe(false);
      if (!decoded.ok) {
        expect(decoded.error.code).toBe('ride_list_cursor_decode_failed');
      }
    });
  });
});
