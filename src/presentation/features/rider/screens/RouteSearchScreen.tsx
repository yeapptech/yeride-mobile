import { Pressable, ScrollView, Text, View } from 'react-native';
import { GooglePlacesAutocomplete } from 'react-native-google-places-autocomplete';
import type {
  GooglePlaceData,
  GooglePlaceDetail,
} from 'react-native-google-places-autocomplete';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  useRouteSearchViewModel,
  type PlacesAutocompletePrediction,
} from '../view-models/useRouteSearchViewModel';

/**
 * RouteSearchScreen — pickup + dropoff entry. Two stacked
 * `GooglePlacesAutocomplete` widgets, each calling its own onPress
 * handler. Continue button is enabled when both endpoints are set.
 *
 * Stacked-autocomplete UX caveats:
 *   - Each widget gets its own internal scroll/list. With two stacked
 *     autocompletes inside a parent ScrollView we set `disableScroll`
 *     on each so the parent owns vertical scrolling and the widgets
 *     just inline their suggestions.
 *   - `keyboardShouldPersistTaps="handled"` on the parent so tapping a
 *     suggestion doesn't dismiss the keyboard and lose the tap.
 *
 * `react-native-google-places-autocomplete` 2.6.4 was pinned in legacy
 * yeride to fix the React 19 `defaultProps` crash; we carry the pin
 * forward (see PHASE_3_TURN_1.md). If the autocomplete throws "Cannot
 * read property 'isCurrentLocationEnabled' of undefined" at boot, that
 * pin has slipped.
 */
export default function RouteSearchScreen() {
  const vm = useRouteSearchViewModel();

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      <View className="px-4 pt-2 pb-3">
        <Text className="text-xl font-semibold text-foreground">Where to?</Text>
        <Text className="text-sm text-muted-foreground">
          Set your pickup and dropoff to see fare options.
        </Text>
      </View>

      {vm.isApiKeyMissing && (
        <View className="mx-4 mb-3 rounded-lg bg-warning/10 p-3">
          <Text className="text-sm text-warning">
            Maps API key is not configured. Address search is disabled in this
            build. Set GOOGLE_MAPS_APIKEY_IOS / GOOGLE_MAPS_APIKEY_ANDROID and
            rebuild.
          </Text>
        </View>
      )}

      <ScrollView
        className="flex-1"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: 24 }}
      >
        <View className="px-4">
          <Text className="mb-1 text-xs uppercase text-muted-foreground">
            Pickup
          </Text>
          <GooglePlacesAutocomplete
            placeholder="Pickup location"
            fetchDetails
            disableScroll
            enablePoweredByContainer={false}
            onPress={(data, details) =>
              handlePickupPress(data, details, vm.setPickupFromPrediction)
            }
            query={vm.autocompleteQuery}
            textInputProps={{
              testID: 'pickup-input',
              placeholderTextColor: '#9ca3af',
              defaultValue: vm.pickup?.placeName ?? vm.pickup?.address ?? '',
            }}
            styles={autocompleteStyles}
            listEmptyComponent={renderEmptyAutocomplete}
          />
        </View>

        <View className="px-4 pt-3">
          <Text className="mb-1 text-xs uppercase text-muted-foreground">
            Dropoff
          </Text>
          <GooglePlacesAutocomplete
            placeholder="Dropoff location"
            fetchDetails
            disableScroll
            enablePoweredByContainer={false}
            onPress={(data, details) =>
              handleDropoffPress(data, details, vm.setDropoffFromPrediction)
            }
            query={vm.autocompleteQuery}
            textInputProps={{
              testID: 'dropoff-input',
              placeholderTextColor: '#9ca3af',
              defaultValue: vm.dropoff?.placeName ?? vm.dropoff?.address ?? '',
            }}
            styles={autocompleteStyles}
            listEmptyComponent={renderEmptyAutocomplete}
          />
        </View>
      </ScrollView>

      <View className="border-t border-border px-4 py-3">
        <Pressable
          onPress={vm.goToRouteSelect}
          disabled={!vm.canContinue}
          accessibilityRole="button"
          accessibilityState={{ disabled: !vm.canContinue }}
          className={`items-center rounded-xl px-4 py-3 ${
            vm.canContinue ? 'bg-primary' : 'bg-muted'
          }`}
          testID="route-search-continue"
        >
          <Text
            className={`text-base font-semibold ${
              vm.canContinue
                ? 'text-primary-foreground'
                : 'text-muted-foreground'
            }`}
          >
            Continue
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

/**
 * Adapter between `react-native-google-places-autocomplete`'s
 * `(data, details)` callback shape and the view-model's
 * `(prediction, description)` API. The widget's `data` carries
 * `description`; `details` carries `geometry`. Both are optional in the
 * widget's typing, so we narrow defensively.
 */
function handlePickupPress(
  data: GooglePlaceData,
  details: GooglePlaceDetail | null,
  set: (prediction: PlacesAutocompletePrediction, description: string) => void,
): void {
  if (!details) return;
  set(adaptPrediction(data, details), data.description);
}

function handleDropoffPress(
  data: GooglePlaceData,
  details: GooglePlaceDetail | null,
  set: (prediction: PlacesAutocompletePrediction, description: string) => void,
): void {
  if (!details) return;
  set(adaptPrediction(data, details), data.description);
}

function adaptPrediction(
  data: GooglePlaceData,
  details: GooglePlaceDetail,
): PlacesAutocompletePrediction {
  // exactOptionalPropertyTypes: don't set `geometry` at all when the
  // widget didn't return one. Conditional spreads keep optional fields
  // strictly absent rather than `undefined`.
  return {
    place_id: data.place_id,
    description: data.description,
    formatted_address: details.formatted_address,
    ...(details.name ? { name: details.name } : {}),
    ...(details.geometry
      ? {
          geometry: {
            location: {
              lat: details.geometry.location.lat,
              lng: details.geometry.location.lng,
            },
          },
        }
      : {}),
  };
}

function renderEmptyAutocomplete() {
  return (
    <View className="px-3 py-2">
      <Text className="text-xs text-muted-foreground">
        No matches yet — keep typing.
      </Text>
    </View>
  );
}

/**
 * Minimal style overrides for the autocomplete widget. The widget's
 * default styles use platform fonts and colours that clash with our
 * design tokens; we map the most visible fields. Tailwind classes don't
 * reach into the widget, so this is plain RN style.
 */
const autocompleteStyles = {
  textInputContainer: {
    backgroundColor: 'transparent',
  },
  textInput: {
    height: 44,
    fontSize: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e5e5e5', // --border
    paddingHorizontal: 12,
    backgroundColor: 'white',
  },
  listView: {
    backgroundColor: 'white',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e5e5e5',
    marginTop: 4,
    maxHeight: 240,
  },
  row: {
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  description: {
    fontSize: 14,
  },
};
