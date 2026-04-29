import { View } from 'react-native';

import {
  VEHICLE_PHOTO_TYPES,
  type VehiclePhotoType,
} from '@domain/entities/VehiclePhotoType';

import type { VehiclePhotoTileState } from '../view-models/useVehiclePhotosViewModel';

import { VehiclePhotoTile } from './VehiclePhotoTile';

interface VehiclePhotoGridProps {
  readonly tiles: Readonly<Record<VehiclePhotoType, VehiclePhotoTileState>>;
  readonly onPickPhoto: (type: VehiclePhotoType) => void;
  readonly onClearError: (type: VehiclePhotoType) => void;
}

/**
 * 5-tile photo grid. Layout: two columns of two square tiles
 * (front/back, then left/right), then a single wide tile for interior.
 * Mirrors the legacy `VehiclePhotos.js` layout (sequential 5 tiles, but
 * here we make `interior` span the full width because the side tiles
 * already cover four perspectives).
 *
 * Tile order is driven by `VEHICLE_PHOTO_TYPES` so any future tile
 * additions land in a deterministic position.
 */
export function VehiclePhotoGrid({
  tiles,
  onPickPhoto,
  onClearError,
}: VehiclePhotoGridProps) {
  // Split: first 4 = paired tiles, last 1 = wide.
  const paired = VEHICLE_PHOTO_TYPES.slice(0, 4);
  const wide = VEHICLE_PHOTO_TYPES.slice(4);

  // Group paired tiles into rows of 2.
  const rows: VehiclePhotoType[][] = [];
  for (let i = 0; i < paired.length; i += 2) {
    rows.push(paired.slice(i, i + 2));
  }

  return (
    <View className="px-2">
      {rows.map((row, rowIndex) => (
        <View key={rowIndex} className="flex-row">
          {row.map((type) => (
            <VehiclePhotoTile
              key={type}
              type={type}
              state={tiles[type]}
              onPress={onPickPhoto}
              onClearError={onClearError}
            />
          ))}
        </View>
      ))}
      {wide.map((type) => (
        <View key={type} className="flex-row">
          <VehiclePhotoTile
            type={type}
            state={tiles[type]}
            onPress={onPickPhoto}
            onClearError={onClearError}
            wide
          />
        </View>
      ))}
    </View>
  );
}
