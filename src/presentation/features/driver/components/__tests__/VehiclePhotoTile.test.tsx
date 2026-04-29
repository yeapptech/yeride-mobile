import { fireEvent, render } from '@testing-library/react-native';

import { VehiclePhotoTile } from '../VehiclePhotoTile';

describe('VehiclePhotoTile', () => {
  it('renders an idle tile with the camera glyph + Tap to upload hint', () => {
    const onPress = jest.fn();
    const onClearError = jest.fn();
    const { getByTestId, getByText } = render(
      <VehiclePhotoTile
        type="front"
        state={{ kind: 'idle' }}
        onPress={onPress}
        onClearError={onClearError}
      />,
    );
    expect(getByTestId('vehicle-photo-tile-front')).toBeTruthy();
    expect(getByText('Tap to upload')).toBeTruthy();
    expect(getByText('Front')).toBeTruthy();

    fireEvent.press(getByTestId('vehicle-photo-tile-front'));
    expect(onPress).toHaveBeenCalledWith('front');
  });

  it('renders an attached tile with the photo + checkmark; press still fires for re-upload', () => {
    const onPress = jest.fn();
    const onClearError = jest.fn();
    const { getByTestId, getByText } = render(
      <VehiclePhotoTile
        type="back"
        state={{ kind: 'attached', url: 'memory://vehicles/X/back_1.jpg' }}
        onPress={onPress}
        onClearError={onClearError}
      />,
    );
    expect(getByText('Back')).toBeTruthy();
    expect(getByText('✓')).toBeTruthy();

    fireEvent.press(getByTestId('vehicle-photo-tile-back'));
    expect(onPress).toHaveBeenCalledWith('back');
  });

  it('renders an uploading tile with a disabled press', () => {
    const onPress = jest.fn();
    const onClearError = jest.fn();
    const { getByTestId } = render(
      <VehiclePhotoTile
        type="left"
        state={{ kind: 'uploading' }}
        onPress={onPress}
        onClearError={onClearError}
      />,
    );
    fireEvent.press(getByTestId('vehicle-photo-tile-left'));
    expect(onPress).not.toHaveBeenCalled();
  });

  it('renders an error tile with the dismiss button wired to onClearError', () => {
    const onPress = jest.fn();
    const onClearError = jest.fn();
    const { getByTestId, getByText } = render(
      <VehiclePhotoTile
        type="right"
        state={{ kind: 'error', error: new Error('boom') }}
        onPress={onPress}
        onClearError={onClearError}
      />,
    );
    expect(getByText('Upload failed')).toBeTruthy();
    expect(getByText('Tap to retry')).toBeTruthy();

    fireEvent.press(getByTestId('vehicle-photo-tile-right-clear-error'));
    expect(onClearError).toHaveBeenCalledWith('right');
  });
});
