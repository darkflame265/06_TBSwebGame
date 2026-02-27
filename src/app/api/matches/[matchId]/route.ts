import { NextResponse } from "next/server";

export const preferredRegion = "icn1";
import { z } from "zod";
import { getAuthedUser, jsonError } from "@/lib/api";
import { createAdminSupabase, createUserSupabaseFromRequest } from "@/lib/supabase/server";
import { generateObstacles, seedForMatchRound, type Coord } from "@/lib/obstacles";
import { generatePathForRole } from "@/lib/ai-planner";

const paramsSchema = z.object({
  matchId: z.string().uuid()
});
const AI_USER_ID = "00000000-0000-0000-0000-000000000001";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Context = {
  params: Promise<{ matchId: string }>;
};

type SupabaseClient = NonNullable<ReturnType<typeof createUserSupabaseFromRequest>>;

type MatchRow = {
  type: string;
  created_at: string | null;
  [key: string]: unknown;
};

async function buildMatchResponse(
  matchData: MatchRow,
  matchId: string,
  client: SupabaseClient
): Promise<NextResponse> {
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
      .order("turn_number", { ascending: true })
  ]);

  if (playersResult.error) {
    return jsonError(playersResult.error.message, 400);
  }
  if (turnsResult.error) {
    return jsonError(turnsResult.error.message, 400);
  }

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
    p_match_id: matchId
  });
  if (tickError) {
    return jsonError(tickError.message, 400);
  }

  // Single read with all fields ??used for both mutation logic and the final response
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

  let planningObstacles = (matchData.obstacles ?? []) as Coord[];

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
      seed
    });
    const obstacleArray = Array.from(generated).map((key) => {
      const [x, y] = key.split(",").map(Number);
      return [x, y] as [number, number];
    });
    planningObstacles = obstacleArray;

    const admin = createAdminSupabase();
    const { error: updateObstacleError } = await admin
      .from("matches")
      .update({
        obstacles: obstacleArray,
        obstacles_turn: matchData.current_turn
      })
      .eq("id", matchId)
      .eq("current_turn", matchData.current_turn)
      .eq("phase", "planning");

    if (updateObstacleError) {
      return jsonError(updateObstacleError.message, 400);
    }

    // Reflect the write in the local object to avoid a redundant re-query
    matchData.obstacles = obstacleArray;
    matchData.obstacles_turn = matchData.current_turn;
  }

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
      const path = generatePathForRole({
        gridSize: 5,
        role,
        maxPoints,
        selfPos: p2,
        opponentPos: p1,
        obstacles: planningObstacles
      });

      await sleep(10 + Math.floor(Math.random() * 31));

      const { error: botSubmitError } = await client.rpc("submit_bot_turn", {
        p_match_id: matchId,
        p_round: matchData.current_turn,
        p_action: { path }
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

  return buildMatchResponse(matchData, matchId, client);
}

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

  return buildMatchResponse(matchData, matchId, client);
}

