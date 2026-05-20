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

  it('starts closed with null openRideId and empty lastReadAtByRide', () => {
    const s = useChatUiStore.getState();
    expect(s.isOpen).toBe(false);
    expect(s.openRideId).toBe(null);
    expect(s.lastReadAtByRide).toEqual({});
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

  it('markRead with no timestamp arg uses the current wall-clock', () => {
    const id = rideId();
    const before = new Date();
    useChatUiStore.getState().markRead(id);
    const after = new Date();
    const recorded = useChatUiStore.getState().lastReadAtByRide[String(id)];
    expect(recorded).not.toBeUndefined();
    if (recorded) {
      expect(recorded.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(recorded.getTime()).toBeLessThanOrEqual(after.getTime());
    }
  });

  it('markRead accepts an explicit timestamp', () => {
    const id = rideId();
    const ts = new Date('2026-04-28T10:00:00Z');
    useChatUiStore.getState().markRead(id, ts);
    expect(useChatUiStore.getState().lastReadAtByRide[String(id)]).toEqual(ts);
  });

  it('markRead stores per-ride entries independently', () => {
    const a = rideId('A');
    const b = rideId('B');
    const ta = new Date('2026-04-28T10:00:00Z');
    const tb = new Date('2026-04-28T11:00:00Z');
    useChatUiStore.getState().markRead(a, ta);
    useChatUiStore.getState().markRead(b, tb);
    const s = useChatUiStore.getState().lastReadAtByRide;
    expect(s[String(a)]).toEqual(ta);
    expect(s[String(b)]).toEqual(tb);
  });

  it('close does NOT clear lastReadAtByRide (dot must stay cleared after close)', () => {
    const id = rideId();
    const ts = new Date('2026-04-28T10:00:00Z');
    useChatUiStore.getState().open(id);
    useChatUiStore.getState().markRead(id, ts);
    useChatUiStore.getState().close();
    expect(useChatUiStore.getState().lastReadAtByRide[String(id)]).toEqual(ts);
  });

  it('reset clears state including lastReadAtByRide', () => {
    useChatUiStore.getState().open(rideId());
    useChatUiStore.getState().markRead(rideId());
    useChatUiStore.getState().reset();
    const s = useChatUiStore.getState();
    expect(s.isOpen).toBe(false);
    expect(s.openRideId).toBe(null);
    expect(s.lastReadAtByRide).toEqual({});
  });
});
