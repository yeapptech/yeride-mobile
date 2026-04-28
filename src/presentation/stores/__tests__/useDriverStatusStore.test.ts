import { useDriverStatusStore } from '../useDriverStatusStore';

describe('useDriverStatusStore', () => {
  beforeEach(() => {
    useDriverStatusStore.getState().reset();
  });

  it('starts offline with no active vehicle', () => {
    const s = useDriverStatusStore.getState();
    expect(s.mode).toBe('offline');
    expect(s.activeVehicleId).toBeNull();
  });

  it('goOnline flips to online_idle and stores the vehicle id', () => {
    useDriverStatusStore.getState().goOnline('vehicle-abc');
    const s = useDriverStatusStore.getState();
    expect(s.mode).toBe('online_idle');
    expect(s.activeVehicleId).toBe('vehicle-abc');
  });

  it('goOffline clears the vehicle id and returns to offline', () => {
    useDriverStatusStore.getState().goOnline('vehicle-abc');
    useDriverStatusStore.getState().goOffline();
    const s = useDriverStatusStore.getState();
    expect(s.mode).toBe('offline');
    expect(s.activeVehicleId).toBeNull();
  });

  it('setMode advances to dispatched without touching activeVehicleId', () => {
    useDriverStatusStore.getState().goOnline('vehicle-abc');
    useDriverStatusStore.getState().setMode('dispatched');
    const s = useDriverStatusStore.getState();
    expect(s.mode).toBe('dispatched');
    expect(s.activeVehicleId).toBe('vehicle-abc');
  });

  it('setMode advances to on_trip from dispatched', () => {
    useDriverStatusStore.getState().goOnline('vehicle-abc');
    useDriverStatusStore.getState().setMode('dispatched');
    useDriverStatusStore.getState().setMode('on_trip');
    expect(useDriverStatusStore.getState().mode).toBe('on_trip');
  });

  it('reset returns to defaults regardless of prior state', () => {
    useDriverStatusStore.getState().goOnline('vehicle-abc');
    useDriverStatusStore.getState().setMode('on_trip');
    useDriverStatusStore.getState().reset();
    const s = useDriverStatusStore.getState();
    expect(s.mode).toBe('offline');
    expect(s.activeVehicleId).toBeNull();
  });

  it('notifies subscribers when mode changes', () => {
    const calls: string[] = [];
    const unsubscribe = useDriverStatusStore.subscribe((s) => {
      calls.push(s.mode);
    });
    useDriverStatusStore.getState().goOnline('vehicle-abc');
    useDriverStatusStore.getState().goOffline();
    unsubscribe();
    expect(calls).toEqual(['online_idle', 'offline']);
  });
});
