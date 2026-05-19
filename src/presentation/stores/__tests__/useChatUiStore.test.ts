import { RideId } from '@domain/entities/RideId';

import { useChatUiStore } from '../useChatUiStore';

function rideId(suffix = '1'): RideId {
  const r = RideId.create(`ride_chatui_${suffix}`);
  if (!r.ok) throw new Error('test setup');
  return r.value;
}

describe('useChatUiStore', () => {
  beforeEach(() => {
    useChatUiStore.getState().reset();
  });

  it('starts closed with null openRideId and no lastReadAt', () => {
    const s = useChatUiStore.getState();
    expect(s.isOpen).toBe(false);
    expect(s.openRideId).toBe(null);
    expect(s.lastReadAt).toBeNull();
  });

  it('open(rideId) flips isOpen and records the openRideId', () => {
    useChatUiStore.getState().open(rideId());
    const s = useChatUiStore.getState();
    expect(s.isOpen).toBe(true);
    expect(s.openRideId).not.toBe(null);
    expect(String(s.openRideId)).toBe(String(rideId()));
  });

  it('close flips isOpen back and clears openRideId', () => {
    useChatUiStore.getState().open(rideId());
    useChatUiStore.getState().close();
    const s = useChatUiStore.getState();
    expect(s.isOpen).toBe(false);
    expect(s.openRideId).toBe(null);
  });

  it('open replaces the openRideId when called twice', () => {
    useChatUiStore.getState().open(rideId('A'));
    useChatUiStore.getState().open(rideId('B'));
    expect(String(useChatUiStore.getState().openRideId)).toBe(
      String(rideId('B')),
    );
  });

  it('markRead with no arg uses the current wall-clock', () => {
    const before = new Date();
    useChatUiStore.getState().markRead();
    const after = new Date();
    const recorded = useChatUiStore.getState().lastReadAt;
    expect(recorded).not.toBeNull();
    if (recorded) {
      expect(recorded.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(recorded.getTime()).toBeLessThanOrEqual(after.getTime());
    }
  });

  it('markRead accepts an explicit timestamp', () => {
    const ts = new Date('2026-04-28T10:00:00Z');
    useChatUiStore.getState().markRead(ts);
    expect(useChatUiStore.getState().lastReadAt).toEqual(ts);
  });

  it('reset clears state including openRideId', () => {
    useChatUiStore.getState().open(rideId());
    useChatUiStore.getState().markRead();
    useChatUiStore.getState().reset();
    const s = useChatUiStore.getState();
    expect(s.isOpen).toBe(false);
    expect(s.openRideId).toBe(null);
    expect(s.lastReadAt).toBeNull();
  });
});
