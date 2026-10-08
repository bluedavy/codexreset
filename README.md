# Codex Reset Raid

Built by Codex. Live at [reset.wowtools.ai](https://reset.wowtools.ai). Source: [bluedavy/codexreset](https://github.com/bluedavy/codexreset).

One shared Quota Beast. Tap the Reset Card to add a hit. Players can hurt it; only a verified public full/global reset announcement ends a round.

## Architecture

A single framework-free HTML document contains CSS, JavaScript and the animated SVG quota-meter monster. Cloudflare Static Assets serves it. Worker APIs call `ResetRaidDO("global")`, a SQLite-backed Durable Object. The authoritative current round, participant hashes, processed batches and historical rounds stay inside its storage. There is no D1, VPS, external font, image dependency, analytics, login or sound.

`GET /api/state` uses a two-second edge cache. Visible browsers poll every ten seconds. Click feedback is immediate. Network submission batches every second or at twenty hits, with at most fifty hits per request. Each batch keeps its UUID across retries. Pending hits are bounded at 500 and live only in memory. Page hiding attempts a keepalive flush. Unacknowledged hits can be lost if a page closes while another request is in flight.

SQLite synchronous transactions atomically check batch identity, insert/update the participant, increment the round and record the batch. One browser contributes at most one fan per round, based on its anonymous visitor UUID. IDs are salted and SHA-256 hashed in the Worker; the DO stores only hashes. No IP addresses or browser fingerprints are stored by the application. Clearing local storage creates a new anonymous identity. Per-hash in-memory rate limiting is intentionally lightweight (120 new batches/minute, capped at 10,000 active entries); it resets on object eviction. Normal rapid tapping stays immediate.

## Develop and test

Node 22+ is recommended.

```sh
npm ci
# Create ignored .dev.vars with local-only values for:
# VISITOR_HASH_SALT and ADMIN_RESET_SECRET
npm run check
npm test
npm run dev
```

The first state request, and the Cron, attempt to initialize from the newest verified event. With an unavailable/stale feed and no stored round, state returns 503; the rendered page remains available. No demo counts or fabricated timestamp are used.

## Cloudflare deployment

```sh
npx wrangler whoami
npx wrangler secret put VISITOR_HASH_SALT
npx wrangler secret put ADMIN_RESET_SECRET
npm run deploy
```

Use unique cryptographically random secret values, not the local development examples. Config creates the independent `codex-reset-raid` Worker, `RAID` binding, v1 SQLite migration, five-minute Cron, and `reset.wowtools.ai` custom domain. Existing wowtools DNS/routes/workers must be left intact. Do not upgrade the account plan automatically. Check current plan limits before heavy traffic. Worker Free and SQLite DO Free quotas may pause service if exceeded; see Cloudflare's current limits documentation.

## API

`GET /api/state` returns `roundId`, `fans`, `hits`, `lastResetAt`, `sourceUrl`, `hpDecayK`, `updatedAt`. `POST /api/hit` takes `{roundId, visitorId, batchId, hits}`. Visitor/batch IDs must be v4 UUIDs; hits must be an integer from 1 to 50. Body limit is 2 KiB. Browser writes require the same Origin. A duplicate batch returns `duplicateBatch:true` without incrementing. Old rounds return 409 `round_changed` plus latest state. Reusing a batch ID with different content returns 409 `batch_conflict`. The client discards old-round pending hits instead of carrying them into the new round.

## Health

`HP% = 100 × exp(-hits / K)`, default `HP_DECAY_K=5000`. The client formats from `log10(HP%) = 2 - hits/(K × ln(10))`, switching to scientific notation for tiny values. Natural hit counts never display zero, even after floating-point underflow would occur. Only the reset transition displays `0%`; minimum SVG fill width is visual only. Six expression states track the decay. Reduced-motion preference removes recoil, flying damage and death motion; numbers and transitions remain functional.

## Reset detection

Every five minutes the Worker reads `https://tibo.cc/api/v1/resets?limit=10`. HTTP 200, a non-stale/non-prediction payload, stable event ID, regular/full/global type, X post by `thsottiaux`, HTTPS public source link and valid non-future announcement time are required. Banked types and explicitly banked text are ignored. Unknown/malformed events, failed fetches, predictions and stale responses do nothing. Duplicate or older/equal-time events do not change the round. Bootstrap chooses only the newest eligible event. Subsequent new events close the old round and create the next, preserving history.

The feed is community aggregation, not an official webhook. Announcement time need not be the exact time every account receives a reset. Feed guide: https://tibo.cc/guide/api ; upstream: https://codex-resets.com . The reset-time link points to the original public announcement.

## Manual verified reset fallback

There is no public admin UI. A secret-protected `POST /api/admin/reset` accepts one verified event and performs the same atomic close/insert operation. It never clears existing history. Supply the original event including id, type, announced_at, text, and source metadata. It uses the same conservative validation and cannot apply banked or prediction events. Keep the admin secret out of Git and shell history.

```sh
# Set ADMIN_RESET_SECRET securely in the current shell first.
npm run manual-reset -- https://reset.wowtools.ai verified-event.json
```

The handoff suggested `wrangler d1 execute` for manual repairs; this project deliberately has no D1. The authenticated DO endpoint is the correct alternative. Repeated submission of the same verified event is a no-op. To correct a bad stored event, inspect Cloudflare Durable Object Data Studio and take an export before any reviewed SQL repair; do not submit invented events.

## Rollback

Use `npx wrangler deployments list` and `npx wrangler rollback VERSION_ID` to restore a previous Worker version. Never remove or rename the DO binding/class/migration: persisted rounds and hashes must remain intact. Rolling back code does not roll back SQLite data. Test a backup restoration separately before making manual historical edits.

## Disclaimer

This is an unofficial fan site and is not affiliated with OpenAI.
Reset timing is inferred from public community aggregation of public announcements and is not an official OpenAI status feed.

## Live deployment — 2026-10-08

Live: https://reset.wowtools.ai . Worker `codex-reset-raid`; SQLite `ResetRaidDO / global`; Cron `*/5 * * * *`. Public workers.dev and preview URLs are disabled. The Cloudflare account required its first workers.dev namespace to be initialized before Static Assets upload; namespace `wowtools-reset-raid` is not an additional public entry point for this site. No other Worker or existing custom domain was changed.

The initial round was the latest fresh eligible public event `2107676072871600470`, announced 2026-10-07T03:35:09Z, with zero fans and hits. Production HTTPS, current DO state, six viewports and exact asset/source SHA-256 match were verified. Existing wowtools.ai, along.wowtools.ai, s.wowtools.ai and r.wowtools.ai all returned 200. Original Along Worker metadata and custom-domain mapping matched the pre-deployment snapshot.

Ten local tests passed, including real SQLite DO atomic counting and batch idempotency, conservative feed selection and Cron fetch behavior. After explicit user authorization, production write tests contributed exactly 60 real hits and 3 anonymous fans. Live checks passed: duplicate batch does not count twice, repeat visitor does not add another fan, concurrent +10/+10 sums correctly, rapid taps submit in batches, invalid/over-limit/cross-origin/old-round requests are rejected, duplicate verified reset is a no-op, and banked/prediction/stale reset inputs are rejected. No production reset was fabricated or triggered; Full Reset animation and round transition passed local tests. The temporary QA Worker was removed. Redeployment preserved the production round, its 60 hits and 3 fans, confirming SQLite persistence across deployment. The Cron schedule is registered; its actual timed invocation has not yet been observed.

The deployment token cannot read account subscriptions (403), so the Workers plan is unconfirmed; no purchase or upgrade was made. `verification.json` records the scope and remaining limitations.

## Make it more fun

This project is open source under the MIT license. Fork [codexreset](https://github.com/bluedavy/codexreset), suggest an idea in Issues, or submit a pull request. See [CONTRIBUTING.md](CONTRIBUTING.md) for local setup, checks and the game’s core constraints. The live site is maintained separately; opening a pull request does not deploy to production.
