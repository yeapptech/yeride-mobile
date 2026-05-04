import { renderHook } from '@testing-library/react-native';
import { Linking } from 'react-native';

import { useOpenSettings } from '../useOpenSettings';

describe('useOpenSettings', () => {
  it('returns a callback that calls Linking.openSettings', () => {
    const spy = jest
      .spyOn(Linking, 'openSettings')
      .mockResolvedValue(undefined);
    const { result } = renderHook(() => useOpenSettings());

    result.current();

    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('swallows Linking.openSettings rejections (best-effort)', async () => {
    const spy = jest
      .spyOn(Linking, 'openSettings')
      .mockRejectedValue(new Error('deep-link unavailable'));
    const { result } = renderHook(() => useOpenSettings());

    // Should not throw — the fire-and-forget call swallows the rejection
    // via `.catch()` and logs at warn level. The test just exercises the
    // path; absence of a thrown error is the assertion.
    expect(() => result.current()).not.toThrow();
    // Flush the rejected promise's microtask so the catch handler runs
    // before the test exits (otherwise jest reports an unhandled
    // rejection).
    await Promise.resolve();
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('returns a stable callback reference across re-renders', () => {
    jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    const { result, rerender } = renderHook(() => useOpenSettings());
    const first = result.current;
    rerender(undefined);
    expect(result.current).toBe(first);
  });
});
