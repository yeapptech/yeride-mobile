import { useChatUiStore } from '../useChatUiStore';

describe('useChatUiStore', () => {
  beforeEach(() => {
    useChatUiStore.getState().reset();
  });

  it('starts closed with no lastReadAt', () => {
    const s = useChatUiStore.getState();
    expect(s.isOpen).toBe(false);
    expect(s.lastReadAt).toBeNull();
  });

  it('open flips isOpen', () => {
    useChatUiStore.getState().open();
    expect(useChatUiStore.getState().isOpen).toBe(true);
  });

  it('close flips isOpen back', () => {
    useChatUiStore.getState().open();
    useChatUiStore.getState().close();
    expect(useChatUiStore.getState().isOpen).toBe(false);
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

  it('reset clears state', () => {
    useChatUiStore.getState().open();
    useChatUiStore.getState().markRead();
    useChatUiStore.getState().reset();
    const s = useChatUiStore.getState();
    expect(s.isOpen).toBe(false);
    expect(s.lastReadAt).toBeNull();
  });
});
