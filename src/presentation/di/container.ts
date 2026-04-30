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
import { CreateAccountLoginLink } from '@app/usecases/payment/CreateAccountLoginLink';
import { CreateConnectOnboardingLink } from '@app/usecases/payment/CreateConnectOnboardingLink';
import { CreateSetupIntent } from '@app/usecases/payment/CreateSetupIntent';
import { DetachPaymentMethod } from '@app/usecases/payment/DetachPaymentMethod';
import { EnsureStripeConnectAccount } from '@app/usecases/payment/EnsureStripeConnectAccount';
import { EnsureStripeCustomer } from '@app/usecases/payment/EnsureStripeCustomer';
import { GetDriverBalance } from '@app/usecases/payment/GetDriverBalance';
import { ListBalanceTransactions } from '@app/usecases/payment/ListBalanceTransactions';
import { ListDriverPayouts } from '@app/usecases/payment/ListDriverPayouts';
import { ListPaymentMethods } from '@app/usecases/payment/ListPaymentMethods';
import { ProcessTip } from '@app/usecases/payment/ProcessTip';
import { RefreshConnectAccountStatus } from '@app/usecases/payment/RefreshConnectAccountStatus';
import { SetDefaultPaymentMethod } from '@app/usecases/payment/SetDefaultPaymentMethod';
import { CancelRideByDriver } from '@app/usecases/ride/CancelRideByDriver';
import { CancelRideByRider } from '@app/usecases/ride/CancelRideByRider';
import { CreateRide } from '@app/usecases/ride/CreateRide';
import { DispatchRide } from '@app/usecases/ride/DispatchRide';
import { GetRideById } from '@app/usecases/ride/GetRideById';
import { ListAvailableRides } from '@app/usecases/ride/ListAvailableRides';
import { ListRidesByDriver } from '@app/usecases/ride/ListRidesByDriver';
import { ListRidesByPassenger } from '@app/usecases/ride/ListRidesByPassenger';
import { ObserveLatestMessage } from '@app/usecases/ride/ObserveLatestMessage';
import { ObserveRide } from '@app/usecases/ride/ObserveRide';
import { ObserveTripEvents } from '@app/usecases/ride/ObserveTripEvents';
import { ObserveTripPayments } from '@app/usecases/ride/ObserveTripPayments';
import { RequestPayment } from '@app/usecases/ride/RequestPayment';
import { StartRide } from '@app/usecases/ride/StartRide';
import { ComputeRoutes } from '@app/usecases/route/ComputeRoutes';
import { EstimateFare } from '@app/usecases/route/EstimateFare';
import { ListRideServices } from '@app/usecases/serviceArea/ListRideServices';
import { ListServiceAreas } from '@app/usecases/serviceArea/ListServiceAreas';
import { ResolveActiveServiceArea } from '@app/usecases/serviceArea/ResolveActiveServiceArea';
import { EvaluateExitWarning } from '@app/usecases/trip-tracking/EvaluateExitWarning';
import { ApproveVehicle } from '@app/usecases/vehicle/ApproveVehicle';
import { DecodeVin } from '@app/usecases/vehicle/DecodeVin';
import { DeleteVehicle } from '@app/usecases/vehicle/DeleteVehicle';
import { GetVehicle } from '@app/usecases/vehicle/GetVehicle';
import { ListDriverVehicles } from '@app/usecases/vehicle/ListDriverVehicles';
import { RegisterVehicle } from '@app/usecases/vehicle/RegisterVehicle';
import { RejectVehicle } from '@app/usecases/vehicle/RejectVehicle';
import { SetActiveVehicle } from '@app/usecases/vehicle/SetActiveVehicle';
import { UploadVehiclePhotos } from '@app/usecases/vehicle/UploadVehiclePhotos';
import type { FirebaseAuthRepository as FirebaseAuthRepositoryType } from '@data/repositories/FirebaseAuthRepository';
import type { FirebaseStorageVehiclePhotoRepository as FirebaseStorageVehiclePhotoRepositoryType } from '@data/repositories/FirebaseStorageVehiclePhotoRepository';
import type { FirestoreLocationRepository as FirestoreLocationRepositoryType } from '@data/repositories/FirestoreLocationRepository';
import type { FirestoreRideRepository as FirestoreRideRepositoryType } from '@data/repositories/FirestoreRideRepository';
import type { FirestoreServiceAreaRepository as FirestoreServiceAreaRepositoryType } from '@data/repositories/FirestoreServiceAreaRepository';
import type { FirestoreUserRepository as FirestoreUserRepositoryType } from '@data/repositories/FirestoreUserRepository';
import type { FirestoreVehicleRepository as FirestoreVehicleRepositoryType } from '@data/repositories/FirestoreVehicleRepository';
import type { BackgroundGeolocationClient as BackgroundGeolocationClientType } from '@data/services/BackgroundGeolocationClient';
import type { CloudFunctionsService as CloudFunctionsServiceType } from '@data/services/CloudFunctionsService';
import type { GoogleRoutesService as GoogleRoutesServiceType } from '@data/services/GoogleRoutesService';
import type { NhtsaVinDecoderService as NhtsaVinDecoderServiceType } from '@data/services/NhtsaVinDecoderService';
import type { StripeServerHttpAdapter as StripeServerHttpAdapterType } from '@data/services/StripeServerHttpAdapter';
import type {
  AuthRepository,
  LocationRepository,
  RideRepository,
  ServiceAreaRepository,
  UserRepository,
  VehicleRepository,
  VehicleStorageRepository,
} from '@domain/repositories';
import type {
  PaymentCallableService,
  RoutesService,
  StripeServerService,
  VinDecoderService,
} from '@domain/services';
import { getGoogleMapsApiKey, getStripeServerConfig } from '@shared/env';
import { LOG } from '@shared/logger';
import type {
  FakeBackgroundGeolocationClient as FakeBackgroundGeolocationClientType,
  FakeCloudFunctionsService as FakeCloudFunctionsServiceType,
  FakeRoutesService as FakeRoutesServiceType,
  FakeStripeServerService as FakeStripeServerServiceType,
  InMemoryAuthRepository as InMemoryAuthRepositoryType,
  InMemoryLocationRepository as InMemoryLocationRepositoryType,
  InMemoryRideRepository as InMemoryRideRepositoryType,
  InMemoryServiceAreaRepository as InMemoryServiceAreaRepositoryType,
  InMemoryUserRepository as InMemoryUserRepositoryType,
  InMemoryVehiclePhotoRepository as InMemoryVehiclePhotoRepositoryType,
  InMemoryVehicleRepository as InMemoryVehicleRepositoryType,
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

  // Pre-trip fare estimate (Phase 3 turn 2)
  estimateFare: EstimateFare;

  // Ride lifecycle (Phase 2 turn 3)
  createRide: CreateRide;
  observeRide: ObserveRide;
  listAvailableRides: ListAvailableRides;
  dispatchRide: DispatchRide;
  startRide: StartRide;
  requestPayment: RequestPayment;
  cancelRideByRider: CancelRideByRider;
  cancelRideByDriver: CancelRideByDriver;

  // Ride read paths (Phase 3 turn 1; ListRidesByDriver added Phase 4 turn 2)
  getRideById: GetRideById;
  listRidesByPassenger: ListRidesByPassenger;
  listRidesByDriver: ListRidesByDriver;
  observeTripEvents: ObserveTripEvents;
  observeLatestMessage: ObserveLatestMessage;
  observeTripPayments: ObserveTripPayments;

  // Trip-tracking domain logic (Phase 3 turn 1; full GPS lifecycle Phase 4)
  evaluateExitWarning: EvaluateExitWarning;

  // Location pipeline (Phase 2 turn 3c)
  updateUserLocation: UpdateUserLocation;
  subscribeToUserLocation: SubscribeToUserLocation;

  // Vehicle management (Phase 5 turn 2)
  registerVehicle: RegisterVehicle;
  listDriverVehicles: ListDriverVehicles;
  getVehicle: GetVehicle;
  setActiveVehicle: SetActiveVehicle;
  uploadVehiclePhotos: UploadVehiclePhotos;
  deleteVehicle: DeleteVehicle;
  approveVehicle: ApproveVehicle;
  rejectVehicle: RejectVehicle;
  decodeVin: DecodeVin;

  // Payments / Stripe Connect / tipping (Phase 6 turn 2)
  ensureStripeCustomer: EnsureStripeCustomer;
  createSetupIntent: CreateSetupIntent;
  listPaymentMethods: ListPaymentMethods;
  setDefaultPaymentMethod: SetDefaultPaymentMethod;
  detachPaymentMethod: DetachPaymentMethod;
  ensureStripeConnectAccount: EnsureStripeConnectAccount;
  createConnectOnboardingLink: CreateConnectOnboardingLink;
  createAccountLoginLink: CreateAccountLoginLink;
  refreshConnectAccountStatus: RefreshConnectAccountStatus;
  getDriverBalance: GetDriverBalance;
  listDriverPayouts: ListDriverPayouts;
  listBalanceTransactions: ListBalanceTransactions;
  processTip: ProcessTip;
}

export interface Container {
  useCases: UseCases;
  /**
   * Phase 7 turn 1: the background-geolocation seam. Exposed alongside
   * `useCases` rather than wrapped in a use case because `useGpsLifecycle`
   * (Turn 2) drives the SDK directly — its responsibilities (permission
   * flow, listener-level dedup, geofence registration) don't fit the
   * stateless-use-case shape used by every other domain.
   *
   * The presentation layer reaches it via `useUseCases().bgGeolocation` is
   * NOT the convention — `useGpsLifecycle` will read from a sibling
   * `useBackgroundGeolocation()` hook in Turn 2 that pulls from the
   * Container directly.
   *
   * Tests inject a `FakeBackgroundGeolocationClient` via
   * `TestContainerProvider`'s optional `bgGeolocation` prop.
   */
  bgGeolocation:
    | BackgroundGeolocationClientType
    | FakeBackgroundGeolocationClientType;
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
  vehicles: VehicleRepository;
  vehiclePhotos: VehicleStorageRepository;
  vinDecoder: VinDecoderService;
  stripeServer: StripeServerService;
  paymentCallable: PaymentCallableService;
  clock?: () => Date;
}): UseCases {
  const clock = args.clock ?? (() => new Date());
  return {
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
    estimateFare: new EstimateFare(),
    createRide: new CreateRide(args.rides),
    observeRide: new ObserveRide(args.rides),
    listAvailableRides: new ListAvailableRides(args.rides),
    dispatchRide: new DispatchRide(args.rides, clock),
    startRide: new StartRide(args.rides, clock),
    requestPayment: new RequestPayment(args.rides),
    cancelRideByRider: new CancelRideByRider(args.rides),
    cancelRideByDriver: new CancelRideByDriver(args.rides),
    getRideById: new GetRideById(args.rides),
    listRidesByPassenger: new ListRidesByPassenger(args.rides),
    listRidesByDriver: new ListRidesByDriver(args.rides),
    observeTripEvents: new ObserveTripEvents(args.rides),
    observeLatestMessage: new ObserveLatestMessage(),
    observeTripPayments: new ObserveTripPayments(args.rides),
    evaluateExitWarning: new EvaluateExitWarning(),
    updateUserLocation: new UpdateUserLocation(args.locations),
    subscribeToUserLocation: new SubscribeToUserLocation(args.locations),
    registerVehicle: new RegisterVehicle(
      args.auth,
      args.users,
      args.vehicles,
      clock,
    ),
    listDriverVehicles: new ListDriverVehicles(args.vehicles),
    getVehicle: new GetVehicle(args.vehicles),
    setActiveVehicle: new SetActiveVehicle(args.auth, args.vehicles),
    uploadVehiclePhotos: new UploadVehiclePhotos(
      args.auth,
      args.users,
      args.vehicles,
      args.vehiclePhotos,
      clock,
    ),
    deleteVehicle: new DeleteVehicle(args.auth, args.vehicles),
    approveVehicle: new ApproveVehicle(args.vehicles, clock),
    rejectVehicle: new RejectVehicle(args.vehicles, clock),
    decodeVin: new DecodeVin(args.vinDecoder),
    ensureStripeCustomer: new EnsureStripeCustomer(
      args.auth,
      args.users,
      args.stripeServer,
      clock,
    ),
    createSetupIntent: new CreateSetupIntent(
      args.auth,
      args.users,
      args.stripeServer,
    ),
    listPaymentMethods: new ListPaymentMethods(
      args.auth,
      args.users,
      args.stripeServer,
    ),
    setDefaultPaymentMethod: new SetDefaultPaymentMethod(
      args.auth,
      args.users,
      clock,
    ),
    detachPaymentMethod: new DetachPaymentMethod(
      args.auth,
      args.users,
      args.stripeServer,
      clock,
    ),
    ensureStripeConnectAccount: new EnsureStripeConnectAccount(
      args.auth,
      args.users,
      args.stripeServer,
      clock,
    ),
    createConnectOnboardingLink: new CreateConnectOnboardingLink(
      args.auth,
      args.users,
      args.stripeServer,
    ),
    createAccountLoginLink: new CreateAccountLoginLink(
      args.auth,
      args.users,
      args.stripeServer,
    ),
    refreshConnectAccountStatus: new RefreshConnectAccountStatus(
      args.auth,
      args.users,
      args.stripeServer,
      clock,
    ),
    getDriverBalance: new GetDriverBalance(
      args.auth,
      args.users,
      args.stripeServer,
    ),
    listDriverPayouts: new ListDriverPayouts(
      args.auth,
      args.users,
      args.stripeServer,
    ),
    listBalanceTransactions: new ListBalanceTransactions(
      args.auth,
      args.users,
      args.stripeServer,
    ),
    processTip: new ProcessTip(args.auth, args.rides, args.paymentCallable),
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

  // VIN decoder is unconditional in production: NHTSA's API needs no key
  // and is keyless / read-only, so it ships in every build (Phase 5 Turn 2
  // locked decision: real NHTSA in fakes-only branch too — Q2 confirmed).
  const vinDecoder = buildVinDecoderService();

  // Stripe server adapter is independent of Firebase: a build can have
  // Stripe configured without Firebase (rare but supported). Same fallback
  // pattern as routes: real adapter when env keys present, fake otherwise.
  const stripeServer = buildStripeServerService();

  // Phase 7 turn 1: BackgroundGeolocation. Unconditional in production —
  // the SDK degrades to time-limited debug mode without a license, which
  // is fine for dev / stage smokes. Tests inject the fake via
  // `TestContainerProvider`; this branch is never hit under jest because
  // the module is mocked globally in `jest.setup.ts`.
  const bgGeolocation = buildBackgroundGeolocationClient();

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
    const dataVehicles =
      require('@data/repositories/FirestoreVehicleRepository') as {
        FirestoreVehicleRepository: new () => FirestoreVehicleRepositoryType;
      };
    const dataVehiclePhotos =
      require('@data/repositories/FirebaseStorageVehiclePhotoRepository') as {
        FirebaseStorageVehiclePhotoRepository: new () => FirebaseStorageVehiclePhotoRepositoryType;
      };
    const dataCloudFunctions =
      require('@data/services/CloudFunctionsService') as {
        CloudFunctionsService: new () => CloudFunctionsServiceType;
      };
    const paymentCallable: PaymentCallableService =
      new dataCloudFunctions.CloudFunctionsService();
    LOG.info(
      'Container using Firebase{Auth,Firestore,Storage} + FirestoreServiceArea + FirestoreRide + FirestoreLocation + FirestoreVehicle repositories + StripeServer + CloudFunctions + BackgroundGeolocationClient',
    );
    return {
      useCases: makeUseCases({
        auth: new dataAuth.FirebaseAuthRepository(),
        users: new dataUsers.FirestoreUserRepository(),
        serviceAreas: new dataServiceAreas.FirestoreServiceAreaRepository(),
        rides: new dataRides.FirestoreRideRepository(),
        locations: new dataLocations.FirestoreLocationRepository(),
        routes,
        vehicles: new dataVehicles.FirestoreVehicleRepository(),
        vehiclePhotos:
          new dataVehiclePhotos.FirebaseStorageVehiclePhotoRepository(),
        vinDecoder,
        stripeServer,
        paymentCallable,
      }),
      bgGeolocation,
    };
  }

  const testing = require('@shared/testing') as {
    FakeCloudFunctionsService: new () => FakeCloudFunctionsServiceType;
    InMemoryAuthRepository: new () => InMemoryAuthRepositoryType;
    InMemoryLocationRepository: new () => InMemoryLocationRepositoryType;
    InMemoryRideRepository: new () => InMemoryRideRepositoryType;
    InMemoryServiceAreaRepository: new () => InMemoryServiceAreaRepositoryType;
    InMemoryUserRepository: new () => InMemoryUserRepositoryType;
    InMemoryVehicleRepository: new () => InMemoryVehicleRepositoryType;
    InMemoryVehiclePhotoRepository: new () => InMemoryVehiclePhotoRepositoryType;
  };
  LOG.warn(
    'Firebase config not detected — using in-memory fakes for auth/user/service-areas/rides/locations/vehicles + FakeCloudFunctionsService. ' +
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
      vehicles: new testing.InMemoryVehicleRepository(),
      vehiclePhotos: new testing.InMemoryVehiclePhotoRepository(),
      vinDecoder,
      stripeServer,
      paymentCallable: new testing.FakeCloudFunctionsService(),
    }),
    bgGeolocation,
  };
}

/**
 * Build the real `BackgroundGeolocationClient`. Unconditional in
 * production — the Transistor SDK degrades to time-limited debug mode
 * without a license, which is acceptable for dev / stage smokes.
 *
 * Lazy-required so a fakes-only build that never reaches the runtime
 * Container construction (e.g. a unit test that imports a use case
 * directly) doesn't pull the SDK into the bundle.
 *
 * Tests use `TestContainerProvider`'s `bgGeolocation` override slot to
 * inject `FakeBackgroundGeolocationClient` directly — this builder is
 * not exercised under jest because `react-native-background-geolocation`
 * is mocked globally in `jest.setup.ts`.
 */
function buildBackgroundGeolocationClient(): BackgroundGeolocationClientType {
  const dataBg = require('@data/services/BackgroundGeolocationClient') as {
    BackgroundGeolocationClient: new () => BackgroundGeolocationClientType;
  };
  return new dataBg.BackgroundGeolocationClient();
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

/**
 * Build the VIN decoder service. NHTSA's vPIC + SafetyRatings APIs are
 * keyless and free for read traffic, so the real adapter is unconditional
 * in production (Phase 5 Turn 2 locked decision Q2). Tests swap in
 * `FakeVinDecoderService` via `TestContainerProvider` overrides — never
 * via this builder.
 *
 * Lazy-required so a fakes-only build that never instantiates the
 * container won't pull `NhtsaVinDecoderService` into the bundle.
 */
function buildVinDecoderService(): VinDecoderService {
  const dataVinDecoder = require('@data/services/NhtsaVinDecoderService') as {
    NhtsaVinDecoderService: new () => NhtsaVinDecoderServiceType;
  };
  return new dataVinDecoder.NhtsaVinDecoderService();
}

/**
 * Pick the right StripeServerService for the build:
 *   - Both `STRIPE_SERVER_URL` and `STRIPE_SERVER_API_KEY` resolved →
 *     real `StripeServerHttpAdapter`.
 *   - Either missing → `FakeStripeServerService` (development convenience).
 *
 * Lazy-required from the appropriate side so the bundle never pulls
 * `StripeServerHttpAdapter` into a fakes-only build, and never pulls the
 * fake into a release build with real env.
 */
function buildStripeServerService(): StripeServerService {
  const config = getStripeServerConfig();
  if (config !== null) {
    const dataAdapter = require('@data/services/StripeServerHttpAdapter') as {
      StripeServerHttpAdapter: new (config: {
        baseUrl: string;
        apiKey: string;
      }) => StripeServerHttpAdapterType;
    };
    LOG.info('Container using StripeServerHttpAdapter');
    return new dataAdapter.StripeServerHttpAdapter({
      baseUrl: config.url,
      apiKey: config.apiKey,
    });
  }
  const testing = require('@shared/testing') as {
    FakeStripeServerService: new () => FakeStripeServerServiceType;
  };
  LOG.warn(
    'Stripe server env not configured (STRIPE_SERVER_URL / STRIPE_SERVER_API_KEY) ' +
      '— using FakeStripeServerService. Payments will fail loudly until env is set.',
  );
  return new testing.FakeStripeServerService();
}

function isFirebaseConfigured(): boolean {
  const Constants = require('expo-constants') as {
    default?: { expoConfig?: { extra?: Record<string, unknown> } };
  };
  const flag = Constants.default?.expoConfig?.extra?.['firebaseConfigured'];
  return flag === true;
}
