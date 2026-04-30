// Global Jest setup. Mocks for native-only modules (Reanimated, GestureHandler,
// Firebase, Stripe, etc.) live here.
//
// Stripe (Phase 6 turn 3): the SDK ships its own jest mock that returns
// stub implementations for every hook + every `useStripe()` method. Tests
// that need specific behavior override per-test via:
//
//   import { useStripe } from '@stripe/stripe-react-native';
//   (useStripe as jest.Mock).mockReturnValueOnce({
//     confirmSetupIntent: jest.fn().mockResolvedValueOnce({ setupIntent: {...} }),
//   });
//
// Without this global mock, importing `@stripe/stripe-react-native` in a
// view-model test would pull in the SDK's TurboModule registration which
// fails outside a real RN runtime.

jest.mock('@stripe/stripe-react-native', () =>
  require('@stripe/stripe-react-native/jest/mock'),
);

export {};
