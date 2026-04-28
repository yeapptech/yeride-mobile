import { act, renderHook } from '@testing-library/react-native';

import { Coordinates } from '@domain/entities/Coordinates';
import { ServiceArea } from '@domain/entities/ServiceArea';
import { ServiceAreaId } from '@domain/entities/ServiceAreaId';
import { useServiceAreaStore } from '@presentation/stores/useServiceAreaStore';
import { useTripDraftStore } from '@presentation/stores/useTripDraftStore';

import {
  useRouteSearchViewModel,
  type PlacesAutocompletePrediction,
} from '../useRouteSearchViewModel';

// React Navigation: this view-model only uses `navigation.navigate`, so a
// minimal stub is enough — no NavigationContainer wrapping required.
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
}));

// expo-constants: mock the Maps API key surface so the view-model picks
// it up the same way it would at runtime.
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: {
      extra: {
        googleMapsApiKeyAndroid: 'TEST_ANDROID_KEY',
        googleMapsApiKeyIos: 'TEST_IOS_KEY',
      },
    },
  },
}));

function unwrap<T>(r: { ok: true; value: T } | { ok: false; error: Error }): T {
  if (!r.ok) throw r.error;
  return r.value;
}

const MIAMI_PREDICTION: PlacesAutocompletePrediction = {
  place_id: 'ChIJxyz_miami',
  description: '100 Biscayne Blvd, Miami, FL, USA',
  formatted_address: '100 Biscayne Blvd, Miami, FL 33132, USA',
  name: 'Bayfront Park',
  geometry: { location: { lat: 25.7752, lng: -80.1869 } },
};

const FORT_LAUDERDALE_PREDICTION: PlacesAutocompletePrediction = {
  place_id: 'ChIJxyz_fll',
  description: '1 Las Olas Blvd, Fort Lauderdale, FL, USA',
  formatted_address: '1 Las Olas Blvd, Fort Lauderdale, FL 33301, USA',
  // `name` intentionally omitted — exactOptionalPropertyTypes forbids
  // `name: undefined` when the property is `string` not `string | undefined`.
  geometry: { location: { lat: 26.1224, lng: -80.1373 } },
};

describe('useRouteSearchViewModel', () => {
  beforeEach(() => {
    useTripDraftStore.getState().reset();
    useServiceAreaStore.getState().reset();
    mockNavigate.mockClear();
  });

  it('starts with no pickup or dropoff and canContinue=false', () => {
    const { result } = renderHook(() => useRouteSearchViewModel());
    expect(result.current.pickup).toBeNull();
    expect(result.current.dropoff).toBeNull();
    expect(result.current.canContinue).toBe(false);
  });

  it('writes a pickup endpoint into the trip-draft store from a prediction', () => {
    const { result } = renderHook(() => useRouteSearchViewModel());

    act(() => {
      result.current.setPickupFromPrediction(
        MIAMI_PREDICTION,
        MIAMI_PREDICTION.description ?? '',
      );
    });

    const pickup = useTripDraftStore.getState().pickup;
    expect(pickup).not.toBeNull();
    expect(pickup?.placeName).toBe('Bayfront Park');
    expect(pickup?.address).toBe('100 Biscayne Blvd, Miami, FL 33132, USA');
    expect(pickup?.location.latitude).toBeCloseTo(25.7752, 4);
  });

  it('falls back to the description when formatted_address is missing', () => {
    const { result } = renderHook(() => useRouteSearchViewModel());
    const lean: PlacesAutocompletePrediction = {
      description: 'Just a description',
      geometry: { location: { lat: 1, lng: 2 } },
    };

    act(() => {
      result.current.setPickupFromPrediction(lean, lean.description ?? '');
    });

    const pickup = useTripDraftStore.getState().pickup;
    expect(pickup?.address).toBe('Just a description');
    expect(pickup?.placeName).toBeNull();
  });

  it('ignores predictions without coordinates (logs and skips)', () => {
    const { result } = renderHook(() => useRouteSearchViewModel());
    const broken: PlacesAutocompletePrediction = {
      description: 'no geometry',
    };

    act(() => {
      result.current.setPickupFromPrediction(broken, 'no geometry');
    });

    expect(useTripDraftStore.getState().pickup).toBeNull();
  });

  it('reports canContinue=true once both endpoints are set', () => {
    const { result } = renderHook(() => useRouteSearchViewModel());

    act(() => {
      result.current.setPickupFromPrediction(
        MIAMI_PREDICTION,
        MIAMI_PREDICTION.description ?? '',
      );
    });
    expect(result.current.canContinue).toBe(false);

    act(() => {
      result.current.setDropoffFromPrediction(
        FORT_LAUDERDALE_PREDICTION,
        FORT_LAUDERDALE_PREDICTION.description ?? '',
      );
    });
    expect(result.current.canContinue).toBe(true);
  });

  it('navigate to RouteSelect requires both endpoints', () => {
    const { result } = renderHook(() => useRouteSearchViewModel());

    act(() => {
      result.current.goToRouteSelect();
    });
    expect(mockNavigate).not.toHaveBeenCalled();

    act(() => {
      result.current.setPickupFromPrediction(
        MIAMI_PREDICTION,
        MIAMI_PREDICTION.description ?? '',
      );
      result.current.setDropoffFromPrediction(
        FORT_LAUDERDALE_PREDICTION,
        FORT_LAUDERDALE_PREDICTION.description ?? '',
      );
    });
    act(() => {
      result.current.goToRouteSelect();
    });
    expect(mockNavigate).toHaveBeenCalledWith('RouteSelect');
  });

  it('clears pickup / dropoff to null', () => {
    const { result } = renderHook(() => useRouteSearchViewModel());
    act(() => {
      result.current.setPickupFromPrediction(
        MIAMI_PREDICTION,
        MIAMI_PREDICTION.description ?? '',
      );
      result.current.setDropoffFromPrediction(
        FORT_LAUDERDALE_PREDICTION,
        FORT_LAUDERDALE_PREDICTION.description ?? '',
      );
    });
    expect(result.current.canContinue).toBe(true);

    act(() => {
      result.current.clearPickup();
    });
    expect(useTripDraftStore.getState().pickup).toBeNull();
    expect(useTripDraftStore.getState().dropoff).not.toBeNull();
  });

  describe('autocompleteQuery (locationbias)', () => {
    it('omits locationbias when no active service area is set', () => {
      const { result } = renderHook(() => useRouteSearchViewModel());
      expect(result.current.autocompleteQuery.locationbias).toBeUndefined();
      expect(result.current.autocompleteQuery.key.length).toBeGreaterThan(0);
    });

    it('emits a circle locationbias when an active service area is set', () => {
      const area = unwrap(
        ServiceArea.create({
          id: unwrap(ServiceAreaId.create('miami')),
          identifier: 'miami',
          center: unwrap(Coordinates.create(25.7617, -80.1918)),
          radiusMeters: 25_000,
          notifyOnEntry: true,
          notifyOnDwell: false,
          notifyOnExit: true,
        }),
      );
      useServiceAreaStore.getState().setReady([area]);
      useServiceAreaStore.getState().setActiveArea(area.id);

      const { result } = renderHook(() => useRouteSearchViewModel());
      expect(result.current.autocompleteQuery.locationbias).toBe(
        'circle:25000@25.7617,-80.1918',
      );
    });
  });

  describe('isApiKeyMissing', () => {
    it('reports false when keys are configured', () => {
      const { result } = renderHook(() => useRouteSearchViewModel());
      expect(result.current.isApiKeyMissing).toBe(false);
    });
  });
});
