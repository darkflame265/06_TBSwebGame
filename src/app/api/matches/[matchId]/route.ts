import { NextResponse } from "next/server";

export const preferredRegion = "icn1";
import { z } from "zod";
import { getAuthedClient, jsonError } from "@/lib/api";
import { createAdminSupabase, createUserSupabaseFromRequest } from "@/lib/supabase/server";
import { generateObstacles, seedForMatchRound, type Coord } from "@/lib/obstacles";

const paramsSchema = z.object({
  matchId: z.string().uuid()
});
const AI_USER_ID = "00000000-0000-0000-0000-000000000001";

type Context = {
  params: Promise<{ matchId: string }>;
};

type SupabaseClient = NonNullable<ReturnType<typeof createUserSupabaseFromRequest>>;

type MatchRow = {
  type: string;
  created_at: string | null;
  [key: string]: unknown;
};

async function ensurePlanningObstaclesForSnapshot(
  matchData: MatchRow,
  matchId: string,
): Promise<{ error: string | null; updated: boolean }> {
  if (
    matchData.phase !== "planning" ||
    !matchData.board_state ||
    matchData.obstacles_turn === matchData.current_turn
  ) {
    return { error: null, updated: false };
  }

  const boardState = matchData.board_state as { p1: Coord; p2: Coord };
  const currentTurn = matchData.current_turn as number;
  const p1 = boardState.p1;
  const p2 = boardState.p2;
  const chaserPos = matchData.attacker_slot === 1 ? p1 : p2;
  const runnerPos = matchData.attacker_slot === 1 ? p2 : p1;
  const seed = seedForMatchRound(matchId, currentTurn);
  const generated = generateObstacles({
    gridSize: 5,
    chaserPos,
    runnerPos,
    obstacleCount: 3,
    seed
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
      obstacles_turn: currentTurn
    })
    .eq("id", matchId)
    .eq("current_turn", currentTurn)
    .eq("phase", "planning");

  if (updateObstacleError) {
    return { error: updateObstacleError.message, updated: false };
  }

  matchData.obstacles = obstacleArray;
  matchData.obstacles_turn = currentTurn;
  return { error: null, updated: true };
}

async function buildMatchResponse(
  matchData: MatchRow,
  matchId: string,
  client: SupabaseClient,
  options?: {
    turnScope?: "all" | "current";
    includeProfiles?: boolean;
    includePlayers?: boolean;
  }
): Promise<NextResponse> {
  const currentTurn =
    typeof matchData.current_turn === "number" ? matchData.current_turn : null;
  let turnsQuery = client
    .from("turns")
    .select("id,turn_number,player_slot,action_payload,created_by,created_at")
    .eq("match_id", matchId);
  if (options?.turnScope === "current" && currentTurn !== null) {
    turnsQuery = turnsQuery.eq("turn_number", currentTurn);
  }

  const turnsResult = await turnsQuery.order("turn_number", { ascending: true });
  if (turnsResult.error) {
    return jsonError(turnsResult.error.message, 400);
  }

  if (options?.includePlayers === false) {
    return NextResponse.json({
      ...matchData,
      turns: turnsResult.data ?? []
    });
  }

  const playersResult = await client
    .from("match_players")
    .select("user_id,slot,joined_at")
    .eq("match_id", matchId)
    .order("slot", { ascending: true });

  if (playersResult.error) {
    return jsonError(playersResult.error.message, 400);
  }

  const playerRows = playersResult.data ?? [];
  const normalizedPlayers =
    matchData.type === "ai" && !playerRows.some((p) => p.slot === 2)
      ? [...playerRows, { user_id: AI_USER_ID, slot: 2, joined_at: matchData.created_at }]
      : playerRows;
  const playerIds = normalizedPlayers.map((p) => p.user_id).filter((id) => id !== AI_USER_ID);
  const nicknameMap = new Map<string, string | null>();
  const statsMap = new Map<string, { wins: number; losses: number; win_rate: number }>();

  if (options?.includeProfiles !== false && playerIds.length > 0) {
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
        win_rate: Number(row.win_rate ?? 0)
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
      win_rate: player.user_id === AI_USER_ID ? 0 : (statsMap.get(player.user_id)?.win_rate ?? 0)
    })),
    turns: turnsResult.data ?? []
  });
}

export async function POST(request: Request, context: Context) {
  const timings: string[] = [];
  const addTiming = (name: string, start: number) => {
    timings.push(`${name};dur=${(performance.now() - start).toFixed(1)}`);
  };
  const withTiming = (response: NextResponse) => {
    if (timings.length > 0) {
      response.headers.set("Server-Timing", timings.join(", "));
      response.headers.set("X-Debug-Timing", timings.join(" | "));
    }
    return response;
  };

  const authStart = performance.now();
  const { error, client } = await getAuthedClient(request);
  addTiming("auth", authStart);
  if (error || !client) {
    return withTiming(error ?? jsonError("Unauthorized", 401));
  }

  const paramsStart = performance.now();
  const rawParams = await context.params;
  const parsedParams = paramsSchema.safeParse(rawParams);
  addTiming("params", paramsStart);
  if (!parsedParams.success) {
    return withTiming(jsonError("Invalid match id", 400));
  }
  const { matchId } = parsedParams.data;
  const view = new URL(request.url).searchParams.get("view");
  const turnScope = view === "live" ? "current" : "all";
  const includeProfiles = view !== "live";
  const includePlayers = view !== "live";

  if (view === "live") {
    const liveRpcStart = performance.now();
    const { data: liveSnapshot, error: liveRpcError } = await client.rpc(
      "tick_match_live_snapshot",
      {
        p_match_id: matchId,
        p_turn_scope: turnScope,
      },
    );
    addTiming("tick_live_snapshot_rpc", liveRpcStart);

    if (!liveRpcError && liveSnapshot) {
      return withTiming(NextResponse.json(liveSnapshot));
    }
    addTiming("tick_live_snapshot_fallback", liveRpcStart);

    // Lightweight fallback: tick -> live snapshot RPC.
    const tickStart = performance.now();
    const { error: tickError } = await client.rpc("tick_match_round", {
      p_match_id: matchId,
    });
    addTiming("tick_round_rpc", tickStart);
    if (tickError) {
      return withTiming(jsonError(tickError.message, 400));
    }

    const liveReadStart = performance.now();
    const { data: liveReadSnapshot, error: liveReadError } = await client.rpc(
      "get_match_live_snapshot",
      {
        p_match_id: matchId,
        p_turn_scope: "current",
      },
    );
    addTiming("get_live_snapshot_rpc", liveReadStart);
    if (liveReadError) {
      return withTiming(jsonError(liveReadError.message, 400));
    }
    if (!liveReadSnapshot) {
      return withTiming(jsonError("Failed to load live snapshot", 400));
    }
    return withTiming(NextResponse.json(liveReadSnapshot));
  }

  const tickStart = performance.now();
  const { error: tickError } = await client.rpc("tick_match_round", {
    p_match_id: matchId
  });
  addTiming("tick_round_rpc", tickStart);
  if (tickError) {
    return withTiming(jsonError(tickError.message, 400));
  }

  // Single read with all fields ??used for both mutation logic and the final response
  const matchSelectStart = performance.now();
  const { data: matchData, error: matchError } = await client
    .from("matches")
    .select(
      "id,type,status,room_code,current_turn,current_player_slot,winner_slot,ended_reason,left_by,ended_at,board_state,obstacles,obstacles_turn,phase,planning_ends_at,resolution_ends_at,resolved_paths,p1_hp,p2_hp,attacker_slot,rematch_p1_requested,rematch_p2_requested,rematch_match_id,created_at"
    )
    .eq("id", matchId)
    .maybeSingle();
  addTiming("matches_select", matchSelectStart);

  if (matchError) {
    return withTiming(jsonError(matchError.message, 400));
  }
  if (!matchData) {
    return withTiming(jsonError("Match not found", 404));
  }

  if (view === "live") {
    const obstacleStart = performance.now();
    const obstacleResult = await ensurePlanningObstaclesForSnapshot(
      matchData as MatchRow,
      matchId,
    );
    addTiming("ensure_obstacles_post", obstacleStart);
    if (obstacleResult.error) {
      return withTiming(jsonError(obstacleResult.error, 400));
    }
  }

  const responseBuildStart = performance.now();
  const response = await buildMatchResponse(matchData, matchId, client, {
    turnScope,
    includeProfiles,
    includePlayers
  });
  addTiming("build_response", responseBuildStart);
  return withTiming(response);
}

export async function GET(request: Request, context: Context) {
  const timings: string[] = [];
  const addTiming = (name: string, start: number) => {
    timings.push(`${name};dur=${(performance.now() - start).toFixed(1)}`);
  };
  const withTiming = (response: NextResponse) => {
    if (timings.length > 0) {
      response.headers.set("Server-Timing", timings.join(", "));
      response.headers.set("X-Debug-Timing", timings.join(" | "));
    }
    return response;
  };

  const authStart = performance.now();
  const { error, client } = await getAuthedClient(request);
  addTiming("auth", authStart);
  if (error || !client) {
    return withTiming(error ?? jsonError("Unauthorized", 401));
  }

  const paramsStart = performance.now();
  const rawParams = await context.params;
  const parsedParams = paramsSchema.safeParse(rawParams);
  addTiming("params", paramsStart);
  if (!parsedParams.success) {
    return withTiming(jsonError("Invalid match id", 400));
  }
  const { matchId } = parsedParams.data;
  const view = new URL(request.url).searchParams.get("view");
  const turnScope = view === "live" ? "current" : "all";
  const includeProfiles = view !== "live";
  const includePlayers = view !== "live";

  if (view === "live") {
    const liveReadStart = performance.now();
    const { data: liveSnapshot, error: liveError } = await client.rpc(
      "get_match_live_snapshot",
      {
        p_match_id: matchId,
        p_turn_scope: turnScope,
      },
    );
    addTiming("get_live_snapshot_rpc", liveReadStart);
    if (!liveError && liveSnapshot) {
      return withTiming(NextResponse.json(liveSnapshot));
    }
    addTiming("get_live_snapshot_fallback", liveReadStart);
    return withTiming(
      jsonError(liveError?.message ?? "Failed to load live snapshot", 400),
    );
  }

  const matchSelectStart = performance.now();
  const { data: matchData, error: matchError } = await client
    .from("matches")
    .select(
      "id,type,status,room_code,current_turn,current_player_slot,winner_slot,ended_reason,left_by,ended_at,board_state,obstacles,obstacles_turn,phase,planning_ends_at,resolution_ends_at,resolved_paths,p1_hp,p2_hp,attacker_slot,rematch_p1_requested,rematch_p2_requested,rematch_match_id,created_at"
    )
    .eq("id", matchId)
    .maybeSingle();
  addTiming("matches_select", matchSelectStart);

  if (matchError) {
    return withTiming(jsonError(matchError.message, 400));
  }
  if (!matchData) {
    return withTiming(jsonError("Match not found", 404));
  }

  // Correctness fallback: if planning started without obstacle provisioning signal,
  // provision once on GET to prevent clients from being stuck in "Preparing obstacle layout...".
  if (view === "live") {
    const obstacleStart = performance.now();
    const obstacleResult = await ensurePlanningObstaclesForSnapshot(
      matchData as MatchRow,
      matchId,
    );
    addTiming("ensure_obstacles_get", obstacleStart);
    if (obstacleResult.error) {
      return withTiming(jsonError(obstacleResult.error, 400));
    }
  }

  const responseBuildStart = performance.now();
  const response = await buildMatchResponse(matchData, matchId, client, {
    turnScope,
    includeProfiles,
    includePlayers
  });
  addTiming("build_response", responseBuildStart);
  return withTiming(response);
}


