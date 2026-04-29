import { ActivityIndicator, Image, Pressable, Text, View } from 'react-native';

import type { VehiclePhotoType } from '@domain/entities/VehiclePhotoType';

import type { VehiclePhotoTileState } from '../view-models/useVehiclePhotosViewModel';

const LABEL_BY_TYPE: Readonly<Record<VehiclePhotoType, string>> = {
  front: 'Front',
  back: 'Back',
  left: 'Left side',
  right: 'Right side',
  interior: 'Interior',
};

interface VehiclePhotoTileProps {
  readonly type: VehiclePhotoType;
  readonly state: VehiclePhotoTileState;
  /** Tapped → launch the picker. Disabled while `uploading`. */
  readonly onPress: (type: VehiclePhotoType) => void;
  /** Dismiss the per-tile error so the tile re-enables for re-pick. */
  readonly onClearError: (type: VehiclePhotoType) => void;
  /** Optional flag to make the tile span two columns (used for `interior`). */
  readonly wide?: boolean;
}

/**
 * A single vehicle-photo tile. Renders one of four visual states keyed
 * on the `state.kind` discriminant:
 *
 *   idle      — dashed border, camera glyph, "Tap to upload" hint
 *   uploading — same as idle but with a centered ActivityIndicator overlay
 *               and the press disabled
 *   attached  — the uploaded image as the tile background, with a small
 *               checkmark and the type label across the bottom
 *   error     — red-tinted border, small error glyph + "Tap to retry"
 *               alongside a "Dismiss" button that clears the error
 *
 * Tap target sizing follows the legacy 5-tile grid: square tiles for
 * front/back/left/right, a wider rectangle for interior. The `wide` prop
 * is set by the parent grid; the tile itself doesn't decide layout.
 */
export function VehiclePhotoTile({
  type,
  state,
  onPress,
  onClearError,
  wide = false,
}: VehiclePhotoTileProps) {
  const label = LABEL_BY_TYPE[type];
  const isUploading = state.kind === 'uploading';
  const isError = state.kind === 'error';
  const url = state.kind === 'attached' ? state.url : null;

  const baseHeight = wide ? 'h-32' : 'h-32';
  const baseWidth = wide ? 'flex-1' : 'flex-1';
  const borderClass = isError
    ? 'border-2 border-error'
    : 'border-2 border-dashed border-border';

  return (
    <View className={`${baseWidth} mb-3 mx-1`}>
      <Pressable
        onPress={() => onPress(type)}
        disabled={isUploading}
        accessibilityRole="button"
        accessibilityLabel={`Upload ${label} photo`}
        accessibilityState={{ disabled: isUploading, busy: isUploading }}
        testID={`vehicle-photo-tile-${type}`}
        className={`overflow-hidden rounded-xl bg-muted ${baseHeight} ${borderClass} ${
          isUploading ? 'opacity-60' : ''
        }`}
      >
        {url !== null && (
          <Image
            source={{ uri: url }}
            className="h-full w-full"
            resizeMode="cover"
          />
        )}
        {url === null && !isError && (
          <View className="h-full w-full items-center justify-center">
            <Text className="text-3xl text-muted-foreground">📷</Text>
            <Text className="mt-1 text-xs text-muted-foreground">
              Tap to upload
            </Text>
          </View>
        )}
        {isError && (
          <View className="h-full w-full items-center justify-center px-2">
            <Text className="text-xl text-error">!</Text>
            <Text
              className="mt-1 text-center text-xs text-error"
              numberOfLines={2}
            >
              Upload failed
            </Text>
            <Text className="mt-0.5 text-[10px] text-muted-foreground">
              Tap to retry
            </Text>
          </View>
        )}
        {isUploading && (
          <View className="absolute inset-0 items-center justify-center bg-black/30">
            <ActivityIndicator size="small" color="#fff" />
          </View>
        )}
      </Pressable>

      <View className="mt-1 flex-row items-center justify-between px-1">
        <Text className="text-xs font-medium text-foreground">{label}</Text>
        {state.kind === 'attached' && (
          <Text className="text-xs text-success">✓</Text>
        )}
        {isError && (
          <Pressable
            onPress={() => onClearError(type)}
            accessibilityRole="button"
            accessibilityLabel={`Dismiss ${label} error`}
            testID={`vehicle-photo-tile-${type}-clear-error`}
            hitSlop={8}
          >
            <Text className="text-xs text-muted-foreground underline">
              Dismiss
            </Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}
