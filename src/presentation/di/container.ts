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
import { ListRideServices } from '@app/usecases/serviceArea/ListRideServices';
import { ListServiceAreas } from '@app/usecases/serviceArea/ListServiceAreas';
import { ResolveActiveServiceArea } from '@app/usecases/serviceArea/ResolveActiveServiceArea';
import { GreetUser } from '@app/usecases/shared/GreetUser';
import type { FirebaseAuthRepository as FirebaseAuthRepositoryType } from '@data/repositories/FirebaseAuthRepository';
import type { FirestoreServiceAreaRepository as FirestoreServiceAreaRepositoryType } from '@data/repositories/FirestoreServiceAreaRepository';
import type { FirestoreUserRepository as FirestoreUserRepositoryType } from '@data/repositories/FirestoreUserRepository';
import type {
  AuthRepository,
  ServiceAreaRepository,
  UserRepository,
} from '@domain/repositories';
import { LOG } from '@shared/logger';
import type {
  InMemoryAuthRepository as InMemoryAuthRepositoryType,
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
    LOG.info(
      'Container using FirebaseAuthRepository + FirestoreUserRepository + FirestoreServiceAreaRepository',
    );
    return {
      useCases: makeUseCases({
        auth: new dataAuth.FirebaseAuthRepository(),
        users: new dataUsers.FirestoreUserRepository(),
        serviceAreas: new dataServiceAreas.FirestoreServiceAreaRepository(),
      }),
    };
  }

  const testing = require('@shared/testing') as {
    InMemoryAuthRepository: new () => InMemoryAuthRepositoryType;
    InMemoryServiceAreaRepository: new () => InMemoryServiceAreaRepositoryType;
    InMemoryUserRepository: new () => InMemoryUserRepositoryType;
  };
  LOG.warn(
    'Firebase config not detected — using in-memory fakes for auth/user/service-areas. ' +
      'No data will persist. See docs/FIREBASE_SETUP.md.',
  );
  return {
    useCases: makeUseCases({
      auth: new testing.InMemoryAuthRepository(),
      users: new testing.InMemoryUserRepository(),
      serviceAreas: new testing.InMemoryServiceAreaRepository(),
    }),
  };
}

function isFirebaseConfigured(): boolean {
  const Constants = require('expo-constants') as {
    default?: { expoConfig?: { extra?: Record<string, unknown> } };
  };
  const flag = Constants.default?.expoConfig?.extra?.['firebaseConfigured'];
  return flag === true;
}
