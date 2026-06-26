import type { ImageSourcePropType } from 'react-native';

import driverCarImage from './assets/driver-car.png';

/**
 * Shared driver "you are here" marker image — a top-down cab-yellow car
 * (white outline so it reads on both light and dark map tiles), drawn
 * pointing NORTH. Pass as `MapMarkerProps.image` for the driver slot and
 * set `MapMarkerProps.rotation` to the live GPS heading (degrees clockwise
 * from north) so the car faces the direction of travel. React Native
 * resolves the @2x / @3x density variants by device scale.
 */
export const DRIVER_CAR_MARKER: ImageSourcePropType = driverCarImage;
