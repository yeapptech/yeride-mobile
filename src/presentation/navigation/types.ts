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
   * Confirmation surface shown immediately after a rider creates a
   * SCHEDULED ride (not a "now" ride). Stateless one-way screen: ✓
   * icon, formatted pickup datetime, pickup address, reassurance
   * line, "Got it" button that pops back to `RiderTabs`.
   *
   * Params carry the already-formatted display strings rather than a
   * `rideId` — confirmation is transient (not deep-linkable; rider
   * sees it once) and the view-model already had the formatted
   * datetime when it made the create call. Phase 10 turn 7
   * Decision 3 (a).
   */
  RideScheduledConfirmation: {
    formattedSchedulePickupAt: string;
    pickupAddress: string | null;
  };
  /**
   * Trip-detail surface reached from Activity tab row taps on
   * terminal-status trips (`completed` / `cancelled`). Role-agnostic;
   * the same screen is also mounted on the driver stack so both sides
   * land somewhere consistent. Renders trip route, role-flipped party
   * header, per-trip events, and per-trip payments + total. Tip
   * re-entry is intentionally NOT here in Turn 6 — the rider's
   * `RideReceiptScreen` owns the tip UX. Phase 10 Turn 6.
   */
  TripDetail: { rideId: string };
  /**
   * Profile editor reachable as a modal from the Profile tab. Same screen
   * that the Profile tab points at, but pushed instead of root-mounted, so
   * the tab bar hides while editing. Phase 3 keeps both reachable for
   * familiarity until turn 3.5 finalizes the layout.
   */
  UserProfile: undefined;
  /**
   * Add-card modal reachable from the Wallet tab. Pushed with
   * `presentation: 'modal'` so it slides over the tab bar. The screen's
   * view-model lazily fires `EnsureStripeCustomer` then `CreateSetupIntent`
   * before handing off to Stripe's native `confirmSetupIntent`. Phase 6
   * turn 3.
   */
  AddPaymentMethod: undefined;
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
 * top. Mounts `DriverDispatch` (incoming-ride accept/decline) and
 * `DriverMonitor` (active-trip surface that drivers replace into after
 * accepting an offer). Both routes carry the rideId so deep links and
 * cold-launches resume.
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
   * the right view based on `Ride.status` plus a single client-side
   * `arrivedAtPickup` flag — covering en-route-to-pickup, at-pickup,
   * started, payment-requested, completed, and payment-failed.
   */
  DriverMonitor: { rideId: string };
  /**
   * Google Navigation SDK turn-by-turn surface (Phase 8 turn 2). The
   * driver arrives here from `DriverMonitor.onLaunchNavigation` after
   * the SDK session has been `init()`-ed (and any first-time terms
   * dialog accepted). The screen mounts `<NavigationView/>` from the
   * SDK and delegates session lifecycle to
   * `useDriverNavigationViewModel`.
   *
   * Param payload:
   *   - `leg`: which trip leg this session covers — 'pickup' (driver
   *     → rider's pickup point) or 'dropoff' (driver → rider's
   *     dropoff). Used purely for screen-title copy + analytics.
   *   - `title`: human-readable destination label shown in the SDK
   *     UI ("Pickup Location", "Dropoff Location", etc.).
   *   - `destination`: lat/lng of the single waypoint for this leg.
   *   - `routeToken?`: rider-selected route token from
   *     `ride.dropoff.directions.routeToken` when present (dropoff
   *     leg only). When supplied, the SDK uses it instead of
   *     re-computing routing options.
   *   - `avoidTolls?`: forwarded to the SDK's `routingOptions` when
   *     no route token is supplied. Reads from
   *     `ride.routePreference.avoidTolls`.
   */
  DriverNavigation: {
    leg: 'pickup' | 'dropoff';
    title: string;
    destination: { lat: number; lng: number };
    routeToken?: string;
    avoidTolls?: boolean;
  };
  /**
   * Profile editor reachable as a modal from the Profile tab. Same screen
   * that the Profile tab points at, but pushed instead of root-mounted, so
   * the tab bar hides while editing — same pattern as the rider stack.
   */
  UserProfile: undefined;
  /**
   * Driver vehicle list — reached from the Profile tab via a "Vehicles"
   * row. Live subscription via `ListDriverVehicles`; tap a card to push
   * `VehicleDetails`; tap Delete to soft-delete (Alert-confirmed).
   * Phase 5 turn 3.
   */
  Vehicles: undefined;
  /**
   * New-vehicle registration — reached from `Vehicles` via "+ Add
   * vehicle". VIN decode → confirm-or-edit → manual fallback. Phase 5
   * turn 3.
   */
  VehicleRegistration: undefined;
  /**
   * Read-only single-vehicle detail surface — reached from `Vehicles`
   * via a card tap. Hosts the "Set as active" / "Edit photos" / Delete
   * actions. Phase 5 turn 4.
   */
  VehicleDetails: { vin: string };
  /**
   * Five-tile vehicle-photo upload surface — reached from
   * `VehicleDetails` via "Add photos" / "Update photos". Photos are
   * uploaded per-tile; empty tiles are allowed (legacy parity).
   * Phase 5 turn 4.
   */
  VehiclePhotos: { vin: string };
  /**
   * Trip-detail surface reached from the driver Activity tab on terminal-
   * status trips (`completed` / `cancelled`). Same screen as the rider
   * stack's `TripDetail` — role-agnostic; the screen body adapts based
   * on which side of the trip the current user is on. Phase 10 Turn 6.
   */
  TripDetail: { rideId: string };
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
