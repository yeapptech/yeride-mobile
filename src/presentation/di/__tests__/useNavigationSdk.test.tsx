/**
 * @jest-environment node
 */
import { renderHook } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { useNavigationSdk } from '@presentation/di';
import {
  FakeNavigationSdkClient,
  TestContainerProvider,
} from '@shared/testing';

/**
 * Phase 8 turn 1 — verify the new `useNavigationSdk()` sibling hook
 * follows the same throw-outside-provider contract as `useUseCases()` /
 * `useBackgroundGeolocation()`, and resolves to the
 * `FakeNavigationSdkClient` injected via `TestContainerProvider`.
 *
 * `@jest-environment node` matches the other DI / data-layer tests; we
 * only need React's `useContext` machinery, not a DOM.
 */

describe('useNavigationSdk', () => {
  it('throws a clear programmer-error when called outside <ContainerProvider/>', () => {
    // renderHook surfaces hook errors via the result.error field rather
    // than throwing synchronously — but useContext-level throws happen
    // synchronously during render, so a try/catch around the renderHook
    // call works as expected.
    expect(() => renderHook(() => useNavigationSdk())).toThrow(
      /useNavigationSdk\(\) called outside <ContainerProvider\/>/,
    );
  });

  it('returns the injected FakeNavigationSdkClient when wrapped in TestContainerProvider', () => {
    const fake = new FakeNavigationSdkClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <TestContainerProvider navigationSdk={fake}>
        {children}
      </TestContainerProvider>
    );
    const { result } = renderHook(() => useNavigationSdk(), { wrapper });
    expect(result.current).toBe(fake);
  });

  it('default TestContainerProvider provides a fresh FakeNavigationSdkClient instance', () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <TestContainerProvider>{children}</TestContainerProvider>
    );
    const { result } = renderHook(() => useNavigationSdk(), { wrapper });
    expect(result.current).toBeInstanceOf(FakeNavigationSdkClient);
  });
});
