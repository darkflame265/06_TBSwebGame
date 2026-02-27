# Design: Separate Tick from Read

**Date:** 2026-02-27
**Status:** Approved

## Problem

`POST /api/matches/{id}` mixes two concerns:

1. **Game tick** — `tick_match_round()`, obstacle generation, AI bot turn submission (DB writes)
2. **State read** — 5 DB queries returning full match snapshot

Both the 1000ms polling interval and Supabase Realtime events call this same endpoint, causing redundant ticks and unnecessary DB load.

## Solution

Split the endpoint into two:

- `POST /api/matches/{id}/tick` — tick only, returns `{ ok: true }`
- `GET /api/matches/{id}` — pure read, returns full match snapshot

Client intervals:

| Role | Before | After |
|---|---|---|
| Game tick | 1000ms POST (tick + read) | 3000ms POST `/tick` |
| State delivery | Realtime → POST (tick + read) | Realtime → GET (read only) |
| turns INSERT | POST (tick + read) | `tickMatch()` immediately, then GET |
| Fallback read | none | 10000ms GET (Realtime failure guard) |

## Files Changed

| File | Change |
|---|---|
| `src/app/api/matches/[matchId]/route.ts` | Add `GET` handler (pure read). Keep `POST` for backward compat or remove. |
| `src/app/api/matches/[matchId]/tick/route.ts` | New file — tick + AI bot + obstacle logic only |
| `src/components/match-client.tsx` | `loadMatch` → GET, new `tickMatch`, revised intervals |

## Data Flow After Change

```
[Tick path — every 3s + on turns INSERT]
Client → POST /tick → tick_match_round + bot + obstacles → DB write
DB write → Supabase Realtime fires

[Read path — on Realtime event]
Realtime event → GET /api/matches/{id} → SELECT × 5 → return state

[Fallback — every 10s]
GET /api/matches/{id} (guards against Realtime outage)
```

## Constraints

- Bot AI logic (`generatePathForRole`) stays in the API route (TypeScript, not PostgreSQL)
- Supabase Realtime subscription already exists in `match-client.tsx` — no channel setup needed
- `GET` endpoint shares the same 5-query read logic currently in `POST`
- Tick endpoint returns minimal JSON to reduce response size
