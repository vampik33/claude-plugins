# Explain Changes — Output Examples

Reference examples showing good vs. mediocre explanations. Read this when you need calibration on output quality.

## Example 1: Bug Fix (Good)

**Diff:** Changed `users.filter(u => u.active)` to `users.filter(u => u.active && !u.deleted)` in `src/api/users.ts:42`

**Good explanation:**

### Bug fix: Deleted users appearing in active user lists

**What changed:**
- `src/api/users.ts:42` — Added `!u.deleted` check to the active users filter

**Why:**
Soft-deleted users (where `deleted=true` but the record still exists) were passing the `active` filter because `active` and `deleted` are independent flags. A user could be both `active=true` and `deleted=true` if they were deleted without being deactivated first.

`★ Insight ─────────────────────────────────────`
Soft-delete patterns create this class of bug — every query that filters "active" records must also exclude deleted ones. A common mitigation is a database view or query scope (e.g., `withoutDeleted()`) that centralizes this logic so individual queries can't forget it.
`─────────────────────────────────────────────────`

**Mediocre explanation (avoid this):**

> Changed the filter in users.ts to also check the deleted flag. This ensures deleted users are filtered out.

Problems: No file/line reference, no "why", no explanation of when the bug manifests, no insight.

---

## Example 2: Large Refactor (Good)

**Diff:** 15 files changed, extracted `NotificationService` from three controllers

**Good explanation:**

### Refactor: Extract notification logic into dedicated service

**What changed:**
- New file `src/services/notification.ts` — `NotificationService` class with `sendEmail()`, `sendPush()`, `sendSMS()` methods
- `src/controllers/orders.ts` — Replaced inline email sending (lines 45-78) with `notificationService.sendEmail()`
- `src/controllers/auth.ts` — Replaced inline email sending (lines 23-41) with `notificationService.sendEmail()`
- `src/controllers/support.ts` — Replaced inline push notification code (lines 89-112) with `notificationService.sendPush()`
- 12 test files updated to mock `NotificationService` instead of individual transport libraries

**Why:**
Three controllers independently implemented notification sending with duplicated template rendering, retry logic, and error handling. The `NotificationService` centralizes this into one place, making it easier to add new notification channels or change providers.

`★ Insight ─────────────────────────────────────`
This follows the "Extract Service" refactoring pattern — when the same cross-cutting concern appears in 3+ places, it's a signal to centralize. The test changes are worth noting: mocking one service boundary is simpler than mocking three separate transport libraries, which is a secondary benefit of the extraction.
`─────────────────────────────────────────────────`

---

## Example 3: Routine Change (Good — No Insight Needed)

**Diff:** Updated `package.json` version from `2.1.0` to `2.1.1`, updated `CHANGELOG.md`

**Good explanation:**

### Config: Version bump to 2.1.1

**What changed:**
- `package.json` — Version `2.1.0` → `2.1.1`
- `CHANGELOG.md` — Added 2.1.1 section documenting the bug fix from previous commit

**Why:**
Standard patch release following the bug fix in the previous commit.

No insight block — this is a routine version bump with nothing non-obvious to teach.

---

## Example 4: Intent Unclear (Good — Honest)

**Diff:** Added `sleep(0.1)` inside a retry loop in `src/client.py:87`

**Good explanation:**

### Bug fix: Added delay in retry loop

**What changed:**
- `src/client.py:87` — Added `sleep(0.1)` between retry attempts in `fetch_with_retry()`

**Why:**
The motivation isn't fully clear from the diff alone. Likely candidates:
- **Rate limiting** — The API being called may return errors when hit too rapidly
- **Thundering herd** — Without a delay, retries fire immediately, which can overwhelm a recovering service
- **CPU spin** — A tight retry loop without sleep consumes CPU unnecessarily

The 100ms value is relatively short, suggesting this is more about avoiding a tight spin than serious backoff.

`★ Insight ─────────────────────────────────────`
A fixed `sleep(0.1)` is a simple but blunt retry strategy. Exponential backoff (e.g., 100ms, 200ms, 400ms...) adapts better to varying failure durations. Libraries like `tenacity` (Python) or `p-retry` (JS) provide this out of the box.
`─────────────────────────────────────────────────`

---

## Example 5: Untracked Files (Good)

**Diff:** Two new files not yet staged — `src/utils/cache.ts` and `src/utils/cache.test.ts`

**Good explanation:**

### Feature: New caching utility

**What changed:**
- `src/utils/cache.ts` *(new, untracked)* — `LRUCache` class with `get()`, `set()`, `evict()` methods and configurable TTL
- `src/utils/cache.test.ts` *(new, untracked)* — Unit tests covering capacity limits, TTL expiry, and eviction order

These files are new and not yet tracked by git — they need to be staged (`git add`) before committing.

**Why:**
The naming and test structure suggest preparation for caching API responses or computed values. The LRU eviction policy and TTL support indicate use with data that goes stale over time.

`★ Insight ─────────────────────────────────────`
Note: `git diff` doesn't show untracked files at all — they only appear in `git status`. This is a common source of confusion when reviewing "all changes" and finding new files missing from the diff output.
`─────────────────────────────────────────────────`

---

## Example 6: Large Diff (Good)

**Diff:** 28 files changed across `src/api/`, `src/models/`, `src/middleware/`, and `tests/`

**Good explanation:**

### Refactor: Migrate authentication from session-based to JWT

This changeset touches 28 files across 4 areas of the codebase. The core change is replacing session-based auth with JWT tokens; most modifications are follow-on updates.

**Core change:**
- `src/middleware/auth.ts` — Replaced `SessionAuthMiddleware` with `JWTAuthMiddleware`; token verification via `jsonwebtoken` library instead of Redis session lookup
- `src/api/auth/login.ts` — Now returns `{ accessToken, refreshToken }` instead of setting a session cookie
- `src/api/auth/refresh.ts` *(new)* — New endpoint for token refresh flow

**Ripple effects:**
- `src/api/` (8 files) — All protected endpoints updated to read `Authorization: Bearer` header instead of session cookie
- `src/models/session.ts` — Deleted; `src/models/token.ts` added for refresh token storage
- `src/middleware/rate-limit.ts` — Now identifies users by JWT `sub` claim instead of session ID
- `tests/` (14 files) — Test helpers updated to generate JWT fixtures instead of mock sessions

**Config:**
- `package.json` — Added `jsonwebtoken@9.0.0`, removed `express-session@1.17.3`
- `.env.example` — Added `JWT_SECRET`, `JWT_EXPIRES_IN` variables

**Why:**
Session-based auth requires server-side storage (Redis) and doesn't scale horizontally without shared session stores. JWT is stateless — any server instance can verify a token independently, simplifying deployment and enabling horizontal scaling.

`★ Insight ─────────────────────────────────────`
JWT trades server-side state for token size and revocation complexity. Sessions can be killed instantly (delete from Redis); JWTs remain valid until expiry. The refresh token endpoint here is the standard mitigation — short-lived access tokens (minutes) with longer-lived refresh tokens (days) that can be revoked by deleting them from the database.
`─────────────────────────────────────────────────`
