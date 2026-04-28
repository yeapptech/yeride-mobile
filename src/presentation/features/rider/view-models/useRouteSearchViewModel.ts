import { useNavigation } from '@react-navigation/native';
import Constants from 'expo-constants';
import { useCallback, useMemo } from 'react';
import { Platform } from 'react-native';

import { Coordinates } from '@domain/entities/Coordinates';
import { Endpoint } from '@domain/entities/Endpoint';
import type { MainStackNavigation } from '@presentation/navigation/types';
import {
  useActiveServiceArea,
  useTripDraftDropoff,
  useTripDraftPickup,
  useTripDraftStore,
} from '@presentation/stores';
import { LOG } from '@shared/logger';

const logger = LOG.extend('RouteSearchVM');

/**
 * View-model for `RouteSearchScreen`. Owns the pickup + dropoff selection
 * state (delegating storage to `useTripDraftStore`) and computes the
 * `locationBias` payload for `react-native-google-places-autocomplete`.
 *
 * Architecture note:
 *   `react-native-google-places-autocomplete` calls Google Places directly
 *   via its own fetch — it bypasses our domain/data architecture. We
 *   accept that for turn 3.2 because lifting to a custom autocomplete UI
 *   over our own service would be significant scope. The view-model is
 *   the architecture seam: callbacks come in as raw place data, get
 *   normalized through `Endpoint.create`, and land in the trip-draft
 *   store as proper value objects.
 *
 *   When Phase 6 wants a different autocomplete UX (e.g. our own typed
 *   suggestion list backed by a `GooglePlacesService` interface), this
 *   view-model is where that swap happens — the screen below renders
 *   stable inputs.
 */

export interface PlacesAutocompletePrediction {
  /**
   * Shape conforms to the relevant subset of Google Places Autocomplete's
   * `Place` response (when `fetchDetails: true` is set on the underlying
   * widget). Listed inline so this view-model doesn't take a runtime
   * dependency on `react-native-google-places-autocomplete`'s types.
   */
  readonly place_id?: string;
  readonly description?: string;
  readonly formatted_address?: string;
  readonly name?: string;
  readonly geometry?: {
    readonly location?: {
      readonly lat?: number;
      readonly lng?: number;
    };
  };
}

export interface UseRouteSearchViewModel {
  readonly pickup: Endpoint | null;
  readonly dropoff: Endpoint | null;
  readonly canContinue: boolean;
  /** Bounded autocomplete query string, ready to spread on the widget. */
  readonly autocompleteQuery: {
    readonly key: string;
    readonly language: string;
    readonly locationbias?: string;
  };
  /** True when the API key isn't configured — the screen shows a banner. */
  readonly isApiKeyMissing: boolean;
  setPickupFromPrediction: (
    prediction: PlacesAutocompletePrediction,
    description: string,
  ) => void;
  setDropoffFromPrediction: (
    prediction: PlacesAutocompletePrediction,
    description: string,
  ) => void;
  clearPickup: () => void;
  clearDropoff: () => void;
  goToRouteSelect: () => void;
}

export function useRouteSearchViewModel(): UseRouteSearchViewModel {
  const pickup = useTripDraftPickup();
  const dropoff = useTripDraftDropoff();
  const setPickup = useTripDraftStore((s) => s.setPickup);
  const setDropoff = useTripDraftStore((s) => s.setDropoff);
  const activeArea = useActiveServiceArea();
  const navigation = useNavigation<MainStackNavigation>();

  const apiKey = useMemo(() => getMapsApiKey(), []);
  const isApiKeyMissing = apiKey.length === 0;

  const autocompleteQuery = useMemo(() => {
    // Bias autocomplete to the active service area's centre when we have
    // one. Format: `circle:radius@lat,lng` per Google's documented param.
    const base = { key: apiKey, language: 'en' as const };
    if (!activeArea) return base;
    const { center, radiusMeters } = activeArea;
    return {
      ...base,
      locationbias: `circle:${String(Math.round(radiusMeters))}@${String(center.latitude)},${String(center.longitude)}`,
    };
  }, [apiKey, activeArea]);

  const setPickupFromPrediction = useCallback(
    (prediction: PlacesAutocompletePrediction, description: string) => {
      const endpoint = predictionToEndpoint(prediction, description);
      if (!endpoint) {
        logger.warn('setPickupFromPrediction: invalid prediction', prediction);
        return;
      }
      setPickup(endpoint);
    },
    [setPickup],
  );

  const setDropoffFromPrediction = useCallback(
    (prediction: PlacesAutocompletePrediction, description: string) => {
      const endpoint = predictionToEndpoint(prediction, description);
      if (!endpoint) {
        logger.warn('setDropoffFromPrediction: invalid prediction', prediction);
        return;
      }
      setDropoff(endpoint);
    },
    [setDropoff],
  );

  const clearPickup = useCallback(() => setPickup(null), [setPickup]);
  const clearDropoff = useCallback(() => setDropoff(null), [setDropoff]);

  const canContinue = pickup !== null && dropoff !== null;

  const goToRouteSelect = useCallback(() => {
    if (!canContinue) {
      logger.debug('goToRouteSelect blocked: pickup/dropoff not both set');
      return;
    }
    navigation.navigate('RouteSelect');
  }, [canContinue, navigation]);

  return {
    pickup,
    dropoff,
    canContinue,
    autocompleteQuery,
    isApiKeyMissing,
    setPickupFromPrediction,
    setDropoffFromPrediction,
    clearPickup,
    clearDropoff,
    goToRouteSelect,
  };
}

/**
 * Normalize a Google Places prediction (with `fetchDetails: true`) into
 * a domain `Endpoint`. Returns `null` when the prediction is missing the
 * coordinates or address that the entity requires — the caller logs and
 * ignores rather than crashing.
 */
function predictionToEndpoint(
  prediction: PlacesAutocompletePrediction,
  description: string,
): Endpoint | null {
  const lat = prediction.geometry?.location?.lat;
  const lng = prediction.geometry?.location?.lng;
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;

  const coordsR = Coordinates.create(lat, lng);
  if (!coordsR.ok) return null;

  // Prefer `formatted_address`, fall back to the autocomplete description.
  const address = prediction.formatted_address ?? description;
  if (!address || address.trim().length === 0) return null;

  // `name` is the human-readable place label ("Miami International Airport")
  // which differs from the formatted address ("2100 NW 42nd Ave, Miami").
  const placeName = prediction.name ?? null;

  const r = Endpoint.create({
    location: coordsR.value,
    address: address.trim(),
    placeName,
    directions: null,
  });
  return r.ok ? r.value : null;
}

/**
 * Read the platform-appropriate Google Maps API key from
 * `Constants.expoConfig.extra` (set by `app.config.ts`). Falls back to
 * empty string so the UI can render a "key missing" banner instead of
 * crashing.
 */
function getMapsApiKey(): string {
  const extra = (Constants.expoConfig?.extra ?? {}) as {
    googleMapsApiKeyAndroid?: string | null;
    googleMapsApiKeyIos?: string | null;
  };
  const key =
    Platform.OS === 'ios'
      ? extra.googleMapsApiKeyIos
      : extra.googleMapsApiKeyAndroid;
  return key ?? '';
}
