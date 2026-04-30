import { fireEvent, render } from '@testing-library/react-native';

import AddPaymentMethodScreen from '../AddPaymentMethodScreen';

/**
 * Smoke renders for the AddPaymentMethod modal. The view-model is mocked
 * at the hook seam so we can hand each tagged-union arm into the screen
 * directly. The Stripe `<CardForm/>` is replaced by the SDK-shipped
 * jest mock (see `node_modules/@stripe/stripe-react-native/jest/mock.js`)
 * which renders a string node — we don't try to drive it.
 */

const mockUseAddPaymentMethodViewModel = jest.fn();
jest.mock('../../view-models/useAddPaymentMethodViewModel', () => ({
  useAddPaymentMethodViewModel: () => mockUseAddPaymentMethodViewModel(),
}));

describe('AddPaymentMethodScreen', () => {
  beforeEach(() => {
    mockUseAddPaymentMethodViewModel.mockReset();
  });

  it('renders idle with disabled Save until isCardComplete', () => {
    const onSave = jest.fn();
    mockUseAddPaymentMethodViewModel.mockReturnValue({
      state: {
        kind: 'idle',
        isCardComplete: false,
        isSaving: false,
        onFormComplete: () => undefined,
        onSave,
        onCancel: () => undefined,
      },
    });

    const { getByTestId } = render(<AddPaymentMethodScreen />);
    const save = getByTestId('add-pm-save');
    fireEvent.press(save);
    // Save is disabled at the prop level when !isCardComplete; pressing
    // a disabled Pressable doesn't invoke onPress per RN behavior, so
    // the spy stays untouched.
    expect(onSave).not.toHaveBeenCalled();
  });

  it('renders the error banner with dismiss when in error arm', () => {
    const onDismiss = jest.fn();
    mockUseAddPaymentMethodViewModel.mockReturnValue({
      state: {
        kind: 'error',
        error: 'card_declined',
        isCardComplete: true,
        isSaving: false,
        onFormComplete: () => undefined,
        onSave: () => undefined,
        onCancel: () => undefined,
        onDismissError: onDismiss,
      },
    });

    const { getByTestId, queryByText } = render(<AddPaymentMethodScreen />);
    expect(queryByText(/declined/i)).not.toBeNull();
    fireEvent.press(getByTestId('add-pm-error-dismiss'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
