import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthedUser, jsonError } from "@/lib/api";

const paramsSchema = z.object({
  matchId: z.string().uuid()
});

type Context = {
  params: Promise<{ matchId: string }>;
};

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

  const { error: connectError } = await client.rpc("mark_player_connected", {
    p_match_id: matchId
  });
  if (connectError && !connectError.message.toLowerCase().includes("mark_player_connected")) {
    return jsonError(connectError.message, 400);
  }

  const { error: tickError } = await client.rpc("tick_match_round", {
    p_match_id: matchId
  });
  if (tickError) {
    return jsonError(tickError.message, 400);
  }

  const [matchResult, playersResult, turnsResult] = await Promise.all([
    client
      .from("matches")
      .select(
        "id,type,status,room_code,current_turn,current_player_slot,winner_slot,ended_reason,left_by,ended_at,board_state,phase,planning_ends_at,resolution_ends_at,resolved_paths,p1_hp,p2_hp,attacker_slot,rematch_p1_requested,rematch_p2_requested,rematch_match_id,created_at"
      )
      .eq("id", matchId)
      .maybeSingle(),
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

  if (matchResult.error) {
    return jsonError(matchResult.error.message, 400);
  }
  if (!matchResult.data) {
    return jsonError("Match not found", 404);
  }
  if (playersResult.error) {
    return jsonError(playersResult.error.message, 400);
  }
  if (turnsResult.error) {
    return jsonError(turnsResult.error.message, 400);
  }

  const playerRows = playersResult.data ?? [];
  const playerIds = playerRows.map((p) => p.user_id);
  const nicknameMap = new Map<string, string | null>();

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
  }

  return NextResponse.json({
    ...matchResult.data,
    players: playerRows.map((player) => ({
      ...player,
      nickname: nicknameMap.get(player.user_id) ?? null
    })),
    turns: turnsResult.data ?? []
  });
}
