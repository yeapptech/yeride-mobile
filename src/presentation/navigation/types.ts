import type {
  BottomTabNavigationProp,
  BottomTabScreenProps,
} from '@react-navigation/bottom-tabs';
import type {
  CompositeScreenProps,
  NavigatorScreenParams,
} from '@react-navigation/native';
import type {
  NativeStackNavigationProp,
  NativeStackScreenProps,
} from '@react-navigation/native-stack';

/**
 * Per Decisions in REFACTOR_PLAN.md §7: full typed navigation from day one.
 *
 * Each navigator declares its own param list. The root `RootStackParamList`
 * embeds every nested navigator. Screens consume `RootStackScreenProps<T>`
 * to get fully-typed `route` and `navigation` props.
 *
 * Phase 3 turn 3 introduces role-based routing in `RootNavigator`:
 *   - `AuthStack` — unauthenticated: LogIn / Register / ForgotPassword.
 *   - `VerifyEmailStack` — signed in but email not yet verified.
 *   - `RiderStack` — authenticated rider: bottom-tab home + modal stack.
 *   - `DriverStack` — authenticated driver: Phase 4 placeholder for now.
 *
 * Routing decisions live in `RootNavigator`; the navigators themselves
 * know nothing about session state.
 */

export type AuthStackParamList = {
  LogIn: undefined;
  Register: undefined;
  ForgotPassword: undefined;
};

export type VerifyEmailStackParamList = {
  EmailVerification: undefined;
};

/**
 * Bottom tabs inside the rider experience. Phase 3 turn 3 mounts only
 * `RiderHome` and `Profile` for real; `Activity` (Phase 5) and `Wallet`
 * (Phase 6) are placeholder screens with a "coming soon" copy block.
 */
export type RiderTabsParamList = {
  RiderHome: undefined;
  Activity: undefined;
  Wallet: undefined;
  Profile: undefined;
};

/**
 * Native-stack hosting the rider tabs + modal screens that push on top:
 *   - `RouteSearch` — pickup + dropoff entry
 *   - `RouteSelect` — alternatives + tier picker
 *   - `RideMonitor` — live ride (turn 3.4)
 *   - `RideReceipt` — terminal-state receipt (turn 3.5)
 *
 * `RideMonitor` and `RideReceipt` carry the `rideId` they're scoped to so
 * deep links and cold-launches can resume.
 */
export type RiderStackParamList = {
  RiderTabs: NavigatorScreenParams<RiderTabsParamList>;
  RouteSearch: undefined;
  RouteSelect: undefined;
  RideMonitor: { rideId: string };
  RideReceipt: { rideId: string };
  /**
   * Profile editor reachable as a modal from the Profile tab. Same screen
   * that the Profile tab points at, but pushed instead of root-mounted, so
   * the tab bar hides while editing. Phase 3 keeps both reachable for
   * familiarity until turn 3.5 finalizes the layout.
   */
  UserProfile: undefined;
};

/**
 * Bottom tabs inside the driver experience. Phase 4 turn 1 mounts:
 *   - `DriverHome` — placeholder with online toggle (Turn 2 replaces with
 *     the real map + ride-cards screen).
 *   - `Activity` — placeholder, real ride-history view lands in Phase 5.
 *   - `Earnings` — placeholder, Stripe Connect surface lands in Phase 6.
 *   - `Profile` — reuses the same `UserProfileScreen` the rider tabs use.
 */
export type DriverTabsParamList = {
  DriverHome: undefined;
  Activity: undefined;
  Earnings: undefined;
  Profile: undefined;
};

/**
 * Native-stack hosting the driver tabs + every modal / pushed screen on
 * top. Phase 4 turn 2 added `DriverDispatch`; turn 4a adds
 * `DriverMonitor` — the active-trip surface that drivers replace into
 * after accepting an offer. Both routes carry the rideId so deep links
 * and cold-launches resume.
 */
export type DriverStackParamList = {
  DriverTabs: NavigatorScreenParams<DriverTabsParamList>;
  /**
   * Incoming-ride dispatch surface. The DriverHome ride-card tap pushes
   * here with the rideId; Turn 3 wires the real accept/decline use cases.
   */
  DriverDispatch: { rideId: string };
  /**
   * Active-trip surface. Driver lands here via `navigation.replace` from
   * DriverDispatch on accept; DriverHome's in-progress redirect also
   * lands here on cold launch. The status-router inside the screen picks
   * the right view based on `Ride.status`. Turn 4a wires the
   * en-route-to-pickup and at-pickup views; turn 4b adds started /
   * payment-requested / completed / payment-failed.
   */
  DriverMonitor: { rideId: string };
  /**
   * Profile editor reachable as a modal from the Profile tab. Same screen
   * that the Profile tab points at, but pushed instead of root-mounted, so
   * the tab bar hides while editing — same pattern as the rider stack.
   */
  UserProfile: undefined;
};

/**
 * Aggregated root list. Each stack is a separate Navigator instance at
 * runtime; this type is what `useNavigation()` defaults to via the global
 * augmentation below.
 */
export type RootStackParamList = AuthStackParamList &
  VerifyEmailStackParamList &
  RiderStackParamList &
  DriverStackParamList;

export type AuthStackScreenProps<T extends keyof AuthStackParamList> =
  NativeStackScreenProps<AuthStackParamList, T>;

export type VerifyEmailStackScreenProps<
  T extends keyof VerifyEmailStackParamList,
> = NativeStackScreenProps<VerifyEmailStackParamList, T>;

export type RiderStackScreenProps<T extends keyof RiderStackParamList> =
  NativeStackScreenProps<RiderStackParamList, T>;

export type RiderTabsScreenProps<T extends keyof RiderTabsParamList> =
  CompositeScreenProps<
    BottomTabScreenProps<RiderTabsParamList, T>,
    NativeStackScreenProps<RiderStackParamList, 'RiderTabs'>
  >;

export type DriverStackScreenProps<T extends keyof DriverStackParamList> =
  NativeStackScreenProps<DriverStackParamList, T>;

export type DriverTabsScreenProps<T extends keyof DriverTabsParamList> =
  CompositeScreenProps<
    BottomTabScreenProps<DriverTabsParamList, T>,
    NativeStackScreenProps<DriverStackParamList, 'DriverTabs'>
  >;

export type AuthStackNavigation = NativeStackNavigationProp<AuthStackParamList>;
export type VerifyEmailStackNavigation =
  NativeStackNavigationProp<VerifyEmailStackParamList>;
export type RiderStackNavigation =
  NativeStackNavigationProp<RiderStackParamList>;
export type RiderTabsNavigation = BottomTabNavigationProp<RiderTabsParamList>;
export type DriverStackNavigation =
  NativeStackNavigationProp<DriverStackParamList>;
export type DriverTabsNavigation = BottomTabNavigationProp<DriverTabsParamList>;

/**
 * Composite screen props for screens nested deeper than the root stack.
 * Used for tabs inside the rider stack — a screen on the `Profile` tab
 * may navigate either to a tab sibling or to a modal in the parent
 * stack.
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
