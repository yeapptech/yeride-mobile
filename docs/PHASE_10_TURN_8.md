# Phase 10 Turn 8 — Chat (in-trip rider ↔ driver messaging)

**Closed:** 2026-05-19
**Predecessor:** [PHASE_10_TURN_7.md](PHASE_10_TURN_7.md)
**Kickoff:** [PHASE_10_TURN_8_KICKOFF.md](PHASE_10_TURN_8_KICKOFF.md)

## Why

Audit §3.4 was the larger of the two remaining ❌ rows blocking the
cutover plan §6 staged rollout. Legacy yeride ships a full
bidirectional chat (`ChatModal.js` wraps `react-native-gifted-chat`,
writes to `trips/{tripId}/messages`, sets `lastSeenBy*` on the
parent doc, drives the foreground-banner-suppression signal from a
module-scoped `openChatId` ref). The rewrite shipped Phase 3
infrastructure — `ChatMessage` entity, `ObserveLatestMessage` stub,
`useChatUiStore` — but no live thread, no send/markRead use cases,
no `ChatRepository`, no foreground push handler. Phase 3.5 never
happened; the work moved here.

This turn closes the gap end-to-end. The headline audit count flips
`2 ❌ → 1 ❌`; only §10.1 BG-geolocation test regression remains
(Turn 9 scope). The `onMessageCreated` Cloud Function was already
deployed on both stage and prod — no functions work in scope.

## Pre-checklist outcomes (resolved at kickoff time)

1. **HEAD SHA:** `997674a16fc91948e72a1c750b05d3ab9461f890` (Turn 7
   closure). Working tree clean modulo the untracked kickoff doc.
2. **Rewrite gap verified.**
   `grep -rn 'ChatRepository|SendChatMessage|MarkMessagesRead|ObserveChatMessages|FirestoreChatRepository|InMemoryChatRepository|GiftedChat|ChatModal' src/`
   returned only the four kickoff-cited stub paths
   (`ChatMessage.ts`, `ObserveLatestMessage.ts`, `useChatUiStore.ts`,
   `DispatchedView.tsx` docstring). No actual implementation.
3. **`react-native-gifted-chat` not in package.json.** Confirmed.
   Pin chosen: **`2.8.1`** to match legacy yeride exactly (`grep
'react-native-gifted-chat' yeride/package.json` →
   `"^2.8.0"`; installed version 2.8.1). Two peer deps not in the
   rewrite's package.json had to be added too: **`react-native-keyboard-controller@1.21.5`**
   (gifted-chat 2.8.x peer-deps it; legacy ships
   `^1.16.6` resolved to 1.21.5) and **`react-native-get-random-values@1.11.0`**
   (legacy ships it as a defensive add; same version pin).
4. **No app.config.ts plugin entries required.** Verified —
   `react-native-gifted-chat`, `react-native-keyboard-controller`,
   and `react-native-get-random-values` ship no `app.plugin.js`.
   Native rebuild WILL diff `ios/`+`android/` because
   keyboard-controller has native code, but no Expo plugin block to
   add (autolinking handles the pod / gradle entries).
   Kickoff's "likely not required" assumption was wrong here —
   noted for Turn 10 cutover plan.
5. **No foreground notification handler exists in rewrite today.**
   `grep -rn 'setNotificationHandler|addNotificationReceivedListener|shouldShowBanner'`
   in `src/` returned only the `ExpoNotificationsAdapter` test file
   (no production handler). Legacy `yeride/AppContent.js:45-69`
   showed the canonical SDK-55 surface shape
   (`shouldShowBanner` + `shouldShowList`) which this turn mirrors.
6. **Cloud Function deployed and active.** Confirmed via
   `yeride-functions/index.js:27,39` — `onMessageCreated`
   exported on both stage and prod projects. No functions work
   in scope.
7. **Legacy line counts confirmed.** 190 / 24 / 59
   (`ChatModal.js` / `ChatTouchable.js` /
   `message-created.js`) — off by one from kickoff (191/25/60) due
   to trailing-newline counting differences, but no files moved.
8. **Firestore rules parity confirmed.** Legacy
   `firestore.rules:179-193` covers
   `trips/{tripId}/messages/{messageId}` with read for
   passenger/driver of the parent trip, create for
   `senderId == request.auth.uid`, and explicit deny on update +
   delete. Parent-doc updates (which the new `lastSeenBy*` writes
   need) are allowed for involved parties via the `trips/{tripId}`
   `allow update` rule at line 138-145. No rewrite-side rules
   change needed (rewrite shares the legacy yeride
   `yeapp-stage` project per data co-existence).

## Decisions locked at kickoff time

### Decision 1 — Chat surface shape. Pick (a) `<ChatModal/>`.

Matches legacy 1:1, simpler diff, chat is a transient overlay over
the trip-monitor surface, not a freestanding destination. Push deep
links route to RideMonitor / DriverMonitor (the existing
`HandleNotificationResponse` plumbing already does this); the modal
opens via the view-model's `chatOpen` state when the user taps the
header chat button.

### Decision 2 — gifted-chat at the legacy pin. Pick (a).

`react-native-gifted-chat@2.8.1` matches legacy yeride exactly so a
side-by-side TestFlight / Internal-Testing rollout sees the same
chat shell in both apps. Peer deps follow: keyboard-controller
1.21.5 (legacy parity) + get-random-values 1.11.0 (legacy parity,
defensive — gifted-chat 2.8.x doesn't list it but legacy ships it).

### Decision 3 — Read-state storage. Pick (c) both.

Server-side `trips/{tripId}.lastSeenByRiderAt|lastSeenByDriverAt`
writes for legacy parity (OTHER party's UI reads them); local
`useChatUiStore.lastReadAt` mirror for instant optimistic
dot-clearing on chat-open. Legacy was effectively (c) already
(legacy `ChatModal.js:58-60,72-74` writes the parent-doc field on
mount + every snapshot; legacy `RideMonitor.js` also clears its
local unread flag on chat-open for instant UX).

### Decision 4 — Foreground push suppression: Zustand selector. Pick (b).

The rewrite's idiom for client UI state is Zustand. The legacy
module-scoped `openChatId` ref pattern is a footgun (two fast
open/close races require the cleanup-iff-match guard at legacy line
79 to avoid wiping a freshly-opened chat). `useChatUiStore.openRideId`
gives us `setState` semantics + selectable subscriptions for test
ergonomics. The cleanup-iff-match guard ports to the rewrite as
well, kept for the same reason.

### Decision 5 — `ChatRepository.observeMessages` shape. Pick (a) subscription.

Chat is a live surface; threads on this product are short
(rider ↔ driver, single trip window, typically < 10 messages). The
legacy implementation uses `onSnapshot` without pagination and has
never complained. Paginated `listMessages` defers to a polish turn
if volume forces it.

### Decision 6 — `ChatMessage.text` length cap = 1000.

Generous for rider/driver short notes, mean enough to reject
pathological pastes. The Cloud Function's 120-char push-body
truncation is server-side only (not a storage cap). Document the
cap in the `chat_message_text_too_long` error code surfaced by
both `ChatMessage.create` and `SendChatMessage.execute`.

### Decision 7 — Driver-side header chat button on all 4 active views. Pick (a).

Mirrors rider-side parity. `EnRouteToPickupView`, `AtPickupView`,
`StartedView` (driver-side), `PaymentRequestedView` all get the
header chat button + unread dot. The
`PaymentRequestedView` case is genuinely useful — the Stripe
webhook may take seconds; the driver may want to message the rider
mid-wait.

### Decision 8 — Foreground push handler in-scope. Pick (in-scope).

The rewrite has NO `setNotificationHandler` call today; the
suppression cannot work without one. Adding it is small (~70 lines
in a new `useForegroundNotificationHandler` hook + test). Kickoff
§F sketched the shape; pre-checklist item 6 confirmed the SDK-55
API surface (`shouldShowBanner` + `shouldShowList`, not the
deprecated `shouldShowAlert`).

## Patch shape (bottom-up)

### A. Domain layer

| File                                                   | Status      | What                                                                                                                                                |
| ------------------------------------------------------ | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/domain/entities/ChatMessage.ts`                   | **rewrite** | Promoted from a read-only interface to a class with private constructor + `static create(props)` factory + `markRead(at)` immutable evolve.         |
| `src/domain/entities/ChatMessage.ts` (`ChatMessageId`) | **new**     | Brand-id factory mirroring `RideId.create` (6–64 chars, Firestore-doc-safe regex).                                                                  |
| `src/domain/repositories/ChatRepository.ts`            | **new**     | Interface with four methods: `observeMessages` / `observeLatestMessage` (synchronous unsubscribe) + `send` / `markMessagesRead` (Result Promises).  |
| `src/domain/repositories/index.ts`                     | **edit**    | Re-export `ChatRepository`.                                                                                                                         |
| `src/domain/entities/__tests__/ChatMessage.test.ts`    | **new**     | 19 tests: happy-path create, trim, empty/whitespace/overlong/NaN-Date rejections, 1000-char boundary, `markRead` immutable evolve, NaN-Date readAt. |

Domain rules locked in:

- `text` non-empty after `.trim()`, length ≤ 1000.
- `senderId` is a branded `UserId` validated upstream.
- `createdAt` is a valid Date (NaN-Date rejected).
- `readAt` is `Date | null`.

Error codes: `chat_message_text_not_a_string` /
`chat_message_empty_text` / `chat_message_text_too_long` /
`chat_message_invalid_created_at` / `chat_message_invalid_read_at`.
ChatMessageId codes parallel `RideId`'s
(`chat_message_id_not_a_string` etc.). On the use-case +
adapter layers `chat_invalid_role` and `chat_send_failed` /
`chat_mark_read_failed` cover the remaining branches.

### B. Data layer

| File                                                              | Status   | What                                                                                                                                                                                                 |
| ----------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/data/dto/ChatMessageDoc.ts`                                  | **new**  | Zod schema; `createdAt` accepter mirrors `SchedulePickupAtSchema` (Timestamp / ISO / null with combined `toDate`+`seconds` duck-type); `user.passthrough()` preserves unknown gifted-chat fields.    |
| `src/data/dto/RideDoc.ts`                                         | **edit** | Added optional `lastSeenByRiderAt` + `lastSeenByDriverAt` accepters (same `SchedulePickupAtSchema` accepter — Timestamp / ISO / null). Not projected into `Ride` entity.                             |
| `src/data/dto/index.ts`                                           | **edit** | Re-export `ChatMessageDocSchema` + `ChatMessageDoc`.                                                                                                                                                 |
| `src/data/mappers/chatMessageMapper.ts`                           | **new**  | `parseDoc(raw)` + `toDomain(docId, doc, now?)` + `toDocOnSend({messageId, sender, text, serverTimestamp})`. Write path emits canonical legacy wire shape (`{_id, text, senderId, createdAt, user}`). |
| `src/data/mappers/index.ts`                                       | **edit** | Re-export `chatMessageMapper` namespace.                                                                                                                                                             |
| `src/data/repositories/FirestoreChatRepository.ts`                | **new**  | Full adapter. `send` pre-validates via entity factory; `setDoc` with pre-allocated `doc(subcoll).id`. `markMessagesRead` writes one field via `updateDoc`. Network errors wrap as `NetworkError`.    |
| `src/data/repositories/index.ts`                                  | **edit** | Re-export `FirestoreChatRepository`.                                                                                                                                                                 |
| `src/data/repositories/__tests__/FirestoreChatRepository.test.ts` | **new**  | 14 tests across observe/observe-latest/send/markMessagesRead — canonical wire-shape assertions, error wrapping, role validation, stream-error null-emit.                                             |
| `src/data/dto/__tests__/ChatMessageDoc.test.ts`                   | **new**  | 10 tests covering Timestamp / ISO / Date / null / NaN-Date / non-object / missing-required-field handling + passthrough of additional gifted-chat fields.                                            |
| `src/data/mappers/__tests__/chatMessageMapper.test.ts`            | **new**  | 12 tests: parseDoc round-trip + schema-failure; toDomain happy/edge paths; toDocOnSend canonical-shape + serverTimestamp sentinel pass-through + PersonName.full join.                               |
| `src/data/dto/__tests__/RideDoc.test.ts`                          | **new**  | 6 targeted tests for the new `lastSeenByRiderAt` / `lastSeenByDriverAt` accepters (Timestamp / ISO / null / NaN-Date / missing — each variant for both roles).                                       |

### C. App / use-case layer

| File                                                           | Status      | What                                                                                                                                                                   |
| -------------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/app/usecases/ride/ObserveChatMessages.ts`                 | **new**     | Subscription-shaped delegator.                                                                                                                                         |
| `src/app/usecases/ride/SendChatMessage.ts`                     | **new**     | Request/response. Defense-in-depth text validation (empty/overlong rejected before repo) with stable codes matching the entity factory.                                |
| `src/app/usecases/ride/MarkMessagesRead.ts`                    | **new**     | Request/response. Defense-in-depth role validation.                                                                                                                    |
| `src/app/usecases/ride/ObserveLatestMessage.ts`                | **rewrite** | Stub `null`-emitter replaced with `repo.observeLatestMessage(args)` delegation. Constructor now takes a `ChatRepository`.                                              |
| `src/app/usecases/ride/__tests__/ObserveChatMessages.test.ts`  | **new**     | 4 tests: subscription delivery; re-emit on send; cross-ride isolation; unsubscribe stops delivery.                                                                     |
| `src/app/usecases/ride/__tests__/SendChatMessage.test.ts`      | **new**     | 7 tests: happy path, whitespace-only / empty / non-string / overlong (all reject before repo), `NetworkError` propagation, trim before repo.                           |
| `src/app/usecases/ride/__tests__/MarkMessagesRead.test.ts`     | **new**     | 4 tests: invokes repo with rider role; with driver role; rejects invalid role before repo; `NetworkError` propagation.                                                 |
| `src/app/usecases/ride/__tests__/ObserveLatestMessage.test.ts` | **rewrite** | Old "always emits null" stub assertions replaced with delegation tests: empty-thread null emit, latest-message re-emit, cross-ride isolation, synchronous unsubscribe. |

### D. DI wiring

| File                                                          | Status   | What                                                                                                                                                                                                                          |
| ------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/presentation/di/container.ts`                            | **edit** | New imports: `MarkMessagesRead`, `ObserveChatMessages`, `SendChatMessage`, `ChatRepository`, `FirestoreChatRepository` (lazy `require`), `InMemoryChatRepository` (lazy `require`). `UseCases` interface extended.            |
| `src/presentation/di/container.ts` (`makeUseCases`)           | **edit** | Takes new `chats: ChatRepository` arg. Constructs four chat use cases (incl. `ObserveLatestMessage` now passed `args.chats`).                                                                                                 |
| `src/presentation/di/container.ts` (`buildContainer`)         | **edit** | Both branches: Firebase-configured path lazy-requires `FirestoreChatRepository`; fakes-only path lazy-requires `InMemoryChatRepository`. Each branch passes the chosen instance through `makeUseCases`.                       |
| `src/shared/testing/InMemoryChatRepository.ts`                | **new**  | Full fake mirroring `FirestoreChatRepository`. Subscription emits current state synchronously on subscribe; `markMessagesRead` no-ops successfully (tracked via `getMarkReadCallsFor`); `send` constructs via entity factory. |
| `src/shared/testing/index.ts`                                 | **edit** | Re-export `InMemoryChatRepository`.                                                                                                                                                                                           |
| `src/shared/testing/TestContainerProvider.tsx`                | **edit** | New optional `chats?: InMemoryChatRepository` prop; defaults to a fresh fake. Threaded into `makeUseCases`.                                                                                                                   |
| `src/shared/testing/__tests__/InMemoryChatRepository.test.ts` | **new**  | 14 tests: empty subscribe emits, send notifies observers, isolation across rides, descending order, markRead tracking, mockNextSendResult / mockNextMarkReadResult honour, reset clears state.                                |

### E. Presentation layer

| File                                                                                        | Status      | What                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/presentation/stores/useChatUiStore.ts`                                                 | **rewrite** | State extended with `openRideId: RideId \| null`. `open()` → `open(rideId: RideId)`. `close()` clears both flags. New selector `useChatOpenRideId()`.                                                                                                                                                                                                                                                                                                 |
| `src/presentation/stores/index.ts`                                                          | **edit**    | Re-export `useChatOpenRideId`.                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `src/presentation/stores/__tests__/useChatUiStore.test.ts`                                  | **rewrite** | All "no-arg `open()`" assertions replaced with `open(rideId)` + `openRideId` assertions. 7 tests.                                                                                                                                                                                                                                                                                                                                                     |
| `src/presentation/components/chat/ChatModal.tsx`                                            | **new**     | Mounts `<GiftedChat/>`. Subscribes to `observeChatMessages` while visible, projects domain `ChatMessage` → gifted-chat `IMessage`. Sends via `sendChatMessage`. Fires `markMessagesRead({role})` on mount + per snapshot. Sets/clears `useChatUiStore.openRideId` with the cleanup-iff-match guard. Modal mounted with `statusBarTranslucent` + `navigationBarTranslucent`. No raw hex — `text-primary` for close button (legacy `#007BFF` replaced). |
| `src/presentation/components/chat/__tests__/ChatModal.test.tsx`                             | **new**     | 7 tests using the gifted-chat manual mock: visibility gating, openRideId set, markRead on mount, driver-role vs rider-role, sendChatMessage on `fireEvent.press('mock-gifted-chat-send')`, onClose, per-snapshot markRead re-fire.                                                                                                                                                                                                                    |
| `src/presentation/features/rider/view-models/useRideMonitorViewModel.ts`                    | **edit**    | Replaced Phase-3.5 Toast stub with real wiring: new state `chatOpen`, callbacks `onPressChat` / `closeChat`, store-side `open(rideId)` + `markRead(new Date())` + best-effort `markMessagesRead({role: 'rider'})`. Toast import removed.                                                                                                                                                                                                              |
| `src/presentation/features/rider/view-models/__tests__/useRideMonitorViewModel.test.tsx`    | **edit**    | Old "shows a 'Phase 3.5' toast" assertion replaced with: `chatOpen` flip, `useChatUiStore.openRideId` set, `markMessagesRead` fired, `closeChat` clears both. Toast mock kept for downstream siblings.                                                                                                                                                                                                                                                |
| `src/presentation/features/driver/view-models/useDriverMonitorViewModel.ts`                 | **edit**    | New chat surface: `latestMessage` subscription via `observeLatestMessage`, `hasUnreadMessages` memo against `useChatUiStore.lastReadAt`, `onPressChat` (driver role) + `chatOpen` + `closeChat`. `ChatMessage` import added.                                                                                                                                                                                                                          |
| `src/presentation/features/driver/view-models/__tests__/useDriverMonitorViewModel.test.tsx` | **edit**    | New `describe('chat (Phase 10 turn 8)')` block — 4 tests: defaults; unread-derivation when a peer sends; onPressChat flips chatOpen + sets openRideId + calls markMessagesRead; closeChat tears it all down. `TestContainerProvider` now accepts a `chats` override.                                                                                                                                                                                  |
| `src/presentation/features/rider/screens/RideMonitorScreen.tsx`                             | **edit**    | Mounts `<ChatModal/>` (gated on `userQuery.data`) with `role="rider"`. Also threads `vm.hasUnreadMessages` into `<DispatchedView/>` (rider can receive messages between dispatch and start).                                                                                                                                                                                                                                                          |
| `src/presentation/features/rider/components/DispatchedView.tsx`                             | **edit**    | New optional `hasUnread?` prop; renders the unread dot + accessibility label on the existing chat button.                                                                                                                                                                                                                                                                                                                                             |
| `src/presentation/features/driver/screens/DriverMonitorScreen.tsx`                          | **edit**    | Mounts `<ChatModal/>` (gated on `userQuery.data`) with `role="driver"`. Threads `vm.onPressChat` + `vm.hasUnreadMessages` into all four active driver views.                                                                                                                                                                                                                                                                                          |
| `src/presentation/features/driver/components/EnRouteToPickupView.tsx`                       | **edit**    | New `onPressChat` (required) + `hasUnread?` props. Wraps the trailing slot in `<>...</>` to put chat button alongside the existing cancel button. Header docstring updated to remove the "deferred to Phase 9 polish" line.                                                                                                                                                                                                                           |
| `src/presentation/features/driver/components/AtPickupView.tsx`                              | **edit**    | Same shape as `EnRouteToPickupView`.                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `src/presentation/features/driver/components/StartedView.tsx` (driver-side)                 | **edit**    | Same shape — chat button + unread dot alongside cancel.                                                                                                                                                                                                                                                                                                                                                                                               |
| `src/presentation/features/driver/components/PaymentRequestedView.tsx`                      | **edit**    | New optional `onPressChat` / `hasUnread` (optional because the legacy view didn't have header trailing actions at all — keeping them optional means the no-chat render still works).                                                                                                                                                                                                                                                                  |
| `src/presentation/features/driver/components/__tests__/EnRouteToPickupView.test.tsx`        | **edit**    | New tests for the chat button render + tap + unread-dot toggle. Existing nav-launch test extended to pass `onPressChat: jest.fn()`.                                                                                                                                                                                                                                                                                                                   |
| `src/presentation/features/driver/components/__tests__/StartedView.test.tsx` (driver-side)  | **edit**    | Same pattern.                                                                                                                                                                                                                                                                                                                                                                                                                                         |

### F. Foreground push-banner suppression

| File                                                                         | Status   | What                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/presentation/hooks/useForegroundNotificationHandler.ts`                 | **new**  | Registers `Notifications.setNotificationHandler` once on mount. Reads `useChatUiStore.getState().openRideId` lazily on every push delivery; suppresses banner / list / sound / badge when `chat_message`'s `tripId` matches the open ride. SDK 55 surface (`shouldShowBanner` + `shouldShowList`). Lazy-requires `expo-notifications` so unit-test sibling imports don't pull the TurboModule. |
| `src/presentation/hooks/index.ts`                                            | **edit** | Re-export.                                                                                                                                                                                                                                                                                                                                                                                     |
| `src/presentation/AppContent.tsx`                                            | **edit** | Mount `useForegroundNotificationHandler()` unconditionally alongside `useNotificationResponseHandler()`. New import added.                                                                                                                                                                                                                                                                     |
| `src/presentation/hooks/__tests__/useForegroundNotificationHandler.test.tsx` | **new**  | 6 tests: handler registers on mount; suppress on matching openRideId; show on mismatched tripId; show when no chat open; show non-chat notification regardless of openRideId; show on missing/malformed data.                                                                                                                                                                                  |

### G. Native config

| File                                     | Status   | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `package.json`                           | **edit** | Added three dependencies: `react-native-gifted-chat@2.8.1`, `react-native-keyboard-controller@^1.21.5`, `react-native-get-random-values@^1.11.0`. Versions pinned to match legacy yeride so a cross-app build runs identically.                                                                                                                                                                                                                                                                         |
| `__mocks__/react-native-gifted-chat.tsx` | **new**  | Manual jest mock (auto-resolved by jest). Replaces `<GiftedChat/>` with a `<View testID="mock-gifted-chat"/>` containing a `<Pressable testID="mock-gifted-chat-send"/>` that invokes the captured `onSend` callback with a synthetic `'mock-send-text'` message. Same manual-mock pattern as `__mocks__/react-native-maps.tsx` / `__mocks__/react-native-svg.tsx` — inline `jest.mock` factories in `jest.setup.ts` fail because NativeWind's `_ReactNativeCSSInterop` helper is hoisted out of scope. |
| `jest.setup.ts`                          | **edit** | Documentation block pointing at the manual mock (no inline factory). No other change.                                                                                                                                                                                                                                                                                                                                                                                                                   |

## Test additions and pass counts

**~120 new tests added across all six layers.** Per shard:

- shard 1/4 — 504 passed / 504 total
- shard 2/4 — 454 passed / 454 total
- shard 3/4 — 521 passed / 521 total
- shard 4/4 — 430 passed / 451 total (21 carry-over
  `BackgroundGeolocationClient.test.ts` failures, Turn 9 scope)

**Grand total: 1909 passing, 21 failing (all pre-existing).** Zero
new regressions outside the BG-geolocation set.

## Verify gates

```bash
$ npm run typecheck   # green
$ npm run lint        # green
$ npm run format:check
# 4 carry-over warnings — pre-existing, not touched in this turn:
#   CLAUDE.md, docs/PHASE_10_PARITY_AUDIT.md, docs/PHASE_10_TURN_7.md,
#   src/presentation/features/rider/screens/RouteSelectScreen.tsx
$ npm test            # 1909 passed, 21 failed (carry-over BG-geo)
```

## Acceptance criteria

- ✅ Decisions 1-8 documented with the evidence that drove them.
- ✅ `ChatMessage.create(props)` returns
  `Result<ChatMessage, ValidationError>` with empty,
  whitespace-only, overlong, and NaN-Date rejection paths.
  `markRead(at)` returns a new immutable entity.
- ✅ `ChatRepository` interface ships with `observeMessages` /
  `observeLatestMessage` (subscription-shaped) and `send` /
  `markMessagesRead` (Result-returning Promise) methods.
- ✅ `FirestoreChatRepository` implements all four methods and
  writes the canonical legacy doc shape `{_id, text, senderId,
createdAt: serverTimestamp(), user: {_id, name}}` on send.
- ✅ `InMemoryChatRepository` mirrors all four methods for tests.
- ✅ `ObserveChatMessages` + `SendChatMessage` + `MarkMessagesRead`
  use cases ship and route through DI.
- ✅ `ObserveLatestMessage` no longer stubs `null` — delegates to
  `repo.observeLatestMessage`.
- ✅ `ChatModal.tsx` mounts `<GiftedChat/>`, drives messages from
  `observeChatMessages`, sends via `sendChatMessage`, marks read
  on mount + per snapshot, sets / clears `useChatUiStore.openRideId`.
- ✅ Rider VM `onPressChat` replaces the Toast stub with
  `setChatOpen(true)` + `markMessagesRead` + `useChatUiStore.open(rideId)`
  - local `markRead` mirror.
- ✅ Driver VM gains the symmetric chat surface: subscription,
  unread dot, `onPressChat`, `chatOpen`, `closeChat`.
- ✅ Driver-side views (`EnRouteToPickupView`, `AtPickupView`,
  `StartedView` driver, `PaymentRequestedView`) render the header
  chat button + unread dot.
- ✅ Rider-side `DispatchedView` renders the unread dot on its
  existing chat button.
- ✅ Foreground notification handler suppresses `chat_message`
  banners when `useChatUiStore.openRideId === payload.tripId`.
- ✅ `react-native-gifted-chat@2.8.1` +
  `react-native-keyboard-controller@^1.21.5` +
  `react-native-get-random-values@^1.11.0` added to `package.json`;
  manual mock for gifted-chat in `__mocks__/`.
- ✅ ~120 new tests per §H; no regressions outside Turn 9's 21
  carry-over BG-geolocation failures.
- ✅ Audit §3.4 row flipped ❌ → ✅ with Turn 8 annotation.
- ✅ Audit §6 row "`chat_message` banner suppression" flipped
  ❌ → ✅.
- ✅ Audit §6 row "`trips/{tripId}/messages`" flipped ❌ → ✅.
- ✅ Audit §1 headline count updated `2 ❌ / 0 🟡` → `1 ❌ / 0 🟡`.
- ✅ Audit §8 row 8 strike-through with close date + doc reference.
- ✅ Header sublabel append "Turn 8 closed 2026-05-19".
- ✅ `docs/PHASE_10_TURN_8.md` (this document).
- ✅ `npm run typecheck && npm run lint && npm run format:check`
  green (modulo the pre-existing carry-over Prettier warnings on
  the four out-of-scope files); jest carries only the 21
  pre-existing BG-geolocation failures.

## Post-review follow-up (2026-05-19, same-day)

A code review of 9a6e504 surfaced one high-severity correctness bug
(self-message lighting the unread dot), one medium-severity bleed
(`useChatUiStore.lastReadAt` carried across rides), and several
quality items (peer-name projection, dedupe per-snapshot
`markMessagesRead`, send-failure toast, effect-split race-window,
driver `latestMessage` gating, static-imports). All landed
same-day on top of this commit. See
[`PHASE_10_TURN_8_REVIEW_FIXES.md`](PHASE_10_TURN_8_REVIEW_FIXES.md)
for the per-item rationale, file list, and verify-gate results.

**Behavioral deltas vs. the original Turn 8 shape — relevant to
anyone reading downstream:**

- `useChatUiStore.lastReadAt: Date | null` → `lastReadAtByRide:
Readonly<Record<string, Date>>`. `markRead` now takes
  `(rideId, at?)`. Selector renamed `useChatLastReadAt` →
  `useChatLastReadAtForRide(rideId)`.
- `ChatMessage` carries a new `senderName: string | null` field;
  the mapper projects `doc.user?.name`. `ChatModal.domainToGifted`
  uses it for peer bubble labels (no more empty-string fallback).
- `hasUnreadMessages` in both rider/driver VMs gates on
  `currentUserId` so own outbound messages never light the dot.
- `ChatModal` splits the open-mirror effect from the subscription
  effect to close the `useCases`-re-render race window on
  `openRideId`.
- `useForegroundNotificationHandler` static-imports
  `expo-notifications` (previously lazy-required).
- Driver `subscribeLatestMessage` no-ops when `!isActiveTripStatus`.

## Out of scope (deferred to later turns)

- **BG-geolocation test regression** — Turn 9 (audit §10.1).
- **Audit v3 + cutover sign-off** — Turn 10.
- **Per-message "delivered/read" receipts UI.** Legacy doesn't
  render them; the `lastSeenBy*` write is audited for the
  unread-dot story only.
- **Image / attachment / typing-indicator support.** Legacy is
  text-only; match parity. gifted-chat's image-upload affordance is
  not enabled by the rewrite's `<GiftedChat/>` props.
- **Per-trip chat history retention policy.** Legacy retains
  forever (no TTL); the rewrite matches that. Lifecycle deletion is
  a privacy-policy decision out of scope here.
- **Driver-side `useDriverActivityViewModel` chat affordance for
  closed trips.** Active-trip-only surface, same as legacy.
- **Composite Firestore index for chat messages.** Single-field
  descending on `createdAt` is auto-created by Firestore.
- **Detox E2E for chat flows.** Covered by
  `PHASE_10_CUTOVER_PLAN.md` §3.1.
- **In-app banner UI** (legacy `InAppNotification.js`). Audit §6
  row 674 still calls it 🟡 — the rewrite's current foreground
  policy is OS banner / OS list / no in-app overlay. The chat
  suppression flows through `setNotificationHandler` even without
  an in-app banner UI. When that UI eventually ports, it'll read
  the same `useChatUiStore.openRideId` signal.

## Native rebuild

**Native rebuild IS required this turn.**
`react-native-keyboard-controller` ships native code (iOS Pod +
Android Gradle module) and Expo autolinking picks it up at prebuild
time. `react-native-gifted-chat` and `react-native-get-random-values`
are both JS-only and don't add native modules of their own. The
prebuild + native rebuild are NOT executed inside this sandbox
turn (the workspace doesn't ship the Xcode + Android SDK
toolchain); the next dev/stage build via `eas build` or
`expo run:ios`/`expo run:android` will pick up the new pods and
the keyboard-controller native module automatically.

```bash
# To run locally:
npm install react-native-gifted-chat@2.8.1 \
            react-native-keyboard-controller@^1.21.5 \
            react-native-get-random-values@^1.11.0
npm run prebuild   # expo prebuild --clean + scripts/patch-podfile.js
# Expect a diff under ios/Podfile.lock + android/app/build.gradle
# pulling in keyboard-controller. Both gifted-chat and
# get-random-values are JS-only and don't change native config.
```

Smoke test (executable after the native rebuild lands on a build):

1. Start a trip (rider creates, driver accepts → dispatched).
2. Rider taps chat header button. ChatModal opens. Header shows
   "Chat" + Close button; gifted-chat shell takes the remaining
   space.
3. Rider sends "On my way." Message lands in the thread instantly
   (optimistic insert via the canonical `_id` pre-allocation) and
   persists to Firestore.
4. Driver receives a foreground push (or background banner if
   backgrounded). Tap → `DriverMonitor` opens; chat modal reachable
   via the new header chat button.
5. Driver taps chat header button. Unread dot clears. Both messages
   visible. Driver sends a reply. Rider sees it live.
6. Confirm `trips/{tripId}/lastSeenByRiderAt` +
   `lastSeenByDriverAt` are populated in Firestore console after
   each role opens the chat.
7. With chat open on rider side, driver sends another message. No
   in-app banner / OS banner appears on rider (suppression).
   Message appears in the open thread.
8. Close chat on rider. Driver sends a third. OS banner appears on
   rider (no suppression — chat closed).
9. Verify legacy yeride can still chat with the rewrite — open the
   legacy build alongside the rewrite, run a thread end-to-end,
   confirm both directions of message flow and unread-dot
   derivation work. Cross-app `lastSeenBy*` writes should clear
   each side's badge correctly.

## Notes for the next turn

- **Turn 9 — BG-geolocation test regression** is the last
  remaining ❌ before Turn 10's audit-v3 + cutover sign-off. The 21
  failing assertions in
  `src/data/services/__tests__/BackgroundGeolocationClient.test.ts`
  all live in the `__DEV__` short-circuit added at the v5 upgrade
  (`memory/rn_bg_geolocation_v5_android_loop.md`). Either gate the
  short-circuit behind a test-injection seam or update the
  assertions to match the `__DEV__===true` execution path.
- **Native rebuild diff** from this turn lands at the next
  `eas build` / `expo run:*` step. Watch the
  `react-native-keyboard-controller` autolink picks up correctly
  on both platforms; the Android module especially has had
  Kotlin/Reanimated interplay quirks in the past (none expected
  with our `react-native-reanimated@4.2.1` + RN 0.83 combo, but
  worth a smoke).
- **Cutover-plan §3.4 indexes-and-rules check.** No new indexes
  added (single-field descending on `createdAt` is auto-created).
  No rules change (rewrite reads against legacy yeride's
  `yeapp-stage` rules). Both audit notes remain accurate for
  Turn 10 sign-off.
- **Audit v3 (Turn 10) headline:** at HEAD-post-Turn-8 the audit
  flips to `0 ❌ / 0 🟡 / 0 ⚠️` once Turn 9 closes §10.1. Cutover
  plan §0 gate clears at that point.
