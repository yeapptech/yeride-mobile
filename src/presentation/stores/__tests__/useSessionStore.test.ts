import { UserId } from '@domain/entities/UserId';

import { useSessionStore } from '../useSessionStore';

function uid() {
  const r = UserId.create('aaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  if (!r.ok) throw r.error;
  return r.value;
}

describe('useSessionStore', () => {
  beforeEach(() => {
    // Reset to initial state
    useSessionStore.setState({ status: 'initializing', userId: null });
  });

  it('starts in the initializing state with no userId', () => {
    const s = useSessionStore.getState();
    expect(s.status).toBe('initializing');
    expect(s.userId).toBeNull();
  });

  it('setSignedIn flips status to authenticated and stores the userId', () => {
    const id = uid();
    useSessionStore.getState().setSignedIn(id);
    const s = useSessionStore.getState();
    expect(s.status).toBe('authenticated');
    expect(s.userId).toBe(id);
  });

  it('setSignedOut moves to unauthenticated and clears the userId', () => {
    useSessionStore.getState().setSignedIn(uid());
    useSessionStore.getState().setSignedOut();
    const s = useSessionStore.getState();
    expect(s.status).toBe('unauthenticated');
    expect(s.userId).toBeNull();
  });

  it('setInitializing returns to the initial state', () => {
    useSessionStore.getState().setSignedIn(uid());
    useSessionStore.getState().setInitializing();
    const s = useSessionStore.getState();
    expect(s.status).toBe('initializing');
    expect(s.userId).toBeNull();
  });

  it('setNeedsVerification flips status and stores the userId', () => {
    const id = uid();
    useSessionStore.getState().setNeedsVerification(id);
    const s = useSessionStore.getState();
    expect(s.status).toBe('needs-verification');
    expect(s.userId).toBe(id);
  });

  it('flow from needs-verification to authenticated keeps the same userId', () => {
    const id = uid();
    useSessionStore.getState().setNeedsVerification(id);
    expect(useSessionStore.getState().status).toBe('needs-verification');
    useSessionStore.getState().setSignedIn(id);
    const s = useSessionStore.getState();
    expect(s.status).toBe('authenticated');
    expect(s.userId).toBe(id);
  });

  it('notifies subscribers when status changes', () => {
    const calls: string[] = [];
    const unsubscribe = useSessionStore.subscribe((s) => {
      calls.push(s.status);
    });
    useSessionStore.getState().setNeedsVerification(uid());
    useSessionStore.getState().setSignedIn(uid());
    useSessionStore.getState().setSignedOut();
    unsubscribe();
    expect(calls).toEqual([
      'needs-verification',
      'authenticated',
      'unauthenticated',
    ]);
  });
});
