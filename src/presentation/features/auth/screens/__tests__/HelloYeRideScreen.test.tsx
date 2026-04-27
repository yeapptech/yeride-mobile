import { fireEvent, render, screen } from '@testing-library/react-native';

import type { GreetUser } from '@app/usecases/shared/GreetUser';
import { ValidationError } from '@domain/errors';
import { Result } from '@domain/shared/Result';
import { TestContainerProvider } from '@shared/testing';

import { HelloYeRideScreen } from '../HelloYeRideScreen';

describe('HelloYeRideScreen', () => {
  it('renders the greet button and the default name', () => {
    render(
      <TestContainerProvider>
        <HelloYeRideScreen />
      </TestContainerProvider>,
    );
    expect(screen.getByDisplayValue('YeRide')).toBeTruthy();
    expect(screen.getByText('Greet')).toBeTruthy();
  });

  it('displays the greeting from the use case on press', () => {
    render(
      <TestContainerProvider>
        <HelloYeRideScreen />
      </TestContainerProvider>,
    );
    fireEvent.changeText(screen.getByDisplayValue('YeRide'), 'Ada');
    fireEvent.press(screen.getByText('Greet'));
    expect(screen.getByText('Hello, Ada!')).toBeTruthy();
  });

  it('displays the validation error when the use case fails', () => {
    const failing: GreetUser = {
      execute: () =>
        Result.err(
          new ValidationError({
            code: 'greet_empty_name',
            message: 'Name is required',
            field: 'name',
          }),
        ),
    } as unknown as GreetUser;
    render(
      <TestContainerProvider useCases={{ greetUser: failing }}>
        <HelloYeRideScreen />
      </TestContainerProvider>,
    );
    fireEvent.press(screen.getByText('Greet'));
    expect(screen.getByText('Name is required')).toBeTruthy();
  });
});
