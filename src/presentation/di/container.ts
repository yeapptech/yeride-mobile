import { AddSavedPlace } from '@app/usecases/auth/AddSavedPlace';
import { ChangeEmail } from '@app/usecases/auth/ChangeEmail';
import { CheckEmailVerified } from '@app/usecases/auth/CheckEmailVerified';
import { GetCurrentUser } from '@app/usecases/auth/GetCurrentUser';
import { LogInUser } from '@app/usecases/auth/LogInUser';
import { LogOutUser } from '@app/usecases/auth/LogOutUser';
import { ObserveAuthState } from '@app/usecases/auth/ObserveAuthState';
import { RegisterUser } from '@app/usecases/auth/RegisterUser';
import { RemoveSavedPlace } from '@app/usecases/auth/RemoveSavedPlace';
import { ResetPassword } from '@app/usecases/auth/ResetPassword';
import { SendEmailVerification } from '@app/usecases/auth/SendEmailVerification';
import { UpdateProfile } from '@app/usecases/auth/UpdateProfile';
import { UpdateSavedPlace } from '@app/usecases/auth/UpdateSavedPlace';
import { UploadAvatar } from '@app/usecases/auth/UploadAvatar';
import { SubscribeToUserLocation } from '@app/usecases/location/SubscribeToUserLocation';
import { UpdateUserLocation } from '@app/usecases/location/UpdateUserLocation';
import { CancelRideByDriver } from '@app/usecases/ride/CancelRideByDriver';
import { CancelRideByRider } from '@app/usecases/ride/CancelRideByRider';
import { CreateRide } from '@app/usecases/ride/CreateRide';
import { DispatchRide } from '@app/usecases/ride/DispatchRide';
import { ListAvailableRides } from '@app/usecases/ride/ListAvailableRides';
import { ObserveRide } from '@app/usecases/ride/ObserveRide';
import { RequestPayment } from '@app/usecases/ride/RequestPayment';
import { StartRide } from '@app/usecases/ride/StartRide';
import { ComputeRoutes } from '@app/usecases/route/ComputeRoutes';
import { ListRideServices } from '@app/usecases/serviceArea/ListRideServices';
import { ListServiceAreas } from '@app/usecases/serviceArea/ListServiceAreas';
import { ResolveActiveServiceArea } from '@app/usecases/serviceArea/ResolveActiveServiceArea';
import { GreetUser } from '@app/usecases/shared/GreetUser';
import type { FirebaseAuthRepository as FirebaseAuthRepositoryType } from '@data/repositories/FirebaseAuthRepository';
import type { FirestoreLocationRepository as FirestoreLocationRepositoryType } from '@data/repositories/FirestoreLocationRepository';
import type { FirestoreRideRepository as FirestoreRideRepositoryType } from '@data/repositories/FirestoreRideRepository';
import type { FirestoreServiceAreaRepository as FirestoreServiceAreaRepositoryType } from '@data/repositories/FirestoreServiceAreaRepository';
import type { FirestoreUserRepository as FirestoreUserRepositoryType } from '@data/repositories/FirestoreUserRepository';
import type { GoogleRoutesService as GoogleRoutesServiceType } from '@data/services/GoogleRoutesService';
import type {
  AuthRepository,
  LocationRepository,
  RideRepository,
  ServiceAreaRepository,
  UserRepository,
} from '@domain/repositories';
import type { RoutesService } from '@domain/services';
import { getGoogleMapsApiKey } from '@shared/env';
import { LOG } from '@shared/logger';
import type {
  FakeRoutesService as FakeRoutesServiceType,
  InMemoryAuthRepository as InMemoryAuthRepositoryType,
  InMemoryLocationRepository as InMemoryLocationRepositoryType,
  InMemoryRideRepository as InMemoryRideRepositoryType,
  InMemoryServiceAreaRepository as InMemoryServiceAreaRepositoryType,
  InMemoryUserRepository as InMemoryUserRepositoryType,
} from '@shared/testing';

/**
 * The dependency-injection container. Constructed once at app start and
 * passed down through `<ContainerProvider/>`.
 *
 * Naming convention: every use case the presentation layer needs is exposed
 * under `useCases`. Repository implementations are *not* exposed — only the
 * use cases that wrap them.
 *
 * `buildContainer()` decides which adapter pair to wire based on whether
 * Firebase config files are available at build time:
 *
 *   - Firebase configured → real `FirebaseAuthRepository` +
 *     `FirestoreUserRepository`. App boots against the legacy yeride
 *     dev/stage backend (per REFACTOR_PLAN.md §7 Decision 6).
 *
 *   - Firebase not configured (no `GoogleService-Info.plist` /
 *     `google-services.json` in `firebase/config/<env>/`) → falls back to
 *     in-memory fakes from `@shared/testing`. Auth use cases work but
 *     nothing persists. A `LOG.warn` fires at boot to make this loud.
 *
 * The check uses the `extra.firebaseConfigured` flag set by `app.config.ts`
 * based on file presence at config-evaluation time.
 *
 * Note on the iOS build: `@react-native-firebase` 24.x's Obj-C wrappers
 * `#import <React/...>` headers, which Clang rejects under
 * `useFrameworks: 'static'` unless `use_modular_headers!` is in the
 * Podfile. We inject that via the custom `plugins/withFirebasePodfileFix.ts`
 * config plugin.
 */

export interface UseCases {
  // Phase 0 smoke artifact — kept dormant until next major version cleanup
  // (the runtime nav no longer reaches HelloYeRideScreen).
  greetUser: GreetUser;

  // Auth + identity
  registerUser: RegisterUser;
  logInUser: LogInUser;
  logOutUser: LogOutUser;
  observeAuthState: ObserveAuthState;
  getCurrentUser: GetCurrentUser;
  sendEmailVerification: SendEmailVerification;
  checkEmailVerified: CheckEmailVerified;
  resetPassword: ResetPassword;
  changeEmail: ChangeEmail;
  updateProfile: UpdateProfile;
  uploadAvatar: UploadAvatar;
  addSavedPlace: AddSavedPlace;
  updateSavedPlace: UpdateSavedPlace;
  removeSavedPlace: RemoveSavedPlace;

  // Service-area catalog (Phase 2 turn 1)
  listServiceAreas: ListServiceAreas;
  resolveActiveServiceArea: ResolveActiveServiceArea;
  listRideServices: ListRideServices;

  // Google Routes API (Phase 2 turn 2)
  computeRoutes: ComputeRoutes;

  // Ride lifecycle (Phase 2 turn 3)
  createRide: CreateRide;
  observeRide: ObserveRide;
  listAvailableRides: ListAvailableRides;
  dispatchRide: DispatchRide;
  startRide: StartRide;
  requestPayment: RequestPayment;
  cancelRideByRider: CancelRideByRider;
  cancelRideByDriver: CancelRideByDriver;

  // Location pipeline (Phase 2 turn 3c)
  updateUserLocation: UpdateUserLocation;
  subscribeToUserLocation: SubscribeToUserLocation;
}

export interface Container {
  useCases: UseCases;
}

/**
 * Compose use cases over a given pair of repositories. Used by both the
 * production container (real Firebase) and tests (in-memory fakes).
 */
export function makeUseCases(args: {
  auth: AuthRepository;
  users: UserRepository;
  serviceAreas: ServiceAreaRepository;
  rides: RideRepository;
  locations: LocationRepository;
  routes: RoutesService;
  clock?: () => Date;
}): UseCases {
  const clock = args.clock ?? (() => new Date());
  return {
    greetUser: new GreetUser(),
    registerUser: new RegisterUser(args.auth, args.users, clock),
    logInUser: new LogInUser(args.auth),
    logOutUser: new LogOutUser(args.auth),
    observeAuthState: new ObserveAuthState(args.auth),
    getCurrentUser: new GetCurrentUser(args.auth, args.users),
    sendEmailVerification: new SendEmailVerification(args.auth),
    checkEmailVerified: new CheckEmailVerified(args.auth, args.users, clock),
    resetPassword: new ResetPassword(args.auth),
    changeEmail: new ChangeEmail(args.auth, args.users, clock),
    updateProfile: new UpdateProfile(args.auth, args.users, clock),
    uploadAvatar: new UploadAvatar(args.auth, args.users, clock),
    addSavedPlace: new AddSavedPlace(args.auth, args.users),
    updateSavedPlace: new UpdateSavedPlace(args.auth, args.users),
    removeSavedPlace: new RemoveSavedPlace(args.auth, args.users),
    listServiceAreas: new ListServiceAreas(args.serviceAreas),
    resolveActiveServiceArea: new ResolveActiveServiceArea(args.serviceAreas),
    listRideServices: new ListRideServices(args.serviceAreas),
    computeRoutes: new ComputeRoutes(args.routes),
    createRide: new CreateRide(args.rides),
    observeRide: new ObserveRide(args.rides),
    listAvailableRides: new ListAvailableRides(args.rides),
    dispatchRide: new DispatchRide(args.rides, clock),
    startRide: new StartRide(args.rides, clock),
    requestPayment: new RequestPayment(args.rides),
    cancelRideByRider: new CancelRideByRider(args.rides),
    cancelRideByDriver: new CancelRideByDriver(args.rides),
    updateUserLocation: new UpdateUserLocation(args.locations),
    subscribeToUserLocation: new SubscribeToUserLocation(args.locations),
  };
}

/**
 * Build the runtime container.
 *
 * Decides between real Firebase adapters and in-memory fakes based on the
 * `extra.firebaseConfigured` flag from `app.config.ts`. Imports are lazy
 * (inside the branch) so that:
 *   - Without Firebase config files, the @react-native-firebase modules are
 *     never `require()`d, avoiding native init crashes.
 *   - The test environment doesn't try to load native modules at all.
 */
export function buildContainer(): Container {
  // Routes service is configured independently of Firebase: a build can have
  // either / both / neither. Resolve once and pass into makeUseCases.
  const routes = buildRoutesService();

  if (isFirebaseConfigured()) {
    const dataAuth = require('@data/repositories/FirebaseAuthRepository') as {
      FirebaseAuthRepository: new () => FirebaseAuthRepositoryType;
    };
    const dataUsers = require('@data/repositories/FirestoreUserRepository') as {
      FirestoreUserRepository: new () => FirestoreUserRepositoryType;
    };
    const dataServiceAreas =
      require('@data/repositories/FirestoreServiceAreaRepository') as {
        FirestoreServiceAreaRepository: new () => FirestoreServiceAreaRepositoryType;
      };
    const dataRides = require('@data/repositories/FirestoreRideRepository') as {
      FirestoreRideRepository: new () => FirestoreRideRepositoryType;
    };
    const dataLocations =
      require('@data/repositories/FirestoreLocationRepository') as {
        FirestoreLocationRepository: new () => FirestoreLocationRepositoryType;
      };
    LOG.info(
      'Container using Firebase{Auth,Firestore} + FirestoreServiceArea + FirestoreRide + FirestoreLocation repositories',
    );
    return {
      useCases: makeUseCases({
        auth: new dataAuth.FirebaseAuthRepository(),
        users: new dataUsers.FirestoreUserRepository(),
        serviceAreas: new dataServiceAreas.FirestoreServiceAreaRepository(),
        rides: new dataRides.FirestoreRideRepository(),
        locations: new dataLocations.FirestoreLocationRepository(),
        routes,
      }),
    };
  }

  const testing = require('@shared/testing') as {
    InMemoryAuthRepository: new () => InMemoryAuthRepositoryType;
    InMemoryLocationRepository: new () => InMemoryLocationRepositoryType;
    InMemoryRideRepository: new () => InMemoryRideRepositoryType;
    InMemoryServiceAreaRepository: new () => InMemoryServiceAreaRepositoryType;
    InMemoryUserRepository: new () => InMemoryUserRepositoryType;
  };
  LOG.warn(
    'Firebase config not detected — using in-memory fakes for auth/user/service-areas/rides/locations. ' +
      'No data will persist. See docs/FIREBASE_SETUP.md.',
  );
  return {
    useCases: makeUseCases({
      auth: new testing.InMemoryAuthRepository(),
      users: new testing.InMemoryUserRepository(),
      serviceAreas: new testing.InMemoryServiceAreaRepository(),
      rides: new testing.InMemoryRideRepository(),
      locations: new testing.InMemoryLocationRepository(),
      routes,
    }),
  };
}

/**
 * Pick the right RoutesService for the build:
 *   - GoogleMapsApiKey present → real GoogleRoutesService
 *   - absent                   → FakeRoutesService (development convenience)
 *
 * Lazy-required from the appropriate side so the bundle never pulls
 * GoogleRoutesService into a fakes-only build, and never pulls
 * FakeRoutesService into a real build.
 */
function buildRoutesService(): RoutesService {
  const apiKey = getGoogleMapsApiKey();
  if (apiKey !== null) {
    const dataRoutes = require('@data/services/GoogleRoutesService') as {
      GoogleRoutesService: new (apiKey: string) => GoogleRoutesServiceType;
    };
    LOG.info('Container using GoogleRoutesService');
    return new dataRoutes.GoogleRoutesService(apiKey);
  }
  const testing = require('@shared/testing') as {
    FakeRoutesService: new () => FakeRoutesServiceType;
  };
  LOG.warn(
    'Google Maps API key not configured — using FakeRoutesService. ' +
      'Set GOOGLE_MAPS_APIKEY_ANDROID / GOOGLE_MAPS_APIKEY_IOS to enable real routes.',
  );
  return new testing.FakeRoutesService();
}

function isFirebaseConfigured(): boolean {
  const Constants = require('expo-constants') as {
    default?: { expoConfig?: { extra?: Record<string, unknown> } };
  };
  const flag = Constants.default?.expoConfig?.extra?.['firebaseConfigured'];
  return flag === true;
}
