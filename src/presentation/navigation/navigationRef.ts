import {
  createNavigationContainerRef,
  type NavigationContainerRefWithCurrent,
  type ParamListBase,
} from '@react-navigation/native';

/**
 * App-wide ref to the React Navigation container. Lets code outside the
 * React tree (most notably the notification-tap handler in
 * `useNotificationResponseHandler` from Phase 9 turn 2 sub-turn 2c)
 * dispatch navigations without having a `useNavigation()` hook in
 * scope.
 *
 * Wired by passing `ref={navigationRef}` to `<NavigationContainer/>`
 * in `App.tsx`. Consumers should null-check `.isReady()` before
 * dispatching — the ref is bound at first render but the navigator
 * tree may not have mounted its first screen yet.
 *
 * Type parameter is intentionally untyped (the param-list union is
 * the entire app's navigation graph; threading it would require
 * importing every Param type and Phase 9 doesn't need that). Casts at
 * the call site stay narrow.
 *
 * **Lazy initialization is intentional.** Many view-model tests in this
 * codebase mock `@react-navigation/native` per-test via
 * `jest.mock('@react-navigation/native', () => ({useNavigation: ...}))`,
 * which omits `createNavigationContainerRef` from the module exports.
 * Calling it at module-load time crashes those tests (every file that
 * imports the `@presentation/hooks` barrel transitively pulls in this
 * file). A `Proxy` with lazy resolution defers the call until first
 * actual use — by then production code has the real SDK in scope and
 * tests that exercise tap routing explicitly spy on `navigationRef`
 * after the real export is bound.
 */

type NavRef = NavigationContainerRefWithCurrent<ParamListBase>;

/**
 * Module-load IIFE: build the real ref when React Navigation is
 * available, fall back to a plain stub when it isn't (per-test
 * `jest.mock('@react-navigation/native', ...)` calls that omit
 * `createNavigationContainerRef`).
 *
 * The stub is a real object — not a Proxy — so `jest.spyOn` can wrap
 * its methods without breaking. Tests that exercise tap routing
 * (`useNotificationResponseHandler.test.tsx`) are rendered in an
 * environment where the per-file mock factories DON'T touch
 * `@react-navigation/native`, so the import resolves to the real
 * module and `createNavigationContainerRef()` returns a real ref.
 *
 * Production always hits the `typeof === 'function'` branch.
 */
function buildRef(): NavRef {
  if (typeof createNavigationContainerRef === 'function') {
    return createNavigationContainerRef<ParamListBase>();
  }
  // Test fallback for files that mock `@react-navigation/native` to a
  // partial surface. None of these methods get exercised at runtime
  // in those tests — the screens / view-models under test never tap
  // a notification — so the no-op shape is sufficient.
  return {
    isReady: () => false,
    dispatch: () => {},
    navigate: () => {},
    reset: () => {},
    goBack: () => {},
    current: null,
    getRootState: () => undefined,
    getCurrentRoute: () => undefined,
    getCurrentOptions: () => undefined,
    canGoBack: () => false,
    addListener: () => () => {},
    removeListener: () => {},
    setParams: () => {},
    setOptions: () => {},
  } as unknown as NavRef;
}

export const navigationRef: NavRef = buildRef();
