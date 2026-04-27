import type { CompositeScreenProps } from '@react-navigation/native';
import type {
  NativeStackNavigationProp,
  NativeStackScreenProps,
} from '@react-navigation/native-stack';

/**
 * Per Decisions in REFACTOR_PLAN.md §7: full typed navigation from day one.
 *
 * Each navigator declares its own param list. The root `RootStackParamList`
 * embeds every nested navigator. Screens consume `RootStackScreenProps<T>` to
 * get fully-typed `route` and `navigation` props.
 *
 * Three stacks, one mounted at a time based on `useSessionStatus()`:
 *   - `AuthStack` — unauthenticated: LogIn / Register / ForgotPassword.
 *   - `VerifyEmailStack` — signed in but email not yet verified. Single
 *     screen — EmailVerification — with no escape into the main app until
 *     the user confirms (or signs out).
 *   - `MainStack` — authenticated + verified. Phase 1 placeholder; Phase 3
 *     replaces it with RiderTabs / DriverTabs.
 *
 * Routing decisions live in `RootNavigator`; the navigators themselves know
 * nothing about session state.
 */

export type AuthStackParamList = {
  LogIn: undefined;
  Register: undefined;
  ForgotPassword: undefined;
};

export type VerifyEmailStackParamList = {
  EmailVerification: undefined;
};

export type MainStackParamList = {
  /** Phase 1 placeholder home. Will be replaced by RiderTabs / DriverTabs. */
  Home: undefined;
  /** Profile editor. Reachable from Home for now. */
  UserProfile: undefined;
};

/**
 * Aggregated root list. The three stacks are separate Navigator instances at
 * runtime; this type is what `useNavigation()` defaults to via the global
 * augmentation below.
 */
export type RootStackParamList = AuthStackParamList &
  VerifyEmailStackParamList &
  MainStackParamList;

export type AuthStackScreenProps<T extends keyof AuthStackParamList> =
  NativeStackScreenProps<AuthStackParamList, T>;

export type VerifyEmailStackScreenProps<
  T extends keyof VerifyEmailStackParamList,
> = NativeStackScreenProps<VerifyEmailStackParamList, T>;

export type MainStackScreenProps<T extends keyof MainStackParamList> =
  NativeStackScreenProps<MainStackParamList, T>;

export type AuthStackNavigation = NativeStackNavigationProp<AuthStackParamList>;
export type VerifyEmailStackNavigation =
  NativeStackNavigationProp<VerifyEmailStackParamList>;
export type MainStackNavigation = NativeStackNavigationProp<MainStackParamList>;

/**
 * Composite screen props for screens nested deeper than the root stack
 * (rider tabs inside the rider stack inside main, etc.). Lands when the
 * tab navigator does — Phase 3.
 */
export type ComposedScreenProps<
  Inner extends Record<string, object | undefined>,
  Outer extends Record<string, object | undefined>,
  InnerKey extends keyof Inner & string,
  OuterKey extends keyof Outer & string,
> = CompositeScreenProps<
  NativeStackScreenProps<Inner, InnerKey>,
  NativeStackScreenProps<Outer, OuterKey>
>;

/**
 * Globally augment React Navigation's type registry so `useNavigation()`
 * defaults to the union of all our stacks.
 */
declare global {
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}
