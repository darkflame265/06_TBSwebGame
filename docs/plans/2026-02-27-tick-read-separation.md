# Tick/Read Separation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Separate game tick side-effects from match state reads so Supabase Realtime delivers state and polling only drives the tick.

**Architecture:** Add `GET /api/matches/[matchId]` (pure read, 5 DB queries) and `POST /api/matches/[matchId]/tick` (tick + AI bot, no read). Client calls GET on Realtime events and POST /tick on a 3 s interval plus on `turns` INSERT. A 10 s fallback GET poll guards against Realtime outages.

**Tech Stack:** Next.js 15 App Router, Supabase JS v2, TypeScript

---

### Task 1: Add `GET /api/matches/[matchId]`

**Files:**
- Modify: `src/app/api/matches/[matchId]/route.ts`

The existing `POST` already has the full read logic (lines 39–218). Add a `GET` export that re-uses it — only the read portion, no tick/obstacle/bot logic.

**Step 1: Add GET handler to route.ts**

Open `src/app/api/matches/[matchId]/route.ts`. After the closing brace of the `POST` function, add:

```typescript
export async function GET(request: Request, context: Context) {
  const { error, client } = await getAuthedUser(request);
  if (error || !client) {
    return error ?? jsonError("Unauthorized", 401);
  }

  const rawParams = await context.params;
  const parsedParams = paramsSchema.safeParse(rawParams);
  if (!parsedParams.success) {
    return jsonError("Invalid match id", 400);
  }
  const { matchId } = parsedParams.data;

  const { data: matchData, error: matchError } = await client
    .from("matches")
    .select(
      "id,type,status,room_code,current_turn,current_player_slot,winner_slot,ended_reason,left_by,ended_at,board_state,obstacles,obstacles_turn,phase,planning_ends_at,resolution_ends_at,resolved_paths,p1_hp,p2_hp,attacker_slot,rematch_p1_requested,rematch_p2_requested,rematch_match_id,created_at"
    )
    .eq("id", matchId)
    .maybeSingle();

  if (matchError) {
    return jsonError(matchError.message, 400);
  }
  if (!matchData) {
    return jsonError("Match not found", 404);
  }

  const [playersResult, turnsResult] = await Promise.all([
    client
      .from("match_players")
      .select("user_id,slot,joined_at")
      .eq("match_id", matchId)
      .order("slot", { ascending: true }),
    client
      .from("turns")
      .select("id,turn_number,player_slot,action_payload,created_by,created_at")
      .eq("match_id", matchId)
      .order("turn_number", { ascending: true }),
  ]);

  if (playersResult.error) {
    return jsonError(playersResult.error.message, 400);
  }
  if (turnsResult.error) {
    return jsonError(turnsResult.error.message, 400);
  }

  const AI_USER_ID = "00000000-0000-0000-0000-000000000001";
  const playerRows = playersResult.data ?? [];
  const normalizedPlayers =
    matchData.type === "ai" && !playerRows.some((p) => p.slot === 2)
      ? [...playerRows, { user_id: AI_USER_ID, slot: 2, joined_at: matchData.created_at }]
      : playerRows;
  const playerIds = normalizedPlayers.map((p) => p.user_id).filter((id) => id !== AI_USER_ID);
  const nicknameMap = new Map<string, string | null>();
  const statsMap = new Map<string, { wins: number; losses: number; win_rate: number }>();

  if (playerIds.length > 0) {
    const { data: profileRows, error: profilesError } = await client
      .from("user_profiles")
      .select("user_id,nickname")
      .in("user_id", playerIds);

    if (profilesError) {
      return jsonError(profilesError.message, 400);
    }
    for (const profile of profileRows ?? []) {
      nicknameMap.set(profile.user_id, profile.nickname ?? null);
    }

    const { data: statRows, error: statsError } = await client.rpc(
      "get_user_match_stats",
      { p_user_ids: playerIds }
    );
    if (statsError) {
      return jsonError(statsError.message, 400);
    }
    for (const row of statRows ?? []) {
      const userId = row.user_id as string;
      statsMap.set(userId, {
        wins: Number(row.wins ?? 0),
        losses: Number(row.losses ?? 0),
        win_rate: Number(row.win_rate ?? 0),
      });
    }
  }

  return NextResponse.json({
    ...matchData,
    players: normalizedPlayers.map((player) => ({
      ...player,
      nickname: player.user_id === AI_USER_ID ? "AI Bot" : (nicknameMap.get(player.user_id) ?? null),
      wins: player.user_id === AI_USER_ID ? 0 : (statsMap.get(player.user_id)?.wins ?? 0),
      losses: player.user_id === AI_USER_ID ? 0 : (statsMap.get(player.user_id)?.losses ?? 0),
      win_rate: player.user_id === AI_USER_ID ? 0 : (statsMap.get(player.user_id)?.win_rate ?? 0),
    })),
    turns: turnsResult.data ?? [],
  });
}
```

**Step 2: Verify GET responds (manual)**

```bash
# Get a match ID from the browser URL bar while on a match page, then:
curl -H "Authorization: Bearer <token>" http://localhost:3000/api/matches/<matchId>
# Expected: 200 JSON with id, status, players, turns fields
```

**Step 3: Commit**

```bash
git add src/app/api/matches/[matchId]/route.ts
git commit -m "feat: add GET /api/matches/[matchId] pure read handler"
```

---

### Task 2: Create `POST /api/matches/[matchId]/tick`

**Files:**
- Create: `src/app/api/matches/[matchId]/tick/route.ts`

This file contains only the tick/obstacle/bot logic extracted from the existing `POST` handler — no full data read at the end.

**Step 1: Create the tick route file**

Create `src/app/api/matches/[matchId]/tick/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthedUser, jsonError } from "@/lib/api";
import { createAdminSupabase } from "@/lib/supabase/server";
import { generateObstacles, seedForMatchRound, type Coord } from "@/lib/obstacles";
import { generatePathForRole } from "@/lib/ai-planner";

const paramsSchema = z.object({
  matchId: z.string().uuid(),
});
const AI_USER_ID = "00000000-0000-0000-0000-000000000001";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Context = {
  params: Promise<{ matchId: string }>;
};

export async function POST(request: Request, context: Context) {
  const { error, client } = await getAuthedUser(request);
  if (error || !client) {
    return error ?? jsonError("Unauthorized", 401);
  }

  const rawParams = await context.params;
  const parsedParams = paramsSchema.safeParse(rawParams);
  if (!parsedParams.success) {
    return jsonError("Invalid match id", 400);
  }
  const { matchId } = parsedParams.data;

  const { error: tickError } = await client.rpc("tick_match_round", {
    p_match_id: matchId,
  });
  if (tickError) {
    return jsonError(tickError.message, 400);
  }

  const { data: matchData, error: matchError } = await client
    .from("matches")
    .select(
      "id,type,status,phase,current_turn,board_state,obstacles,obstacles_turn,attacker_slot"
    )
    .eq("id", matchId)
    .maybeSingle();

  if (matchError) {
    return jsonError(matchError.message, 400);
  }
  if (!matchData) {
    return jsonError("Match not found", 404);
  }

  // Obstacle generation
  if (
    matchData.phase === "planning" &&
    matchData.board_state &&
    matchData.obstacles_turn !== matchData.current_turn
  ) {
    const p1 = matchData.board_state.p1 as Coord;
    const p2 = matchData.board_state.p2 as Coord;
    const chaserPos = matchData.attacker_slot === 1 ? p1 : p2;
    const runnerPos = matchData.attacker_slot === 1 ? p2 : p1;
    const seed = seedForMatchRound(matchId, matchData.current_turn);
    const generated = generateObstacles({
      gridSize: 5,
      chaserPos,
      runnerPos,
      obstacleCount: 3,
      seed,
    });
    const obstacleArray = Array.from(generated).map((key) => {
      const [x, y] = key.split(",").map(Number);
      return [x, y] as [number, number];
    });

    const admin = createAdminSupabase();
    const { error: updateObstacleError } = await admin
      .from("matches")
      .update({
        obstacles: obstacleArray,
        obstacles_turn: matchData.current_turn,
      })
      .eq("id", matchId)
      .eq("current_turn", matchData.current_turn)
      .eq("phase", "planning");

    if (updateObstacleError) {
      return jsonError(updateObstacleError.message, 400);
    }

    matchData.obstacles = obstacleArray;
    matchData.obstacles_turn = matchData.current_turn;
  }

  // AI bot turn submission
  if (matchData.type === "ai" && matchData.status === "active" && matchData.phase === "planning") {
    const { data: currentTurns, error: turnsError } = await client
      .from("turns")
      .select("player_slot")
      .eq("match_id", matchId)
      .eq("turn_number", matchData.current_turn);

    if (turnsError) {
      return jsonError(turnsError.message, 400);
    }

    const botAlreadySubmitted = (currentTurns ?? []).some((t) => t.player_slot === 2);
    if (!botAlreadySubmitted && matchData.board_state) {
      const p1 = matchData.board_state.p1 as Coord;
      const p2 = matchData.board_state.p2 as Coord;
      const maxPoints = Math.min(matchData.current_turn + 4, 10);
      const role = matchData.attacker_slot === 2 ? "ATTACK" : "EVADE";
      const planningObstacles = (matchData.obstacles ?? []) as Coord[];
      const path = generatePathForRole({
        gridSize: 5,
        role,
        maxPoints,
        selfPos: p2,
        opponentPos: p1,
        obstacles: planningObstacles,
      });

      await sleep(10 + Math.floor(Math.random() * 31));

      const { error: botSubmitError } = await client.rpc("submit_bot_turn", {
        p_match_id: matchId,
        p_round: matchData.current_turn,
        p_action: { path },
      });

      if (botSubmitError) {
        const msg = botSubmitError.message.toLowerCase();
        const ignorable =
          msg.includes("stale round") ||
          msg.includes("planning window closed") ||
          msg.includes("round is resolving");
        if (!ignorable) {
          return jsonError(botSubmitError.message, 400);
        }
      }
    }
  }

  return NextResponse.json({ ok: true });
}
```

**Step 2: Verify tick route works (manual)**

Start the dev server, open a match in the browser, then:
```bash
curl -X POST -H "Authorization: Bearer <token>" http://localhost:3000/api/matches/<matchId>/tick
# Expected: 200 {"ok":true}
# Also: no errors in the dev server terminal
```

**Step 3: Commit**

```bash
git add src/app/api/matches/[matchId]/tick/route.ts
git commit -m "feat: add POST /api/matches/[matchId]/tick handler"
```

---

### Task 3: Update `match-client.tsx` polling logic

**Files:**
- Modify: `src/components/match-client.tsx`

Three changes:
1. `loadMatch` uses `apiGet` instead of `apiPost`
2. New `tickMatch` function calling `/tick`
3. Replace the single 1000ms poll with a 3 s tick interval + 10 s fallback load interval + immediate tick on `turns` INSERT

**Step 1: Update `loadMatch` to use GET**

Find in `match-client.tsx` (around line 468–564):
```typescript
const loadMatch = async () => {
  try {
    const data = await apiPost<MatchResponse>(`/api/matches/${matchId}`);
```

Change `apiPost` → `apiGet`:
```typescript
const loadMatch = async () => {
  try {
    const data = await apiGet<MatchResponse>(`/api/matches/${matchId}`);
```

**Step 2: Add `tickMatch` function**

After the `loadMatch` function closing brace, add:
```typescript
const tickMatch = async () => {
  try {
    await apiPost(`/api/matches/${matchId}/tick`);
  } catch {
    // tick is best-effort; loadMatch fallback poll still keeps state fresh
  }
};
```

**Step 3: Replace the polling `useEffect`**

Find the existing polling effect (around line 690–699):
```typescript
useEffect(() => {
  // NOTE:
  // POST /api/matches/[matchId] performs server-side tick alongside the read.
  // Periodic loadMatch calls are required regardless of realtime health
  // so that phase progression (resolving → planning) is never stalled.
  const pollMs = match?.status === "active" ? 1000 : 3000;
  const poll = setInterval(() => loadMatch(), pollMs);
  return () => clearInterval(poll);
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [matchId, match?.status]);
```

Replace it with two separate intervals:
```typescript
useEffect(() => {
  // Tick interval: drives game phase progression and AI bot moves.
  // Realtime handles state delivery; this only needs to fire often enough
  // to ensure timer-based transitions happen within ~3 s of the deadline.
  if (match?.status !== "active") return;
  const tick = setInterval(() => void tickMatch(), 3000);
  return () => clearInterval(tick);
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [matchId, match?.status]);

useEffect(() => {
  // Fallback read poll: guards against Realtime connection failures.
  // Under normal conditions Realtime drives state; this is a safety net.
  const fallback = setInterval(() => void loadMatch(), 10000);
  return () => clearInterval(fallback);
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [matchId]);
```

**Step 4: Add immediate tick on `turns` INSERT in the Realtime effect**

Find the Realtime subscription (around line 707–775). Locate the `turns` INSERT handler:
```typescript
.on(
  "postgres_changes",
  {
    event: "INSERT",
    schema: "public",
    table: "turns",
    filter: `match_id=eq.${matchId}`,
  },
  () => loadMatch(),
)
```

Change it to tick then load:
```typescript
.on(
  "postgres_changes",
  {
    event: "INSERT",
    schema: "public",
    table: "turns",
    filter: `match_id=eq.${matchId}`,
  },
  () => { void tickMatch(); void loadMatch(); },
)
```

**Step 5: Manual verification**

1. Open the game in the browser (http://localhost:3000)
2. Start an AI match
3. Open DevTools → Network tab
4. Observe requests during a planning phase:
   - Every ~3 s: `POST /api/matches/{id}/tick` (small, fast)
   - On Supabase Realtime event: `GET /api/matches/{id}` (replaces old 1 s POST)
   - Every 10 s: `GET /api/matches/{id}` fallback
5. Confirm the game progresses normally through multiple rounds

**Step 6: Commit**

```bash
git add src/components/match-client.tsx
git commit -m "refactor: separate tick from read in match polling"
```

---

### Task 4: Smoke test full AI match

**Step 1: Start dev server**

```bash
npm run dev
```

**Step 2: Play a complete AI match**

1. Open http://localhost:3000
2. Sign in anonymously
3. Click "Start AI Match"
4. Play until the match ends (win or lose)
5. Verify:
   - All rounds progress (planning → resolving → planning)
   - AI bot submits moves each round
   - No error messages appear in the UI
   - No `500` or `400` responses in DevTools Network

**Step 3: Confirm request volume is reduced**

In DevTools Network, filter by `api/matches`. Compare:
- Old: `POST /api/matches/{id}` every ~1 s during a round
- New: `POST /api/matches/{id}/tick` every ~3 s + `GET /api/matches/{id}` on Realtime events

**Step 4: Final commit if any cleanup needed**

```bash
git add -p
git commit -m "chore: cleanup after tick/read separation"
```
