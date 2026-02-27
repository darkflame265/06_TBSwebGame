import { NextResponse } from "next/server";

export const preferredRegion = "icn1";
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
  const { error, client } = await getAuthedUser(request);
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

  const tickStart = performance.now();
  const { error: tickError } = await client.rpc("tick_match_round", {
    p_match_id: matchId,
  });
  addTiming("tick_round_rpc", tickStart);
  if (tickError) {
    return withTiming(jsonError(tickError.message, 400));
  }

  const matchSelectStart = performance.now();
  const { data: matchData, error: matchError } = await client
    .from("matches")
    .select(
      "id,type,status,phase,current_turn,board_state,obstacles,obstacles_turn,attacker_slot"
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

  // Obstacle generation
  if (
    matchData.phase === "planning" &&
    matchData.board_state &&
    matchData.obstacles_turn !== matchData.current_turn
  ) {
    const obstacleComputeStart = performance.now();
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
    addTiming("obstacle_compute", obstacleComputeStart);
    const obstacleUpdateStart = performance.now();
    const { error: updateObstacleError } = await admin
      .from("matches")
      .update({
        obstacles: obstacleArray,
        obstacles_turn: matchData.current_turn,
      })
      .eq("id", matchId)
      .eq("current_turn", matchData.current_turn)
      .eq("phase", "planning");
    addTiming("obstacle_update", obstacleUpdateStart);

    if (updateObstacleError) {
      return withTiming(jsonError(updateObstacleError.message, 400));
    }

    matchData.obstacles = obstacleArray;
    matchData.obstacles_turn = matchData.current_turn;
  }

  // AI bot turn submission
  if (matchData.type === "ai" && matchData.status === "active" && matchData.phase === "planning") {
    const aiTurnsStart = performance.now();
    const { data: currentTurns, error: turnsError } = await client
      .from("turns")
      .select("player_slot")
      .eq("match_id", matchId)
      .eq("turn_number", matchData.current_turn);
    addTiming("ai_turns_select", aiTurnsStart);

    if (turnsError) {
      return withTiming(jsonError(turnsError.message, 400));
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

      const aiSubmitStart = performance.now();
      const { error: botSubmitError } = await client.rpc("submit_bot_turn", {
        p_match_id: matchId,
        p_round: matchData.current_turn,
        p_action: { path },
      });
      addTiming("ai_submit_rpc", aiSubmitStart);

      if (botSubmitError) {
        const msg = botSubmitError.message.toLowerCase();
        const ignorable =
          msg.includes("stale round") ||
          msg.includes("planning window closed") ||
          msg.includes("round is resolving");
        if (!ignorable) {
          return withTiming(jsonError(botSubmitError.message, 400));
        }
      }
    }
  }

  return withTiming(NextResponse.json({ ok: true }));
}


