import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthedUser, jsonError, parseBody } from "@/lib/api";
import { createAdminSupabase } from "@/lib/supabase/server";
import { generateObstacles, seedForMatchRound, type Coord } from "@/lib/obstacles";

const paramsSchema = z.object({
  matchId: z.string().uuid()
});

const bodySchema = z.object({
  turn: z.number().int().positive()
});

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

  const body = await parseBody(request, bodySchema);
  if (!body.success) {
    return body.response;
  }

  const { error: rpcError } = await client.rpc("ack_resolve", {
    p_match_id: parsedParams.data.matchId,
    p_turn: body.data.turn
  });

  if (rpcError) {
    const msg = rpcError.message.toLowerCase();
    if (msg.includes("stale round") || msg.includes("not resolving")) {
      return NextResponse.json({ ok: true });
    }
    return jsonError(rpcError.message, 400);
  }

  const matchId = parsedParams.data.matchId;
  const { data: matchData, error: matchError } = await client
    .from("matches")
    .select("id,phase,current_turn,board_state,obstacles_turn,attacker_slot")
    .eq("id", matchId)
    .maybeSingle();

  if (matchError) {
    return jsonError(matchError.message, 400);
  }

  if (
    matchData &&
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
  }

  return NextResponse.json({ ok: true });
}
