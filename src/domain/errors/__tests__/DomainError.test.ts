import { AuthorizationError } from '../AuthorizationError';
import { ConflictError } from '../ConflictError';
import { DomainError } from '../DomainError';
import { NotFoundError } from '../NotFoundError';
import { PaymentError } from '../PaymentError';
import { ValidationError } from '../ValidationError';

describe('DomainError hierarchy', () => {
  describe('ValidationError', () => {
    it('exposes code, message, kind, and optional field', () => {
      const e = new ValidationError({
        code: 'invalid_email',
        message: 'Email is malformed',
        field: 'email',
      });
      expect(e).toBeInstanceOf(DomainError);
      expect(e).toBeInstanceOf(Error);
      expect(e.kind).toBe('validation');
      expect(e.code).toBe('invalid_email');
      expect(e.message).toBe('Email is malformed');
      expect(e.field).toBe('email');
      expect(e.name).toBe('ValidationError');
    });

    it('accepts no field when validation is cross-cutting', () => {
      const e = new ValidationError({
        code: 'inconsistent_state',
        message: 'Pickup and dropoff cannot be the same',
      });
      expect(e.field).toBeUndefined();
    });
  });

  describe('AuthorizationError', () => {
    it('carries the resource being accessed', () => {
      const e = new AuthorizationError({
        code: 'forbidden_trip',
        message: 'You cannot modify this trip',
        resource: 'trips/abc123',
      });
      expect(e.kind).toBe('authorization');
      expect(e.resource).toBe('trips/abc123');
    });
  });

  describe('NotFoundError', () => {
    it('carries the resource type and id', () => {
      const e = new NotFoundError({
        code: 'trip_not_found',
        message: 'No such trip',
        resource: 'trip',
        id: 'abc123',
      });
      expect(e.kind).toBe('not_found');
      expect(e.resource).toBe('trip');
      expect(e.id).toBe('abc123');
    });
  });

  describe('ConflictError', () => {
    it('represents an invalid state transition', () => {
      const e = new ConflictError({
        code: 'trip_already_started',
        message: 'Cannot start a trip that is already started',
      });
      expect(e.kind).toBe('conflict');
      expect(e.code).toBe('trip_already_started');
    });
  });

  describe('PaymentError', () => {
    it('captures provider code and decline reason', () => {
      const e = new PaymentError({
        code: 'card_declined',
        message: 'Your card was declined',
        providerCode: 'card_error',
        declineReason: 'insufficient_funds',
      });
      expect(e.kind).toBe('payment');
      expect(e.providerCode).toBe('card_error');
      expect(e.declineReason).toBe('insufficient_funds');
    });
  });

  it('all subclasses serialize to JSON cleanly enough for logging', () => {
    const errors: DomainError[] = [
      new ValidationError({ code: 'v', message: 'V' }),
      new AuthorizationError({ code: 'a', message: 'A' }),
      new NotFoundError({ code: 'n', message: 'N', resource: 'thing' }),
      new ConflictError({ code: 'c', message: 'C' }),
      new PaymentError({ code: 'p', message: 'P' }),
    ];
    for (const e of errors) {
      const json = JSON.stringify({
        kind: e.kind,
        code: e.code,
        message: e.message,
      });
      expect(JSON.parse(json)).toMatchObject({
        kind: e.kind,
        code: e.code,
        message: e.message,
      });
    }
  });

  it('preserves cause for upstream debugging', () => {
    const root = new Error('underlying network failure');
    const e = new ValidationError({
      code: 'parse_failed',
      message: 'Could not parse server response',
      cause: root,
    });
    expect(e.cause).toBe(root);
  });
});
