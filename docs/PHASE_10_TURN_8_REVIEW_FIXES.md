# Phase 10 Turn 8 — Post-review fixes (2026-05-19)

> Companion doc to `PHASE_10_TURN_8.md`. Captures the post-code-review
> fix set that landed on top of the Turn 8 commit (9a6e504) the same
> day. Turn 8's per-turn record stays as written — this doc is the
> diff against it.

## Why

A code review of 9a6e504 surfaced one high-severity bug, one
medium-severity correctness item, and several quality suggestions
worth landing before the next phase. None blocked the audit-closure
flips Turn 8 already committed; all were small, localized fixes with
no Cloud Function or Firestore-rules surface change.

## Items landed

### Critical #1 — `hasUnreadMessages` ignores `senderId`

**Bug.** The unread-dot memo in both `useRideMonitorViewModel` and
`useDriverMonitorViewModel` compared `latestMessage.createdAt` against
`useChatUiStore.lastReadAt` and treated "newer than read stamp" as
unread, with no `senderId` gate. After `onPressChat` stamped
`lastReadAt = now()` and the modal closed, a freshly-sent OUTBOUND
message resolved with `serverTimestamp() > lastReadAt`, so the local
user saw their own outbound message flagged unread until the next
snapshot fired and bumped `lastReadAt` again.

**Fix.** Both VMs now read `useSessionStore.userId` and short-circuit
`hasUnreadMessages` to `false` when
`String(latestMessage.senderId) === String(currentUserId)`. Own
outbound messages never light the dot.

**Tests:** Added `'hasUnreadMessages is FALSE when the latest message
is the local rider's own send'` to the rider VM suite and `'does NOT
light hasUnreadMessages when the latest message is the local driver's
own send'` to the driver VM suite.

### Critical #2 — `lastReadAt` was global, bleeding across rides

**Bug.** `useChatUiStore.lastReadAt: Date | null` was a single slot.
After ride A's chat closed and ride B started, ride B inherited ride
A's stamp. If ride B's first inbound message happened to have a
`createdAt` older than the ride-A stamp (rare but possible under
clock skew + fast trip transitions), the unread dot was wrongly
hidden.

**Fix.** Store shape changed to
`lastReadAtByRide: Readonly<Record<string, Date>>`. `markRead` now
takes `(rideId, at?)`. `close()` no longer drops read state (the dot
must stay cleared after the modal closes — the previous shape was
already correct on this point, just at the wrong granularity). New
selector hook `useChatLastReadAtForRide(rideId)`. Old
`useChatLastReadAt` selector removed (callers updated).

**Tests:** Store test fully rewritten to assert per-ride keys, cross-
ride isolation, and close-without-drop semantics. VM tests updated to
read `lastReadAtByRide[String(RIDE_ID)]` instead of `lastReadAt`.

### Suggestion #1 — Peer name lost between wire and gifted-chat

**Symptom.** `ChatMessageDoc.user.name` was carried on the wire but
`ChatMessage` didn't store it; `ChatModal.domainToGifted` set
`user.name = ''` on inbound messages. Gifted-chat then rendered
peer bubbles with its "Anonymous" avatar fallback instead of the
peer's real name.

**Fix.** Added `senderName: string | null` to the `ChatMessage`
entity (trimmed; whitespace-only collapses to `null`). The mapper's
`toDomain` projects `doc.user?.name`. Both repos
(`FirestoreChatRepository.send` and `InMemoryChatRepository.send`)
seed `senderName: args.sender.name.full` on the optimistic local
construct so the modal's own outbound messages render with the local
display name immediately. `ChatModal.domainToGifted` projects
`m.senderName ?? ''` (empty-string fallback for legacy docs missing
the field).

**Tests:** Added entity-level tests for trim / null-collapse /
explicit-null / default-null behavior, plus a mapper test asserting
`toDomain` returns `senderName: 'Ada'` from a typical doc and `null`
when the doc omits `user`.

### Suggestion #2 — `markMessagesRead` fired per snapshot, not per new message

**Symptom.** The Turn 8 ChatModal called `markMessagesRead` on every
snapshot callback, including snapshots that didn't carry a newer
message (e.g. re-emit on re-subscribe, downstream `setMessages` re-
renders). Each call wrote `lastSeenBy*` on the parent trip doc and
fired a no-op `onTripUpdated` Cloud Function invocation.

**Fix.** ChatModal now tracks `lastMarkReadForCreatedAtMsRef` —
`markMessagesRead` only fires when `next[0]?.createdAt.getTime()`
exceeds the last-acked value. The ref resets when the modal opens
fresh on a new ride. Initial `markMessagesRead` on visibility-open
still fires unconditionally (the first snapshot is the only one
guaranteed to land before user interaction).

### Suggestion #3 — Send failures were silent

**Symptom.** `ChatModal.handleSend` logged `sendChatMessage` failures
to the logger but didn't surface anything user-visible. Gifted-chat
optimistically inserts on send and rebuilds from the snapshot, so
the failed message just disappeared — readable as a silent drop on
flaky networks.

**Fix.** Added `Toast.show` with branched copy. Validation errors
(`chat_message_text_too_long` / `chat_message_empty_text` /
`chat_message_text_not_a_string`) surface as title `"Message
rejected"` with subtitle `"That message is too long. Try a shorter
one."`. Network errors surface as title `"Message not sent"` with
subtitle `"Check your connection and try again."`.

### Suggestion #4 — Open/close race on `useCases` re-render

**Symptom.** Turn 8's effect bundled `open(rideId)` /
subscription / `close()` cleanup into a single `useEffect` keyed on
`[visible, rideId, role, useCases, open, close, markRead]`. A change
to the `useCases` reference (DI container re-render) would tear down
and re-up the effect — briefly clearing `openRideId` to `null` in
between. During that one-frame gap, a `chat_message` push would
miss the suppression check and show a banner.

**Fix.** Split into two effects:

1. `openRideId` mirror — keyed on `[visible, rideId, open, close,
markRead]`. Owns set/clear of `openRideId` + the
   cleanup-iff-match guard.
2. Subscription + per-snapshot mark-read — keyed on
   `[visible, rideId, role, useCases, markRead]`. Owns the
   `observeChatMessages.execute` subscription and the deduped
   `markMessagesRead` writes.

`useCases` re-renders now only re-mount the subscription, never the
`openRideId` mirror.

### Suggestion #5 — Drop unused `userName` from `giftedMessages` deps

`domainToGifted` no longer takes `userName` (peer name comes off the
entity itself), so the memo deps shrank to `[messages]`.

### Suggestion #7 — Driver `observeLatestMessage` subscribed on terminal statuses

`useDriverMonitorViewModel` subscribed to `observeLatestMessage`
unconditionally. The driver screen redirects on terminal status
(`cancelled` / `completed`), but the brief pre-redirect window had
the subscription active against a closed trip. The
`subscribeLatestMessage` callback now no-ops (`cb(null)` + noop
unsubscribe) when `!isActiveTripStatus`, gated on
`ride?.status === 'dispatched' || ride?.status === 'started'`.

### Suggestion #8 — Static-import `expo-notifications`

`useForegroundNotificationHandler` lazy-`require`d
`expo-notifications` inside the `useEffect` body with a comment
about avoiding the TurboModule pull in sibling-hook tests. The
sibling hook (`usePushTokenRegistration`) already static-imports the
same package, so the justification didn't hold. Replaced with
`import * as Notifications from 'expo-notifications'` at module top.

### Suggestion #9 — Loosen `ChatMessageDoc.user.name` cap

Removed the `.max(160)` ceiling on `user.name` in `ChatMessageDoc`.
The mapper passes the value to the entity which is permissive, and
gifted-chat clamps display anyway. `min(1)` retained because empty
names are never useful.

### Suggestion #11 — Document the Android-only second `KeyboardAvoidingView`

Added a comment to `ChatModal.tsx` explaining why an inert
`<KeyboardAvoidingView behavior="padding" />` is mounted as a
sibling of `<GiftedChat/>` on Android (input-bar height-reservation
shim for API 30+ soft-keyboard layout).

## Deliberately deferred

- **Critical #3 (Firestore rules — field-level enforcement for
  `lastSeenBy*` writes).** The rule sits in the legacy `yeride/`
  repo and requires a coordinated deploy (`firebase deploy --only
firestore:rules`); not exploitable for harm in the current shape
  (a malicious rider clobbering the driver's read-state achieves
  nothing useful). Should land alongside the next legacy rules
  deploy.
- **Suggestion #6 (stream error callback on `ChatRepository`).**
  Larger interface change spanning the domain repo interface, both
  adapters, the fake, the use case, and the view-model. Worth a
  dedicated turn — current behavior (warn + emit empty) matches
  legacy.
- **Suggestion #10 (tighten or loosen `ChatMessageId` charset).**
  Current bounds at worst over-accept; no live failure mode.

## Files changed

| File                                                                        | Why                                                                                          |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `src/domain/entities/ChatMessage.ts`                                        | `senderName: string \| null` added; private-ctor + factory updated; `markRead` preserves it. |
| `src/domain/entities/__tests__/ChatMessage.test.ts`                         | New tests for senderName trim / null / default behavior.                                     |
| `src/data/dto/ChatMessageDoc.ts`                                            | Dropped `.max(160)` on `user.name`. Comment updated.                                         |
| `src/data/mappers/chatMessageMapper.ts`                                     | `toDomain` projects `doc.user?.name` onto `senderName`.                                      |
| `src/data/mappers/__tests__/chatMessageMapper.test.ts`                      | Asserts senderName projection + null when `user` omitted.                                    |
| `src/data/repositories/FirestoreChatRepository.ts`                          | `send` seeds optimistic `ChatMessage` with `senderName: args.sender.name.full`.              |
| `src/shared/testing/InMemoryChatRepository.ts`                              | Same `senderName` seed on the fake's `send`.                                                 |
| `src/presentation/stores/useChatUiStore.ts`                                 | `lastReadAt` → `lastReadAtByRide` keyed by rideId; `markRead(rideId, at?)`; new selector.    |
| `src/presentation/stores/index.ts`                                          | Re-export rename: `useChatLastReadAt` → `useChatLastReadAtForRide`.                          |
| `src/presentation/stores/__tests__/useChatUiStore.test.ts`                  | Rewritten for per-ride shape + close-without-drop assertion.                                 |
| `src/presentation/components/chat/ChatModal.tsx`                            | Effect split, dedupe ref, Toast on send-failure, peer name from entity, KAV comment.         |
| `src/presentation/hooks/useForegroundNotificationHandler.ts`                | Static import of `expo-notifications`.                                                       |
| `src/presentation/features/rider/view-models/useRideMonitorViewModel.ts`    | `useChatLastReadAtForRide` + `currentUserId` gate on `hasUnreadMessages`.                    |
| `src/presentation/features/rider/view-models/__tests__/...test.tsx`         | New senderId-gate tests + per-ride store assertion.                                          |
| `src/presentation/features/driver/view-models/useDriverMonitorViewModel.ts` | Same VM updates + `subscribeLatestMessage` gated on active-trip status.                      |
| `src/presentation/features/driver/view-models/__tests__/...test.tsx`        | New own-send-no-dot test + per-ride store assertion.                                         |

## Verify gates

- `npm run typecheck`: clean.
- `npm run lint`: clean.
- `npm run format:check`: clean on every file touched (three
  pre-existing unformatted files unrelated to this work).
- `npm test` (full suite): chat-area test files (132 tests across
  ChatMessage, ChatMessageDoc, chatMessageMapper,
  FirestoreChatRepository, InMemoryChatRepository, SendChatMessage,
  MarkMessagesRead, Observe{Chat,Latest}Messages, useChatUiStore,
  useForegroundNotificationHandler, ChatModal, rider VM, driver VM)
  all green. The pre-existing `BackgroundGeolocationClient.test.ts`
  failure (Turn 9 scope, audit §10.1) is unchanged; no new
  regressions surfaced in the partial broader run.

## Cross-doc updates

- `PHASE_10_PARITY_AUDIT.md` §3.4 closure note: line 444 reference
  to `useChatUiStore.lastReadAt` updated to
  `useChatLastReadAtForRide(rideId)`.
- `PHASE_10_TURN_8.md`: post-review pointer appended to the
  acceptance-criteria section directing readers here for the
  delta.

---

**End of PHASE_10_TURN_8_REVIEW_FIXES.md.**
