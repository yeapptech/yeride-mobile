import { useGeofenceUiStore } from '../useGeofenceUiStore';

describe('useGeofenceUiStore', () => {
  beforeEach(() => {
    useGeofenceUiStore.getState().reset();
  });

  it('starts with both warnings hidden', () => {
    const s = useGeofenceUiStore.getState();
    expect(s.pickupExitWarningVisible).toBe(false);
    expect(s.dropoffExitWarningVisible).toBe(false);
  });

  it('showPickupExitWarning flips the pickup flag without touching dropoff', () => {
    useGeofenceUiStore.getState().showPickupExitWarning();
    const s = useGeofenceUiStore.getState();
    expect(s.pickupExitWarningVisible).toBe(true);
    expect(s.dropoffExitWarningVisible).toBe(false);
  });

  it('dismissPickupExitWarning hides the pickup flag', () => {
    useGeofenceUiStore.getState().showPickupExitWarning();
    useGeofenceUiStore.getState().dismissPickupExitWarning();
    expect(useGeofenceUiStore.getState().pickupExitWarningVisible).toBe(false);
  });

  it('showDropoffExitWarning flips the dropoff flag without touching pickup', () => {
    useGeofenceUiStore.getState().showDropoffExitWarning();
    const s = useGeofenceUiStore.getState();
    expect(s.dropoffExitWarningVisible).toBe(true);
    expect(s.pickupExitWarningVisible).toBe(false);
  });

  it('dismissDropoffExitWarning hides the dropoff flag', () => {
    useGeofenceUiStore.getState().showDropoffExitWarning();
    useGeofenceUiStore.getState().dismissDropoffExitWarning();
    expect(useGeofenceUiStore.getState().dropoffExitWarningVisible).toBe(false);
  });

  it('reset clears every flag', () => {
    useGeofenceUiStore.getState().showPickupExitWarning();
    useGeofenceUiStore.getState().showDropoffExitWarning();
    useGeofenceUiStore.getState().reset();
    const s = useGeofenceUiStore.getState();
    expect(s.pickupExitWarningVisible).toBe(false);
    expect(s.dropoffExitWarningVisible).toBe(false);
  });

  it('notifies subscribers when a flag changes', () => {
    const calls: boolean[] = [];
    const unsubscribe = useGeofenceUiStore.subscribe((s) => {
      calls.push(s.pickupExitWarningVisible);
    });
    useGeofenceUiStore.getState().showPickupExitWarning();
    useGeofenceUiStore.getState().dismissPickupExitWarning();
    unsubscribe();
    expect(calls).toEqual([true, false]);
  });
});
