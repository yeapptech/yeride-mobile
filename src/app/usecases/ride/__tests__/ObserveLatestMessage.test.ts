import type { ChatMessage } from '@domain/entities/ChatMessage';
import { RideId } from '@domain/entities/RideId';

import { ObserveLatestMessage } from '../ObserveLatestMessage';

function unwrap<T>(r: { ok: true; value: T } | { ok: false; error: Error }): T {
  if (!r.ok) throw r.error;
  return r.value;
}

const RIDE_ID = unwrap(RideId.create('rideAbcDef1234567890ab'));

describe('ObserveLatestMessage (Phase 3 stub)', () => {
  it('emits null synchronously on subscribe', () => {
    const sut = new ObserveLatestMessage();

    let received: ChatMessage | null | undefined;
    let callCount = 0;
    sut.execute({
      rideId: RIDE_ID,
      callback: (msg) => {
        received = msg;
        callCount += 1;
      },
    });

    expect(callCount).toBe(1);
    expect(received).toBeNull();
  });

  it('returns a no-op unsubscribe', () => {
    const sut = new ObserveLatestMessage();
    const unsubscribe = sut.execute({
      rideId: RIDE_ID,
      callback: () => {},
    });
    // No throw, no side effects to assert; just confirm the contract.
    expect(typeof unsubscribe).toBe('function');
    expect(() => unsubscribe()).not.toThrow();
  });

  it('never emits a second time on the same subscription', async () => {
    const sut = new ObserveLatestMessage();
    let callCount = 0;
    const unsubscribe = sut.execute({
      rideId: RIDE_ID,
      callback: () => {
        callCount += 1;
      },
    });
    // Wait through a microtask + macrotask — the stub is synchronous, but
    // this guards against any future setImmediate-shaped change slipping
    // a second emission past us.
    await Promise.resolve();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(callCount).toBe(1);
    unsubscribe();
  });
});
