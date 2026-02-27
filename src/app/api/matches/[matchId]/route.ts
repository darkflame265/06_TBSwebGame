import { NextResponse } from "next/server";

export const preferredRegion = "icn1";
import { z } from "zod";
import { getAuthedClient, jsonError } from "@/lib/api";
import { createUserSupabaseFromRequest } from "@/lib/supabase/server";

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

  const responseBuildStart = performance.now();
  const response = await buildMatchResponse(matchData, matchId, client, {
    turnScope,
    includeProfiles,
    includePlayers
  });
  addTiming("build_response", responseBuildStart);
  return withTiming(response);
}


