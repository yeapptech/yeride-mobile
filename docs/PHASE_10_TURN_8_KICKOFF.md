# Phase 10 Turn 8 Kickoff — Chat (in-trip rider ↔ driver messaging)

You're picking up the YeRide-Next clean-architecture rewrite at
`/Users/papagallo/yeapptech/dev/yeride-mobile/`. **Phase 10 Turn 7
closed 2026-05-19** (scheduled rides: rider-side creation UI,
`Ride.createScheduled` + `ObserveScheduledRides` + the rider
Activity Scheduled section; see `docs/PHASE_10_TURN_7.md`).
Post-Turn-7 audit shows **2 ❌ / 0 🟡 / 0 ⚠️** remaining (§3.4 Chat,
§10.1 BG-geolocation test regression).

Turn 8 closes the larger of the two: **§3.4 Chat / messaging**.
When this turn lands, the trip-active surfaces on both roles get a
real chat thread (port of the legacy `ChatModal`), the
`ChatRepository` interface + Firestore adapter + in-memory fake
ship, three new use cases (`ObserveChatMessages`, `SendChatMessage`,
`MarkMessagesRead`) replace the Phase 3 stubs, and the
already-deployed `onMessageCreated` Cloud Function lights up
end-to-end push notifications between rider and driver. Size per
audit §8 row 8: **medium (2-3d)**.

## Context — why this turn now

**Legacy surface (the user-visible behavior we're restoring):**

- `yeride/src/components/ChatModal.js` (191 lines) — a full-screen
  `<Modal animationType="fade" statusBarTranslucent
navigationBarTranslucent>` wrapping `GiftedChat` from
  `react-native-gifted-chat` (line 11). Reads from + writes to
  `trips/{chatId}/messages` (lines 62-75, 86-100). Snapshot path
  `orderBy('createdAt', 'desc')` (gifted-chat renders bottom-up).
  Sends via `firestore.FieldValue.serverTimestamp()` (line 94) so
  the Cloud Function trigger fires on a stable server clock.
  Calls `markMessagesRead(chatId, role)` on mount AND after every
  snapshot batch (lines 58-60, 72-74) so the unread badge clears
  the moment the recipient is viewing the thread.
- `yeride/src/components/ChatModal.js:18` — module-scoped
  `openChatId` ref + `getOpenChatId()` export. `AppContent`'s
  foreground notification handler reads this to suppress the
  `chat_message` banner when the recipient is currently looking
  at the very thread the message arrived on. Cleared on unmount
  (line 79) — only cleared if it still matches, because two
  rapid open/close cycles can race the cleanup.
- `yeride/src/components/ChatTouchable.js` (25 lines) — the
  `Ionicons` `chatbubble-outline` button. Used on both
  `RideMonitor.js` (rider) and `DriverMonitor.js` (driver).
- `yeride/src/api/firebase/Trip.js:1220-1243` — `markMessagesRead`.
  Validates `tripId`, validates `role ∈ {rider, driver}`, writes
  `lastSeenByRiderAt | lastSeenByDriverAt:
serverTimestamp()` to the parent `trips/{tripId}` doc. The
  parent-doc field is the source of truth for the OTHER party's
  unread state (rider's `lastSeenByRiderAt < driver's last
sendTime` → driver UI shows a dot — see legacy
  `subscribeToLatestMessage` consumers).
- `yeride/src/api/firebase/Trip.js:1254-1275` —
  `subscribeToLatestMessage(tripId, callback)`. `onSnapshot` on
  the messages subcollection ordered `createdAt desc limit(1)`.
  Drives the unread dot on the chat-touchable button. The rewrite
  already wires this through `ObserveLatestMessage` (stub).
- `yeride/src/rider/screens/RideMonitor.js:24,51,162,385,569-577`
  — `ChatModal` import, modal-visible state, "open chat" handler
  (which also clears the local unread flag), modal mount inside
  the screen tree. Visible at all active-trip statuses
  (`dispatched` / `started`). Hidden during pre-dispatch
  (`awaiting_driver`) because there's no driver to chat with yet.
- `yeride/src/driver/screens/DriverMonitor.js:34,75,153,389,736-741`
  — symmetric driver-side wiring. Same chat surface; the only
  difference is the gifted-chat `user._id` is the driver UID.

**Already-deployed server-side (verified, NO change required):**

- `yeride-functions/functions/handlers/message-created.js`
  (60 lines) — Firestore `onDocumentCreated` trigger on
  `trips/{tripId}/messages/{messageId}`. Reads the parent trip
  doc, identifies the OTHER party (rider vs driver) by
  `msg.senderId === trip.passenger?.id`, looks up
  `recipient.pushToken`, sends an Expo push with
  `type: "chat_message", tripId` in `data` (lines 52-55). Body is
  truncated to 120 chars (line 9). Already deployed to both
  `yeapp-stage` and `yeapp-prod` projects.
- `yeride-functions/functions/index.js` — exports
  `onMessageCreated`. No change in scope here.

**Rewrite state (verified at kickoff time):**

- ✅ `ChatMessage` domain entity exists at
  `src/domain/entities/ChatMessage.ts` (31 lines). Shape:
  `{id: ChatMessageId, senderId: UserId, text: string, createdAt:
Date, readAt: Date | null}`. Branded `ChatMessageId`.
  Phase 3 was read-only; this turn extends it with a
  `static create(props)` factory + validation
  (non-empty trimmed text, length ≤ 1000, valid sender, valid
  createdAt).
- ✅ `ObserveLatestMessage` use case at
  `src/app/usecases/ride/ObserveLatestMessage.ts` (33 lines).
  Phase 3 stub — emits `null` synchronously, no-op unsubscribe.
  This turn rewrites the body to delegate to
  `ChatRepository.observeLatestMessage(args)`.
- ✅ `useChatUiStore` Zustand store at
  `src/presentation/stores/useChatUiStore.ts` (58 lines). State:
  `{isOpen: boolean, lastReadAt: Date | null, open(), close(),
markRead(at?), reset()}`. Selectors: `useChatIsOpen()`,
  `useChatLastReadAt()`. Phase 3 docstring (lines 4-22)
  explicitly flags this as the "UI-only state for the in-trip
  chat surface; full chat thread + send/markRead use cases land
  in Phase 3.5" — this turn IS that Phase 3.5 work.
- ✅ Push routing: `HandleNotificationResponse` already routes
  `chat_message + tripId` deep links to the trip-monitor screen
  on both roles (see `HandleNotificationResponse.ts` and the test
  file at
  `src/app/usecases/notifications/__tests__/HandleNotificationResponse.test.ts`).
  Foreground-banner SUPPRESSION for an open chat is NOT
  implemented — this turn adds it (audit §6 row 677 explicitly
  flags it as "❌ blocked on §3.4").
- ✅ Rider-side chat button exists in `StartedView` (lines 69-86)
  and `DispatchedView` (lines 73-78) as a header
  `<HeaderIconButton/>`. Tapping currently fires
  `useRideMonitorViewModel.onPressChat` (lines 250-257) — a Toast
  ("Messaging coming soon · Chat threads land in Phase 3.5").
  Unread dot already plumbed in `useRideMonitorViewModel`
  (lines 146-162) via `useFirestoreSubscription` over
  `ObserveLatestMessage.execute({rideId, callback})` and a
  store-derived `hasUnreadMessages` memo. Currently always
  `false` because the stub emits `null`.
- ❌ **No `ChatRepository` interface** in
  `src/domain/repositories/`.
- ❌ **No Firestore chat adapter** in
  `src/data/repositories/`.
- ❌ **No in-memory fake** in `src/shared/testing/`.
- ❌ **No chat DTO / mapper** in `src/data/dto/` and
  `src/data/mappers/`.
- ❌ **No `SendChatMessage` / `MarkMessagesRead` use cases** in
  `src/app/usecases/`. Only the read-side `ObserveLatestMessage`
  stub exists.
- ❌ **No `ChatModal` / `ChatScreen` component** in
  `src/presentation/`.
- ❌ **`react-native-gifted-chat` not in `package.json`.** Must
  be added at an Expo SDK 55 / React 19 / RN 0.83 compatible pin.
  Most recent stable: `2.10.2` (check npm at kickoff time;
  pre-checklist item 4).
- ❌ **`useChatViewModel` doesn't exist.** Need to write the
  view-model that owns chat-open lifecycle, message subscription,
  send mutation, mark-read writes, and the
  `useChatUiStore.open()` / `close()` calls.
- ❌ **Driver-side chat button missing.** `DriverMonitorScreen` +
  the active-status driver views (`EnRouteToPickupView`,
  `AtPickupView` — see header comment at
  `EnRouteToPickupView.tsx:29` flagging "header chat button is
  deferred to Phase 9 polish"; that polish was deferred to here)
  + `StartedView` (driver-side) don't render a chat-touchable.
  Adding the driver-side button is in scope: audit §3.4 calls
  out "rider + driver" parity.
- ❌ **`lastSeenByRiderAt` / `lastSeenByDriverAt` Firestore fields
  not written by the rewrite.** `FirestoreRideRepository.ts:219`
  preserves them on existing docs via `merge: true` — but no path
  writes them. The new `MarkMessagesRead` use case fills this in.
  Read-side: `RideDoc` DTO does NOT include the two fields
  today; this turn adds them as optional read-only accepters (no
  domain mirror needed — the unread dot is derived from
  `latestMessage.createdAt > useChatUiStore.lastReadAt`, and the
  parent-doc fields are written for the OTHER party's UI as
  legacy-parity).
- ❌ **Foreground push-banner suppression for the currently-open
  chat is missing.** Legacy uses the module-scoped `openChatId`
  ref; rewrite needs the Zustand-store equivalent — extend
  `useChatUiStore` with `openRideId: RideId | null` and read it
  from a foreground notification handler.

## Required reading (in order)

1. **`docs/PHASE_10_PARITY_AUDIT.md` §3.4, §6 row 677, §8 row 8,
   §1 headline.** §3.4 is canonical scope. §6 (push notifications)
   row 677 is explicit: "`chat_message` banner suppression for
   open chat: ❌ blocked on §3.4." §8 row 8 sizes the turn
   medium (2-3 days). §1 currently reads "2 ❌ / 0 🟡 / 0 ⚠️" — flip
   `2 ❌` → `1 ❌` at close, leaving only §10.1 (BG-geolocation
   tests, Turn 9 scope).
2. **`docs/PHASE_10_TURN_7.md` §"Notes for the next turn"** — the
   hand-off paragraph for this turn. Explicit call-outs:
   `ChatMessage` entity / `ObserveLatestMessage` use case /
   `useChatUiStore` already exist; `ChatRepository` adapter +
   chat surface + `react-native-gifted-chat` library do not.
3. **`docs/PHASE_10_CUTOVER_PLAN.md` §0** — confirms the parity
   audit is the gate; flip §3.4 ❌ → ✅ at the end of this turn so
   only §10.1 BG-geolocation blocks §6 rollout.
4. **Legacy `yeride/src/components/ChatModal.js`** in full
   (191 lines). Note the read path (lines 54-81), the send path
   (lines 83-104), the module-scoped `openChatId` ref pattern
   (lines 17-19, 57, 79), and the `markMessagesRead` calls on
   mount + after every snapshot (lines 58-60, 72-74). Port the
   read path through `ChatRepository.observeMessages`, the send
   path through `SendChatMessage`, and the foreground-banner
   suppression through `useChatUiStore.openRideId`. The on-disk
   message shape that landed on the doc IS the canonical wire
   format: `{_id, text, senderId, createdAt: ServerTimestamp,
user: {_id, name}}`.
5. **Legacy `yeride/src/components/ChatTouchable.js`** (25 lines).
   Read for visual parity. The rewrite already has
   `HeaderIconButton` + `chatbubble-outline` wiring in
   `StartedView.tsx:69-86`. The driver-side button is the same
   component, just gated on driver-active statuses.
6. **Legacy `yeride/src/api/firebase/Trip.js:1220-1275`** —
   `markMessagesRead` (1220-1243) and `subscribeToLatestMessage`
   (1254-1275). The former is the canonical contract the
   `MarkMessagesRead` use case mirrors (validate trip+role, write
   `lastSeenByRiderAt|lastSeenByDriverAt: serverTimestamp()` to
   parent doc). The latter is what `ObserveLatestMessage`'s new
   non-stub body is structurally identical to — `onSnapshot` on
   messages subcollection, `orderBy createdAt desc limit(1)`, map
   to `ChatMessage` via mapper, hand to callback.
7. **`yeride-functions/functions/handlers/message-created.js`**
   (60 lines). Read for the on-disk shape it depends on. The
   trigger reads `msg.senderId`, `msg.text`, `msg.user?.name`,
   plus `trip.passenger.id` / `trip.driver` / `recipient.pushToken`.
   The rewrite write path MUST write all of these fields with
   the exact names — even `msg.user.name` (the function uses it
   for the push title at line 45). Keep the schema permissive on
   reads (legacy may have written `_id` as `user._id` instead of
   `senderId` for some old docs; check by spot-grepping the
   legacy doc) but write the canonical shape.
8. **Rewrite `src/domain/entities/ChatMessage.ts`** (31 lines).
   Currently a read-only interface. Convert to a class with a
   `static create(props)` factory that returns
   `Result<ChatMessage, ValidationError>`. Validation: `text`
   non-empty after `.trim()`, length ≤ 1000, `senderId` non-empty,
   `createdAt` valid `Date`. Add a `markRead(at: Date)` method
   that returns a new entity with `readAt: at` (immutable evolve
   pattern). Add tests.
9. **Rewrite `src/app/usecases/ride/ObserveLatestMessage.ts`**
   (33 lines). The body is a Phase 3 stub. Rewrite to delegate
   to `repo.observeLatestMessage({rideId, callback})`. Keep the
   subscription-shaped signature — synchronous unsubscribe.
10. **Rewrite `src/presentation/stores/useChatUiStore.ts`**
    (58 lines). Today: `{isOpen, lastReadAt}`. Extend with
    `openRideId: RideId | null` so foreground push handler can
    grep against the current trip. Setters: `open(rideId)` /
    `close()`. `markRead(at?)` stays. The legacy `openChatId`
    string ref maps cleanly to the typed `RideId | null` here.
11. **Rewrite `src/presentation/features/rider/view-models/useRideMonitorViewModel.ts`**
    lines 62-64, 98-102 (`onPressChat` JSDoc), 146-162 (latest
    message subscription + `hasUnreadMessages` memo), 250-257
    (the Toast stub to replace). The plumbing is already there;
    swap the toast for `setChatOpen(rideId)` (a new VM field) +
    pop the in-screen `<ChatModal/>` overlay. The unread-memo
    logic doesn't change — it already compares
    `latestMessage.createdAt` against `useChatUiStore.lastReadAt`.
12. **Rewrite `src/presentation/features/rider/components/StartedView.tsx`
    + `DispatchedView.tsx`.** StartedView (lines 69-86) already
    has the chat button with unread dot. DispatchedView (lines
    73-78) has the chat button WITHOUT the unread dot — add it
    for parity (the rider may receive a message before the trip
    starts). The `onPressChat` + `hasUnread` props plumb in from
    `useRideMonitorViewModel`.
13. **Rewrite `src/presentation/features/driver/components/EnRouteToPickupView.tsx`,
    `AtPickupView.tsx`, `StartedView.tsx` (driver-side)**,
    `PaymentRequestedView.tsx`. The header chat button on the
    driver side IS new code. See `EnRouteToPickupView.tsx:29`
    comment "header chat button is deferred to Phase 9 polish"
    — that's this turn. Mount `<HeaderIconButton label="Open
chat" onPress={onPressChat}>` with the chatbubble icon +
    unread dot, plumbed in from
    `useDriverMonitorViewModel.onPressChat` (new).
14. **Rewrite `src/presentation/features/driver/view-models/useDriverMonitorViewModel.ts`**.
    No chat wiring exists on the driver side at all — neither
    the `ObserveLatestMessage` subscription nor an
    `onPressChat` handler. Add both, mirroring the rider VM at
    lines 146-162 + 250-257. The unread dot for the driver
    compares `latestMessage.createdAt` against the DRIVER'S
    `lastReadAt` (the same shared `useChatUiStore.lastReadAt`,
    since only one role views a given trip's chat from a given
    device).
15. **Rewrite `src/data/repositories/FirestoreRideRepository.ts`
    line 219** — the `merge: true` comment that mentions
    `lastSeenByRiderAt`. This is your evidence chain for why
    writes against parent trip docs MUST use `merge: true` so
    chat-driven `lastSeenBy*` writes don't clobber unrelated
    ride state. Same pattern for the new `MarkMessagesRead`
    repository method.
16. **Rewrite `src/data/dto/RideDoc.ts` `RideDocSchema`**. Look
    for the `permissive parse` region (Turn 7 added
    `schedulePickupAt` here). Add `lastSeenByRiderAt?:
TimestampAccepter | null` and `lastSeenByDriverAt?:
TimestampAccepter | null` as optional read fields. Not used
    by the domain `Ride` entity directly (chat does its own
    read), but the rewrite DOES read ride docs in many places —
    keeping the DTO permissive on the fields legacy writes is
    standard data-co-existence hygiene.
17. **Rewrite `src/presentation/di/container.ts`**. Single
    composition root. The pattern for adding a new repository:
    `import { ChatRepository } from
'@domain/repositories/ChatRepository'`, then in
    `buildContainer()` swap on `isFirebaseConfigured()` and
    lazy-`require()` the real adapter or the in-memory fake.
    Add three new use cases to `UseCases`:
    `observeChatMessages`, `sendChatMessage`, `markMessagesRead`.
    Rewrite the body of `observeLatestMessage` (the use case
    instance stays; only the repo it's constructed against
    changes).
18. **Rewrite `src/presentation/AppContent.tsx`** + foreground
    notification handler (search
    `addNotificationReceivedListener`). The foreground listener
    needs to read `useChatUiStore.openRideId` and SKIP showing a
    Toast for a `chat_message` push whose `tripId` matches the
    open chat. Today there's no explicit foreground
    `chat_message` handler — the `expo-notifications` default is
    to show OS-level banner if app is foregrounded (depends on
    `handleNotification` registration). Confirm via grep what
    the rewrite's foreground policy is today; if there's no
    foreground-banner code path for chat, you only need to make
    sure the in-app Toast (if added) is gated on
    `openRideId !== msg.tripId`. **Pre-checklist item 6
    captures the verification.**
19. **`jest.setup.ts`** — globally mocks `Stripe`,
    `BackgroundGeolocation`, `NavigationSdk`, `Crashlytics`.
    Add a `react-native-gifted-chat` mock here so VM/screen
    tests don't load the native bridge. Pattern: render a stub
    `<View testID="mock-gifted-chat"/>` and expose the
    `onSend`/`messages` props via the testID. See the existing
    Stripe mock for shape.
20. **`docs/PHASE_10_TURN_7_KICKOFF.md`** — pattern reference
    for this kickoff doc. Same pre-checklist / decisions /
    sign-off / native-rebuild flow. Test policy unchanged
    (100% on use cases, >80% on repositories with fakes,
    screen-level VM tests against fakes).
21. **`CLAUDE.md` §"Code conventions" — Subscription-shaped use
    cases, Result over throw, Branded IDs, Logging.** Chat
    surfaces touch every one of these. `SendChatMessage`
    returns `Result<ChatMessage, ValidationError | NetworkError>`.
    `ObserveChatMessages` returns synchronous unsubscribe (NEVER
    a Promise — explicit legacy footgun fix). All IDs branded.
    `LOG.extend('CHAT')` for logging.
22. **`CLAUDE.md` §"SDK seams" + §"Single-call SDK escape
    hatch"** —
    `react-native-gifted-chat` is a UI component, not an SDK
    seam. It renders the chat list and the input row; the
    Firestore reads/writes flow through `ChatRepository` (the
    seam). The `GiftedChat` import lives inside the
    `ChatModal.tsx` component file; consuming view-models call
    use cases, not GiftedChat. This is consistent with how
    `MapView` works in the rewrite — UI library import
    contained to the component file.
23. **`docs/PATTERNS.md`** — feature-area patterns. The
    rider-monitor / driver-monitor split is the relevant
    precedent. Read for how chat-open state should plumb
    through the VMs without leaking into the view components.

## Starting state — what's already true

- **HEAD** on `main` = post-Turn-7 (whatever SHA Turn 7 closed
  on; resolve at pre-checklist time via
  `git rev-parse HEAD`). Working tree clean modulo any sandbox
  `.lock` files (`find .git -name '*.lock' -delete` if needed).
- The 21 jest failures in
  `src/data/services/__tests__/BackgroundGeolocationClient.test.ts`
  remain Turn 9 scope — DO NOT fix here.
- `ChatMessage` entity, `ObserveLatestMessage` use case (stub),
  `useChatUiStore` (open/closed + lastReadAt) all ship.
- `HandleNotificationResponse` already routes `chat_message`
  tap → rider/driver monitor (verified via
  `HandleNotificationResponse.test.ts`).
- `onMessageCreated` Cloud Function is already deployed and
  active on both stage and prod — meaning the moment the
  rewrite writes a message doc with the canonical shape, the
  OTHER party gets a push. No server-side work in scope.
- `useRideMonitorViewModel` already subscribes to
  `ObserveLatestMessage` and computes `hasUnreadMessages` — the
  rendering side just isn't wired to a real chat thread yet.
- `useDriverMonitorViewModel` has NO chat wiring — adding it is
  in scope.
- `useChatUiStore.isOpen` is the Phase 3 flag; the foreground
  push suppression contract needs a richer `openRideId` so the
  handler can match `msg.tripId === openRideId`.
- `RideDoc` schema doesn't accept `lastSeenByRiderAt` /
  `lastSeenByDriverAt`. Optional read additions are
  zero-domain-impact.
- `react-native-gifted-chat` is NOT in `package.json` and NOT
  in `jest.setup.ts`. Both adds are required.
- `app.config.ts` does NOT list a gifted-chat plugin (the
  library has no Expo config plugin — it's a JS-only
  component). No native config change required.
- `firestore.rules` — the rewrite does NOT ship a rules file
  (shared legacy `yeapp-stage` project per data co-existence
  decision; cutover-plan §3.4 keeps indexes / rules unchanged).
  Legacy `yeride/firestore.rules` lines covering
  `trips/{tripId}/messages/{messageId}` already gate writes to
  passenger/driver of the trip. Verify pre-checklist item 9.

## Scope — what to ship

Land in one commit so partial state doesn't reach `main`. Six
layers, bottom-up:

### A. Domain — `ChatMessage` factory + `ChatRepository` interface

- **`src/domain/entities/ChatMessage.ts`** — convert from a
  read-only interface to a class. Private constructor + `static
create(props)` factory returning `Result<ChatMessage,
ValidationError>`. Validation:
  - `text` after `.trim()` non-empty and length ≤ 1000.
    Reject empty / whitespace-only with
    `ValidationError({code: 'chat_message_empty_text', field: 'text'})`.
    Reject overlong with
    `ValidationError({code: 'chat_message_text_too_long', field: 'text'})`.
  - `senderId` is a branded `UserId` (created upstream via
    `UserId.create`).
  - `createdAt` is a valid `Date` (reject NaN-Date).
  - `readAt` is `Date | null`.
  - Adds a `markRead(at: Date): ChatMessage` method (immutable
    evolve — returns a new entity with `readAt: at`).
  - Add `ChatMessageId.create(raw: string): Result<…>` symmetric
    with existing brand-id factories.
- **`src/domain/entities/__tests__/ChatMessage.test.ts`** — new
  test file. Cover: happy-path construction; empty/whitespace
  rejection; overlong rejection; NaN-Date rejection;
  `markRead(at)` returns new instance with `readAt: at`.
- **`src/domain/repositories/ChatRepository.ts`** — new
  interface:
  ```ts
  export interface ChatRepository {
    observeMessages(args: {
      rideId: RideId;
      callback: (messages: readonly ChatMessage[]) => void;
    }): () => void;

    observeLatestMessage(args: {
      rideId: RideId;
      callback: (message: ChatMessage | null) => void;
    }): () => void;

    send(args: {
      rideId: RideId;
      sender: { id: UserId; name: string };
      text: string;
    }): Promise<Result<ChatMessage, ValidationError | NetworkError>>;

    markMessagesRead(args: {
      rideId: RideId;
      role: 'rider' | 'driver';
    }): Promise<Result<void, ValidationError | NetworkError>>;
  }
  ```
  Subscription-shaped reads (synchronous unsubscribe), Result
  on writes. Re-export from
  `src/domain/repositories/index.ts`.

### B. Data — DTO, mapper, Firestore adapter, in-memory fake

- **`src/data/dto/ChatMessageDoc.ts`** — Zod schema accepting:
  - Required: `text: string`, `senderId: string`, `createdAt:
TimestampAccepter` (use the helper from `RideDoc` for
    Timestamp / ISO string / null coercion — see Turn 7's
    `SchedulePickupAtSchema` for the canonical duck-type-by-
    `toDate`+`seconds` pattern). Reject docs missing any of
    these.
  - Optional: `user?: {_id: string, name: string} | null`,
    `_id?: string` (legacy `GiftedChat`-id mirror). The
    `user.name` field flows through to the Cloud Function for
    the push title — write it on every send.
  - On read, ignore extra unrecognized fields (legacy permissive
    pattern).
- **`src/data/mappers/chatMessageMapper.ts`** — `toDomain(doc:
ChatMessageDoc, id: string): Result<ChatMessage,
ValidationError>` + `toDoc(msg: { rideId, senderId,
senderName, text, createdAtServerTimestamp })`. Read path
  feeds `ChatMessage.create` (so DTO accept stays permissive but
  domain rules still apply). Write path emits the canonical
  legacy shape:
  ```ts
  {
    _id: messageDocId,
    text,
    senderId,
    createdAt: serverTimestamp(),
    user: { _id: senderId, name: senderName },
  }
  ```
  Note `createdAt` MUST be `firestore.FieldValue.serverTimestamp()`
  (the Cloud Function's order semantics depend on the server
  clock, not the client clock). The `_id` field is set client-
  side via `doc(...).id` BEFORE the add, so the message can be
  optimistically inserted into the gifted-chat list.
- **`src/data/dto/__tests__/ChatMessageDoc.test.ts`** — round-trip,
  Timestamp acceptance, ISO acceptance, missing-field rejection,
  duck-type Timestamp acceptance.
- **`src/data/repositories/FirestoreChatRepository.ts`** —
  implements `ChatRepository`:
  - `observeMessages({rideId, callback})`: `onSnapshot` on
    `trips/{rideId}/messages` `orderBy('createdAt', 'desc')`.
    Map each doc via `chatMessageMapper.toDomain`; skip
    corrupt-doc-shaped reads via `toDomainOrCorrupt` (existing
    helper in `FirestoreRideRepository`). Error → emit `[]` +
    `logger.warn`.
  - `observeLatestMessage({rideId, callback})`: same query with
    `.limit(1)`; emit `null` on empty, `ChatMessage` on hit.
  - `send({rideId, sender, text})`: pre-validate via
    `ChatMessage.create(...)` (catch overlong / empty before
    Firestore). On success, `add()` the canonical doc shape;
    return the constructed `ChatMessage`. Wrap network errors
    in `NetworkError`.
  - `markMessagesRead({rideId, role})`: `update()` on
    `trips/{rideId}` with `{[field]:
serverTimestamp()}` where `field` is
    `'lastSeenByRiderAt' | 'lastSeenByDriverAt'`. Validate
    `role` ∈ {rider, driver} — `ValidationError({code:
'chat_invalid_role'})` otherwise. Network failures →
    `NetworkError`. Use `merge: true` semantics implicitly via
    `update()` (only the field changes).
- **`src/data/repositories/__tests__/FirestoreChatRepository.test.ts`**
  — mock the Firestore SDK (existing pattern, see
  `FirestoreRideRepository.test.ts`). Cover: observeMessages
  delivery / order / unsubscribe; observeLatestMessage with
  empty / hit; send canonical shape includes `_id`, `text`,
  `senderId`, `createdAt: serverTimestamp()`, `user`; send
  validation rejects empty + overlong; markMessagesRead writes
  correct field per role; markMessagesRead rejects invalid role.
- **`src/shared/testing/InMemoryChatRepository.ts`** — implements
  `ChatRepository`. Internal `Map<RideId,
ChatMessage[]>` + observer Set. `send` constructs a
  `ChatMessage` synchronously, appends, notifies observers.
  `markMessagesRead` no-ops successfully (test fake — assertions
  via `getMarkReadCallsFor(rideId, role)` accessor).
  `observeMessages` and `observeLatestMessage` emit current
  state synchronously on subscribe (Firestore `onSnapshot`
  parity). Mirrors `InMemoryRideRepository.ts` patterns.
- **`src/shared/testing/__tests__/InMemoryChatRepository.test.ts`**
  — initial empty emit; send notifies all observers; markRead
  tracks calls; unsubscribe stops delivery; reset clears state.
- **Optional read additions to `RideDoc` DTO + tests** for
  `lastSeenByRiderAt` / `lastSeenByDriverAt` as
  `TimestampAccepter | null | undefined`. **NOT** plumbed
  through to the `Ride` domain entity (no domain rule reads
  them); just keeping `RideDocSchema` permissive on legacy
  fields.

### C. App — use cases

- **`src/app/usecases/ride/ObserveChatMessages.ts`** — new.
  Subscription-shaped:
  ```ts
  execute(args: {
    rideId: RideId;
    callback: (messages: readonly ChatMessage[]) => void;
  }): () => void {
    return this.chats.observeMessages(args);
  }
  ```
- **`src/app/usecases/ride/SendChatMessage.ts`** — new.
  Request/response:
  ```ts
  execute(args: {
    rideId: RideId;
    sender: { id: UserId; name: string };
    text: string;
  }): Promise<Result<ChatMessage, ValidationError | NetworkError>>;
  ```
  Pre-validate `text.trim()` non-empty / length ≤ 1000 in the
  use case as well (defense in depth — the entity also
  validates). Delegate to `chats.send(args)`.
- **`src/app/usecases/ride/MarkMessagesRead.ts`** — new.
  ```ts
  execute(args: {
    rideId: RideId;
    role: 'rider' | 'driver';
  }): Promise<Result<void, ValidationError | NetworkError>>;
  ```
  Delegates to `chats.markMessagesRead(args)`.
- **`src/app/usecases/ride/ObserveLatestMessage.ts`** — REWRITE
  the body. Replace the Phase 3 stub with
  `return this.chats.observeLatestMessage(args);`. Update the
  constructor to accept `chats: ChatRepository`. Update DI.
- **Tests:**
  - `ObserveChatMessages.test.ts` — new. Delivery on subscribe,
    re-emit on new send, unsubscribe stops, isolation across
    rides.
  - `SendChatMessage.test.ts` — new. Happy path, empty text
    rejection, overlong rejection, network failure wraps
    `NetworkError`.
  - `MarkMessagesRead.test.ts` — new. Invokes repo with correct
    role; rejects invalid role.
  - `ObserveLatestMessage.test.ts` — extend. Test it now
    delegates to repo (no longer the always-null stub).

### D. DI wiring (`src/presentation/di/container.ts`)

- Add `ChatRepository` import.
- Add `observeChatMessages: ObserveChatMessages`,
  `sendChatMessage: SendChatMessage`,
  `markMessagesRead: MarkMessagesRead` to the `UseCases`
  interface.
- In `buildContainer()`, lazy-require
  `FirestoreChatRepository` when `isFirebaseConfigured()`;
  `InMemoryChatRepository` otherwise. Construct each use case
  over the chosen instance. Update the existing
  `observeLatestMessage` construction to pass the same repo
  instance.

### E. Presentation — chat surface

- **`src/presentation/components/chat/ChatModal.tsx`** — new.
  Typed port of legacy `ChatModal.js`. Props:
  ```ts
  interface ChatModalProps {
    visible: boolean;
    onClose: () => void;
    rideId: RideId;
    userId: UserId;
    userName: string;
    role: 'rider' | 'driver';
  }
  ```
  Mounts `<GiftedChat/>` from `react-native-gifted-chat`. The
  message list flows in via a `useEffect` that calls
  `useCases.observeChatMessages.execute({rideId, callback:
setMessages})` and converts to gifted-chat's shape (`_id`,
  `text`, `createdAt`, `user: {_id, name}`). Send path:
  `onSend={(msgs) => useCases.sendChatMessage.execute({rideId,
sender, text: msgs[0].text})}`. On mount AND after every
  observe-emit, fires
  `useCases.markMessagesRead.execute({rideId, role})`. On
  mount sets `useChatUiStore.openRideId = rideId`; on unmount
  clears it iff it still matches (mirrors legacy lines 79).
  `Modal` mounted with `statusBarTranslucent` +
  `navigationBarTranslucent` (Android 15 edge-to-edge —
  CLAUDE.md rule). NativeWind semantic tokens — no raw hex
  (legacy uses `'#007BFF'` for the close button; replace with
  `text-primary`). `KeyboardAvoidingView` per legacy.
- **`src/presentation/components/chat/__tests__/ChatModal.test.tsx`**
  — render visibility gating, send fires `useCases.sendChatMessage`
  with expected args, mark-read fires on mount, close button
  invokes `onClose`, gifted-chat receives the mapped messages
  shape. Use the global mock from `jest.setup.ts`.
- **`src/presentation/features/rider/view-models/useRideMonitorViewModel.ts`**
  — extend:
  - Replace the `onPressChat` Toast stub (lines 250-257) with
    `setChatOpen(true)` + `useChatUiStore.open(rideId)` +
    fire-and-forget `useCases.markMessagesRead.execute(...)` +
    bump `useChatUiStore.markRead(new Date())` (local mirror
    for the unread-dot derivation).
  - Surface `chatOpen: boolean` and `closeChat()` on the VM
    output. The screen toggles the in-screen `<ChatModal/>` on
    `chatOpen`.
  - `hasUnreadMessages` memo (lines 146-162) — UNCHANGED. The
    derivation `latestMessage.createdAt >
useChatUiStore.lastReadAt` continues to work; `markRead(at)`
    bumps `lastReadAt` so the dot clears immediately on open.
- **`src/presentation/features/rider/screens/RideMonitorScreen.tsx`**
  — mount `<ChatModal visible={vm.chatOpen}
onClose={vm.closeChat} rideId={ride.id} userId={user.id}
userName={user.name} role="rider"/>` at the bottom of the
  screen tree (sibling to the status-router).
- **`src/presentation/features/driver/view-models/useDriverMonitorViewModel.ts`**
  — mirror the rider VM additions:
  - Add `latestMessage` subscription via
    `useFirestoreSubscription` over
    `useCases.observeLatestMessage.execute({rideId, callback})`.
  - Add `hasUnreadMessages` memo comparing
    `latestMessage.createdAt` against `useChatUiStore.lastReadAt`.
  - Add `onPressChat()` + `chatOpen: boolean` + `closeChat()`,
    symmetric with the rider VM.
- **`src/presentation/features/driver/screens/DriverMonitorScreen.tsx`**
  — mount `<ChatModal/>` with `role="driver"` symmetric to the
  rider mount.
- **Header chat button on driver-side views.** Add a
  `<HeaderIconButton label="Open chat" testID="<view>-chat"
onPress={onPressChat}>` with the chatbubble icon + unread
  dot to `EnRouteToPickupView.tsx`, `AtPickupView.tsx`,
  `StartedView.tsx` (driver-side), and `PaymentRequestedView.tsx`.
  Match the rider-side pattern in `StartedView.tsx:69-86`.
  Plumb `onPressChat` + `hasUnread` props from
  `useDriverMonitorViewModel` into these views (the views are
  already prop-driven).
- **Rider-side `DispatchedView.tsx`** — add the unread dot to
  the existing chat button (lines 73-78). The button is there;
  just plumb `hasUnread` prop in. The rider can already receive
  messages between dispatch and start.
- **`src/presentation/stores/useChatUiStore.ts`** — extend:
  - Add `openRideId: RideId | null` to state.
  - Modify `open()` → `open(rideId: RideId): void`. Sets
    `isOpen: true, openRideId: rideId`.
  - `close()` clears both.
  - Add selector `useChatOpenRideId(): RideId | null`.
  - Update docstring lines 4-22 — chat surface IS Phase 3.5 /
    Phase 10 Turn 8 now; remove the "coming soon" framing.
- **`src/presentation/features/rider/view-models/__tests__/useRideMonitorViewModel.test.tsx`**
  — replace the Toast assertion with a `setChatOpen(true)` +
  `markMessagesRead` invocation assertion. Use the
  `TestContainerProvider` to inject a fake `MarkMessagesRead`
  spy. Verify `useChatUiStore.openRideId` is set.
- **`src/presentation/features/driver/view-models/__tests__/useDriverMonitorViewModel.test.tsx`**
  — new chat describe block: subscription delivery, unread dot
  derivation, onPressChat opens modal + marks read.

### F. Foreground push-banner suppression

- **`src/presentation/AppContent.tsx`** (or wherever the
  foreground notification listener lives — search for
  `addNotificationReceivedListener` /
  `setNotificationHandler`). When a `chat_message` push arrives
  while the app is foregrounded AND
  `useChatUiStore.getState().openRideId === payload.tripId`,
  suppress the OS-level banner. Pattern:
  ```ts
  Notifications.setNotificationHandler({
    handleNotification: async (notif) => {
      const data = notif.request.content.data;
      if (data?.type === 'chat_message') {
        const openRideId = useChatUiStore.getState().openRideId;
        if (openRideId === data.tripId) {
          return { shouldShowBanner: false, shouldPlaySound: false, ... };
        }
      }
      return { shouldShowBanner: true, shouldPlaySound: true, ... };
    },
  });
  ```
  Verify the exact `setNotificationHandler` shape the rewrite
  uses today (Expo SDK 55 API surface — `shouldShowBanner` /
  `shouldShowList` replaced the deprecated `shouldShowAlert` in
  SDK 53+). Pre-checklist item 6.
- **Test** for the suppression branch — mock
  `useChatUiStore.getState()` and assert the handler returns
  the suppression shape when `openRideId === tripId`. Sibling
  to the existing notification handler test if one exists; else
  new test file.

### G. Native config

- **`package.json`** — add
  `"react-native-gifted-chat": "<pin>"` under `dependencies`.
  Pre-checklist item 4: confirm the latest version compatible
  with React 19 + RN 0.83.6 + Expo SDK 55. The gifted-chat
  README at https://github.com/FaridSafi/react-native-gifted-chat
  notes peer-deps; check there + npm for the pin (likely
  `2.10.2` or newer — confirm). Pin exactly (no `^`).
- **`jest.setup.ts`** — global mock for
  `react-native-gifted-chat`. Pattern:
  ```ts
  jest.mock('react-native-gifted-chat', () => {
    const RN = require('react-native');
    return {
      GiftedChat: (props: any) =>
        RN.createElement(RN.View, { testID: 'mock-gifted-chat', ...props }),
    };
  });
  ```
  Optionally expose the `messages` prop via a `data-messages`
  prop on the stub for assertions.
- **No `app.config.ts` plugin entry** — `react-native-gifted-chat`
  is pure JS, no Expo config plugin. Verify at pre-checklist
  item 5.
- **Native rebuild required IF** the package adds any native
  module. Per current README it does not, but the npm `install`
  may still trigger a podfile-lock refresh — run
  `npm run prebuild` after install to be safe.

### H. Tests

| Layer       | File                                                                                            | What it covers                                                                                                                                                              |
| ----------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Domain      | `src/domain/entities/__tests__/ChatMessage.test.ts`                                             | New: happy-path create; empty/whitespace-only rejection; overlong rejection; NaN-Date rejection; `markRead(at)` evolves immutably                                            |
| Data        | `src/data/dto/__tests__/ChatMessageDoc.test.ts`                                                 | New: Timestamp / ISO / missing-required-field handling; user-object acceptance; legacy `_id` mirror                                                                          |
| Data        | `src/data/mappers/__tests__/chatMessageMapper.test.ts`                                          | New: toDomain Result-success / Result-validation-error; toDoc emits canonical shape `_id` + `text` + `senderId` + `createdAt: serverTimestamp()` + `user.name`               |
| Data        | `src/data/repositories/__tests__/FirestoreChatRepository.test.ts`                               | New: observeMessages delivery + order + unsubscribe; observeLatestMessage empty/hit; send canonical shape; send validates pre-flight; markMessagesRead writes correct field |
| Data        | `src/data/dto/__tests__/RideDoc.test.ts`                                                        | Extend: `lastSeenByRiderAt` / `lastSeenByDriverAt` accept Timestamp / ISO / missing / null                                                                                  |
| Shared/test | `src/shared/testing/__tests__/InMemoryChatRepository.test.ts`                                   | New: empty initial emit; send notifies observers; markRead tracked; unsubscribe stops; reset clears                                                                          |
| App         | `src/app/usecases/ride/__tests__/ObserveChatMessages.test.ts`                                   | New: subscription delivery; re-emit on send; cross-ride isolation                                                                                                            |
| App         | `src/app/usecases/ride/__tests__/SendChatMessage.test.ts`                                       | New: happy path returns Result.ok with constructed ChatMessage; empty/overlong reject with ValidationError; repo NetworkError wraps as use case NetworkError                |
| App         | `src/app/usecases/ride/__tests__/MarkMessagesRead.test.ts`                                      | New: invokes repo with correct role; rejects invalid role                                                                                                                    |
| App         | `src/app/usecases/ride/__tests__/ObserveLatestMessage.test.ts`                                  | Extend: now delegates to repo (not the null stub); cross-ride isolation                                                                                                      |
| Component   | `src/presentation/components/chat/__tests__/ChatModal.test.tsx`                                 | New: visibility, observeMessages subscription, send fires use case, mark-read fires on mount, close button invokes onClose, gifted-chat mock receives mapped messages       |
| VM          | `src/presentation/features/rider/view-models/__tests__/useRideMonitorViewModel.test.tsx`        | Extend: replace Toast assertion with chatOpen + markMessagesRead invocation + useChatUiStore.openRideId set                                                                  |
| VM          | `src/presentation/features/driver/view-models/__tests__/useDriverMonitorViewModel.test.tsx`     | Extend: chat subscription, unread dot, onPressChat opens modal + marks read                                                                                                  |
| Screen      | `src/presentation/features/driver/components/__tests__/EnRouteToPickupView.test.tsx` etc.       | Extend each affected driver view: chat button renders, unread dot renders when `hasUnread`, tap fires `onPressChat`                                                          |
| Hook        | `src/presentation/hooks/__tests__/useNotificationResponseHandler.test.tsx` (or sibling)         | New describe block: foreground `chat_message` handler suppresses banner when `useChatUiStore.openRideId === tripId`; shows banner otherwise                                  |

**Target pass count: ~60-80 new tests, zero regressions outside
the 21 pre-existing BG-geolocation failures.**

## Decisions to lock at kickoff time

### Decision 1 — Chat surface: modal vs full screen?

- **(a) `<ChatModal/>` mounted inside RideMonitor / DriverMonitor**
  (legacy parity). Visibility gated by VM state. No navigator
  entry. Disappears with the trip-monitor when the trip closes.
- **(b) `ChatScreen` route on the rider / driver stack.**
  Deep-linkable. Survives navigation state restoration. Adds
  two `RideChat` route entries (`RiderStackParamList`,
  `DriverStackParamList`).

Kickoff recommends **(a)** — matches legacy 1:1, simpler diff,
chat is a transient overlay over the trip surface, not a
freestanding destination. Push deep links route to RideMonitor
or DriverMonitor (HandleNotificationResponse already does this);
the chat modal pops on arrival via a `useChatUiStore.isOpen`
selector pre-set by the response handler (small extra wiring
documented below).

### Decision 2 — Chat library: `react-native-gifted-chat` vs custom port

- **(a) `react-native-gifted-chat`** (legacy). Battle-tested,
  same UX, ~3kb diff in package.json. Mocked in `jest.setup.ts`.
- **(b) Custom `FlatList`-based thread.** No dep. More code,
  more bugs, marginal benefit. Don't do this without a
  compelling reason.

Kickoff recommends **(a)**. The library is small, actively
maintained, and is the legacy choice. Confirm peer-deps at
pre-checklist item 4.

### Decision 3 — Read-state storage: server-side parent doc, local store, or both?

- **(a) Server-side only** — write
  `trips/{tripId}.lastSeenByRiderAt` / `lastSeenByDriverAt`
  via `MarkMessagesRead`. Unread dot reads via a parent-doc
  subscription comparing the OTHER party's `lastSentAt` vs my
  `lastSeenAt`.
- **(b) Client-side only** — `useChatUiStore.lastReadAt`
  drives the dot via the existing
  `latestMessage.createdAt > lastReadAt` memo.
- **(c) Both.** Server-side write happens for the OTHER party's
  benefit (legacy parity — the OTHER party's UI reads
  `lastSeenByRiderAt|lastSeenByDriverAt` to clear THEIR badge);
  client-side mirror in `useChatUiStore` clears MY local dot
  optimistically (no round-trip latency).

Kickoff recommends **(c)** — legacy is effectively (c) already
(legacy `ChatModal.js:58-60,72-74` writes the parent-doc
field on mount + every snapshot; legacy `RideMonitor.js` also
clears its local unread flag on chat-open for instant UX). The
two write paths serve different consumers; both are required.

### Decision 4 — Foreground push-banner suppression: module-scoped ref vs Zustand selector

- **(a) Module-scoped `openChatId` ref** in `ChatModal.tsx`
  exported via a getter (legacy line 19). The foreground push
  handler imports the getter.
- **(b) Zustand `useChatUiStore.openRideId`** read via
  `useChatUiStore.getState().openRideId` inside the handler.
  No module-scoped state.

Kickoff recommends **(b)** — the rewrite's idiom is Zustand for
client UI state. The module-scoped ref is a legacy footgun (two
fast open/close races require the cleanup-iff-match guard at
legacy line 79 to avoid wiping a freshly-opened chat). Zustand
gives us `setState` semantics + selectable subscriptions for
test ergonomics.

### Decision 5 — `ChatRepository.observeMessages` shape: subscription vs paginated query

- **(a) Subscription `observeMessages`** — `onSnapshot` over
  the messages subcollection. Real-time delivery. Memory
  footprint = full thread.
- **(b) Paginated `listMessages`** — cursor-based, fetch on
  demand. Lower memory for huge threads.

Kickoff recommends **(a)** — chat is a live surface; threads on
this product are short (rider ↔ driver, single trip window,
typically <10 messages). The legacy implementation uses
`onSnapshot` without pagination and has never complained. If
volume forces (b), defer to a polish turn.

### Decision 6 — `ChatMessage.text` length cap

- **(a) ≤ 1000 chars** — generous for chat, matches the Cloud
  Function's 120-char *truncation for push body* but not the
  storage limit (server stores the full text; push truncates).
- **(b) ≤ 5000 chars** — accommodates dictation-driven long
  paragraphs.

Kickoff recommends **(a)**. Riders/drivers exchange short
location-and-status notes, not essays. Reject overlong at the
entity level. Document the cap in the
`chat_message_text_too_long` error code.

### Decision 7 — Driver-side header chat button placement

Driver-side views currently have NO chat button. Add to:

- **(a) All active-trip statuses** (`EnRouteToPickupView`,
  `AtPickupView`, `StartedView` driver-side,
  `PaymentRequestedView`). Mirrors rider-side
  (dispatched / started / payment_requested) parity.
- **(b) Only `EnRouteToPickupView` / `AtPickupView` /
  `StartedView` (driver)** — skip `PaymentRequestedView`
  because chat at that point is academic.

Kickoff recommends **(a)** — payment-failed scenarios may want
chat (driver asks rider for alternative payment, etc.).
Vanishingly cheap to render the button; high benefit if a corner
case hits.

### Decision 8 — Foreground push handler refactor: in this turn or deferred?

The rewrite may not currently have a registered
`setNotificationHandler` for foreground behavior at all (it may
rely on `expo-notifications` defaults). Adding one is required
for Decision 4 (b) to suppress the banner. Pre-checklist item 6
captures the verification:

- If a handler exists, modify in scope here.
- If no handler exists, add one in scope here — the suppression
  is the whole point.

Kickoff recommends **in-scope** — small enough (~30 lines + test),
and the suppression is part of the audit §3.4 verdict per row 677.

## Pre-checklist

Resolve in your first message back if not already settled.

1. **Confirm HEAD SHA + working tree state.**
   ```bash
   cd /Users/papagallo/yeapptech/dev/yeride-mobile && git rev-parse HEAD && git status --short
   ```
   Expected: HEAD = post-Turn-7 SHA; working tree clean modulo
   `.git/*.lock` files
   (`find .git -name '*.lock' -delete` if needed).

2. **Confirm rewrite gap is as described.**
   ```bash
   grep -rn 'ChatRepository\|SendChatMessage\|MarkMessagesRead\|ObserveChatMessages\|FirestoreChatRepository\|InMemoryChatRepository\|GiftedChat\|ChatModal' src/
   ```
   Expected zero matches outside the kickoff-cited stub paths
   (`ChatMessage.ts`, `ObserveLatestMessage.ts`,
   `useChatUiStore.ts`, the rider VM's `onPressChat` Toast,
   header docstrings).

3. **Confirm `react-native-gifted-chat` absence.**
   ```bash
   grep -n 'react-native-gifted-chat' package.json
   ```
   Expected: no matches. If present, note the pin.

4. **Pin `react-native-gifted-chat` for Expo SDK 55 / React 19 /
   RN 0.83.6.** Latest stable is likely `2.10.2` or newer;
   confirm against the package's README and npm `dist-tags`:
   ```bash
   npm view react-native-gifted-chat versions --json | tail -n 30
   npm view react-native-gifted-chat peerDependencies
   ```
   Document the chosen pin in the turn doc.

5. **Confirm no native config required.**
   ```bash
   ls node_modules/react-native-gifted-chat/app.plugin.js 2>/dev/null
   ```
   Expected absent — pure-JS library. No `app.config.ts`
   plugin entry to add.

6. **Audit current foreground notification handler.**
   ```bash
   grep -rn 'setNotificationHandler\|addNotificationReceivedListener\|shouldShowBanner\|shouldShowAlert' src/
   ```
   Note presence/absence + the Expo SDK 55 API shape
   (`shouldShowBanner` + `shouldShowList`, not the deprecated
   `shouldShowAlert`).

7. **Confirm Cloud Function is deployed and active.**
   ```bash
   grep -n 'onMessageCreated\|message-created' \
     /Users/papagallo/yeapptech/dev/yeride-functions/functions/index.js
   ```
   Expected: function exported + active on stage/prod. No
   server-side work in this turn — just confirm the trigger
   exists.

8. **Confirm legacy line counts** (sanity-check the kickoff
   citations).
   ```bash
   wc -l /Users/papagallo/yeapptech/dev/yeride/src/components/ChatModal.js \
         /Users/papagallo/yeapptech/dev/yeride/src/components/ChatTouchable.js \
         /Users/papagallo/yeapptech/dev/yeride-functions/functions/handlers/message-created.js
   ```
   Expected 191 / 25 / 60 (kickoff §"Context"). Catch a moved
   file at kickoff time, not at port time.

9. **Firestore rules parity.** Read
   `/Users/papagallo/yeapptech/dev/yeride/firestore.rules` for
   the `trips/{tripId}/messages/{messageId}` block. Confirm:
   - Read allowed for `passenger.id` and `driver.id` of the
     parent trip.
   - Write (create only — no edits / deletes) allowed for the
     same set, with `senderId == request.auth.uid` constraint.
   - Parent-trip-doc `lastSeenByRiderAt` /
     `lastSeenByDriverAt` writes allowed for the matching role.
   No rule changes in scope (rewrite ships against legacy
   yeride's rules in shared `yeapp-stage`); just verify so we
   don't ship a write the existing rules reject.

10. **Decide Decisions 1-8 + capture evidence chain.**

11. **Optional — manual smoke check.** With stage Firebase
    wired up: post-Turn screenshot of `RideMonitorScreen` with
    the chat button + unread dot, the modal open with a
    multi-message thread, and the corresponding
    `DriverMonitorScreen` view. Skip if no second device handy.

## Suggested approach

1. **Pre-checklist first.** Items 1-11. Decisions 1-8 captured
   in the turn doc with evidence chain.

2. **Land changes bottom-up (domain → data → app →
   presentation → push-handler → native config).**
   - Domain: `ChatMessage` factory + validation + tests;
     `ChatRepository` interface.
   - Data: `ChatMessageDoc` DTO + `chatMessageMapper` +
     `FirestoreChatRepository` + `InMemoryChatRepository`
     + tests. Optional `RideDoc` accepter additions for
     `lastSeenBy*` fields.
   - App: `ObserveChatMessages` + `SendChatMessage` +
     `MarkMessagesRead` + rewrite `ObserveLatestMessage`
     body + tests. Wire all four through DI.
   - Presentation:
     - Extend `useChatUiStore` (`openRideId`,
       `open(rideId)`).
     - `ChatModal.tsx` + tests.
     - Extend `useRideMonitorViewModel` (`chatOpen`,
       `closeChat`, replace Toast stub) + tests.
     - Extend `useDriverMonitorViewModel` (chat subscription,
       unread dot, `onPressChat`, `chatOpen`, `closeChat`) +
       tests.
     - Mount `<ChatModal/>` on `RideMonitorScreen` and
       `DriverMonitorScreen`.
     - Add header chat button to driver-side views
       (`EnRouteToPickupView`, `AtPickupView`,
       driver-`StartedView`, `PaymentRequestedView`).
     - Add the unread dot to rider-side `DispatchedView`.
   - Push handler: register / extend
     `setNotificationHandler` to suppress `chat_message`
     banner when `useChatUiStore.openRideId ===
payload.tripId` + test.
   - Native: `react-native-gifted-chat` pin in
     `package.json` + global mock in `jest.setup.ts`.
     `npm install` + `npm run prebuild` (gifted-chat is
     pure JS — likely no podfile churn).

3. **Verify gates.**
   ```bash
   cd /Users/papagallo/yeapptech/dev/yeride-mobile
   npm run typecheck     # green
   npm run lint          # green
   npm run format:check  # green (modulo pre-existing CLAUDE.md
                         #  prettier warning)
   npm test              # only the 21 BG-geolocation failures
                         #  (Turn 9)
   ```
   Use `--shard=N/M` if jest times out in the sandbox.

4. **Audit + turn doc updates.**
   - §1 headline count: flip `2 ❌ / 0 🟡` → `1 ❌ / 0 🟡`.
   - §3.4 row: ❌ → ✅ with Turn 8 closure note + chosen
     decisions 1-8.
   - §6 row 677 (`chat_message` banner suppression):
     ❌ → ✅ with Turn 8 reference.
   - §6 row 695 (`trips/{tripId}/messages`): ❌ → ✅.
   - §8 turn-plan row 8: strike-through with close date +
     doc reference.
   - Header sublabel: append "Turn 8 closed YYYY-MM-DD"
     (still v2 — Turn 10 produces v3).
   - Write `docs/PHASE_10_TURN_8.md` following Turn 7's
     format. Expect 18-25 changed files (3 domain, 5 data,
     5 app, 8 presentation, 1 push handler, 2 native config,
     ~12 tests).

5. **Commit.** Sandbox commit pattern
   (`memory/sandbox_git_commit_pattern.md`) — virtiofs blocks
   `git commit`'s `unlink()` on lockfiles after the first
   write, so:
   ```bash
   cp .git/index /tmp/shadow
   GIT_INDEX_FILE=/tmp/shadow git add -A
   GIT_INDEX_FILE=/tmp/shadow git write-tree
   git commit-tree <tree> -p HEAD -m "<msg>"
   git update-ref refs/heads/main <commit>
   ```

## Out of scope (defer to later turns)

- **BG-geolocation test regression** — Turn 9 (audit §10.1).
- **Audit v3 + cutover sign-off** — Turn 10.
- **Chat read-receipts UI** (per-message "seen by other") —
  legacy doesn't render them; the `lastSeenBy*` write is
  audited for the unread-dot story only. If we ever want a
  per-message "delivered/read" rail, that's its own turn.
- **Image / attachment messages.** Legacy is text-only; match
  parity. Stripping gifted-chat's image-upload affordance is
  fine via props.
- **Typing indicators.** Same — legacy doesn't ship them.
- **Per-trip chat history retention policy.** Legacy retains
  forever (no TTL). Match parity. Lifecycle deletion is a
  privacy-policy decision out of scope here.
- **Driver-side `useDriverActivityViewModel` chat affordance.**
  Closed trips don't show chat (the thread is gone with the
  trip from the UI's POV). If product wants a "view closed
  chat" mode, that's a future turn.
- **Picker UX polish for raw chat (image attachments, voice
  messages, GIFs).** All defer; text-only matches legacy.
- **In-app banner UI** (legacy `InAppNotification.js`).
  The audit §6 row 674 already calls it 🟡 — the rewrite's
  current foreground policy is OS-default. The chat-message
  suppression flows through `setNotificationHandler` even
  without a custom banner — when the rewrite eventually
  ports an in-app banner UI, it'll read the same
  `useChatUiStore.openRideId` signal. Don't grow the
  in-app-banner UI scope here.
- **Composite Firestore index** for chat messages — the
  `messages` subcollection ordered by `createdAt desc` doesn't
  need a composite index (Firestore auto-creates the
  single-field descending index). Skip.
- **Detox E2E** for chat flows — covered by
  `PHASE_10_CUTOVER_PLAN.md` §3.1.

## Deliverable

A single PR / commit on `main` containing:

1. **Domain**: `ChatMessage.create` factory + validation +
   `markRead(at)` evolve; `ChatRepository` interface
   (`observeMessages`, `observeLatestMessage`, `send`,
   `markMessagesRead`); tests.
2. **Data**: `ChatMessageDoc` DTO + mapper;
   `FirestoreChatRepository` adapter + `InMemoryChatRepository`
   fake; optional `RideDoc` `lastSeenBy*` accepters; tests.
3. **App**: `ObserveChatMessages` + `SendChatMessage` +
   `MarkMessagesRead` use cases; rewritten
   `ObserveLatestMessage` body; tests; DI wiring.
4. **Presentation — store**: extended `useChatUiStore`
   (`openRideId`, typed `open(rideId)`); selector hook.
5. **Presentation — component**: `ChatModal.tsx` wrapping
   `GiftedChat`; mounts observeMessages + sendChatMessage +
   markMessagesRead use cases; sets/clears
   `useChatUiStore.openRideId` on mount/unmount; tests.
6. **Presentation — view-models**: extended
   `useRideMonitorViewModel` (real `onPressChat` + `chatOpen`
   + `closeChat`); new chat wiring on
   `useDriverMonitorViewModel`; tests.
7. **Presentation — screens**: `<ChatModal/>` mounted on
   `RideMonitorScreen` + `DriverMonitorScreen`; header chat
   button added to driver-side views + unread dot added to
   rider-side `DispatchedView`; component-level tests.
8. **Foreground push suppression**: extend / register
   `setNotificationHandler` to skip `chat_message` banners
   when the suppression condition matches; test.
9. **Native config**: `react-native-gifted-chat` pin in
   `package.json`; global mock in `jest.setup.ts`;
   `npm install` + `npm run prebuild` clean.
10. **Tests**: ~60-80 new tests per §H. No regressions outside
    Turn 9's 21 carry-over BG-geolocation failures.
11. **Audit `docs/PHASE_10_PARITY_AUDIT.md`** — §1 count +
    bullet, §3.4 verdict, §6 row 677 + row 695, §8 turn plan
    row 8 strike-through, header sublabel append.
12. **`docs/PHASE_10_TURN_8.md`** documenting:
    - Pre-checklist outcomes (HEAD SHA, gap-confirmation greps,
      package pin choice, foreground-handler audit findings,
      Cloud Function deployment confirmation, legacy line-count
      verification, Firestore rules audit).
    - The eight decisions with evidence chain.
    - The patch diffs by layer.
    - Test additions and pass counts.
    - Acceptance criteria.
    - Out-of-scope list.

`npm run verify` should be green except the carry-over 21
BG-geolocation failures (Turn 9's job).

## Sign-off criteria

- [ ] Decisions 1-8 documented with the evidence that drove
      them.
- [ ] `ChatMessage.create(props)` returns
      `Result<ChatMessage, ValidationError>` with empty,
      whitespace-only, overlong, and NaN-Date rejection paths.
      `markRead(at)` returns a new immutable entity.
- [ ] `ChatRepository` interface ships with `observeMessages` /
      `observeLatestMessage` (subscription-shaped) and `send` /
      `markMessagesRead` (Result-returning Promise) methods.
- [ ] `FirestoreChatRepository` implements all four methods and
      writes the canonical legacy doc shape `{_id, text,
senderId, createdAt: serverTimestamp(), user: {_id,
name}}` on send.
- [ ] `InMemoryChatRepository` mirrors all four methods for
      tests.
- [ ] `ObserveChatMessages` + `SendChatMessage` +
      `MarkMessagesRead` use cases ship and route through DI.
- [ ] `ObserveLatestMessage` no longer stubs `null` — delegates
      to `repo.observeLatestMessage`.
- [ ] `ChatModal.tsx` mounts `<GiftedChat/>`, drives messages
      from `observeChatMessages`, sends via `sendChatMessage`,
      marks read on mount + per snapshot, sets / clears
      `useChatUiStore.openRideId`.
- [ ] `useRideMonitorViewModel.onPressChat` replaces the Toast
      stub with `setChatOpen(true)` + `markMessagesRead` +
      `useChatUiStore.open(rideId)` + local `markRead` mirror.
- [ ] `useDriverMonitorViewModel` gains the symmetric chat
      surface: subscription, unread dot, `onPressChat`,
      `chatOpen`, `closeChat`.
- [ ] Driver-side views (`EnRouteToPickupView`,
      `AtPickupView`, `StartedView` driver, optionally
      `PaymentRequestedView`) render the header chat button +
      unread dot.
- [ ] Rider-side `DispatchedView` renders the unread dot on
      its existing chat button.
- [ ] Foreground notification handler suppresses
      `chat_message` banners when
      `useChatUiStore.openRideId === payload.tripId`.
- [ ] `react-native-gifted-chat` added to `package.json` at a
      chosen pin; global mock in `jest.setup.ts`.
- [ ] New / updated tests per §H. ~60-80 new tests, no
      regressions outside Turn 9's 21 carry-overs.
- [ ] Audit §3.4 row flipped ❌ → ✅ with Turn 8 annotation.
- [ ] Audit §6 rows 677 + 695 flipped ❌ → ✅.
- [ ] Audit §1 headline count updated `2 ❌ / 0 🟡` →
      `1 ❌ / 0 🟡`.
- [ ] `docs/PHASE_10_TURN_8.md` written following Turn 7's
      structure.
- [ ] `npm run typecheck && npm run lint && npm run format:check`
      green (modulo the pre-existing `CLAUDE.md` Prettier
      warning); jest carries only the 21 pre-existing
      BG-geolocation failures.
- [ ] Commit landed on `main` via the sandbox commit pattern.

## Native rebuild

**Likely not required, but run a prebuild as belt-and-braces.**
`react-native-gifted-chat` is a pure-JS library — no Expo
config plugin, no native modules, no podfile changes. The
`npm install` + a clean `npm run prebuild` should produce no
diff under `ios/` / `android/`; if it does, investigate (most
likely transitive `react-native-parsed-text` or similar
shipping a native bridge).

```bash
npm install react-native-gifted-chat@<pin>
npm run prebuild   # expo prebuild --clean + scripts/patch-podfile.js
git status ios android   # expect clean
```

Smoke test after build:

1. Start a trip (rider creates, driver accepts → dispatched).
2. Rider taps chat header button. ChatModal opens.
3. Rider sends "On my way." Message lands in the thread
   instantly (optimistic insert by gifted-chat) and persists.
4. Driver receives a foreground push (or background-banner if
   backgrounded). Tap → `DriverMonitor` opens, chat modal
   reachable via header button.
5. Driver taps chat header button. Unread dot clears. Both
   messages visible. Driver sends a reply. Rider sees it live.
6. Confirm `trips/{tripId}/lastSeenByRiderAt` and
   `lastSeenByDriverAt` are populated in Firestore console.
7. With chat open on rider side, driver sends another message.
   No in-app banner appears on rider (suppression). Message
   appears in the open thread.
8. Close chat on rider. Driver sends a third. Banner appears
   on rider (no suppression — chat closed).
9. Verify legacy yeride can still chat with the rewrite —
   open the legacy build alongside the rewrite, run a thread
   end-to-end, confirm both directions of message flow and
   unread-dot derivation work.

---

**End of PHASE_10_TURN_8_KICKOFF.md.** Read top to bottom on a
new session and execute. Ask if any pre-checklist item surfaces
a blocker — especially if `react-native-gifted-chat` peer-deps
balk at React 19 / RN 0.83.6 (pre-checklist item 4), if the
rewrite already has a foreground notification handler with a
shape different from what kickoff §F sketches (pre-checklist
item 6), or if the legacy `firestore.rules` block for
`trips/{tripId}/messages/{messageId}` rejects the write shape
the new `FirestoreChatRepository.send` emits (pre-checklist
item 9). Each of those is a wiring decision that comes BEFORE
the screen-side work.
