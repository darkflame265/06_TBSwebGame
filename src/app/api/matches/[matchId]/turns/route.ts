import { NextResponse } from "next/server";

export const preferredRegion = "icn1";
import { z } from "zod";
import { getAuthedClient, jsonError, parseBody } from "@/lib/api";
import { generatePathForRole } from "@/lib/ai-planner";
import type { Coord } from "@/lib/obstacles";

const paramsSchema = z.object({
  matchId: z.string().uuid()
});

const bodySchema = z.object({
  round: z.number().int().positive(),
  action: z.record(z.any())
});

type Context = {
  params: Promise<{ matchId: string }>;
};

type AiMatchSnapshot = {
  type: "friend" | "random" | "ai";
  status: "waiting" | "active" | "finished";
  phase: "planning" | "resolving";
  current_turn: number;
  board_state: { p1: Coord; p2: Coord } | null;
  obstacles: Coord[] | null;
  attacker_slot: 1 | 2;
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

  const bodyStart = performance.now();
  const body = await parseBody(request, bodySchema);
  addTiming("body_parse", bodyStart);
  if (!body.success) {
    return withTiming(body.response);
  }

  const submitStart = performance.now();
  const { data, error: rpcError } = await client.rpc("submit_turn", {
    p_match_id: parsedParams.data.matchId,
    p_round: body.data.round,
    p_action: body.data.action
  });
  addTiming("submit_turn_rpc", submitStart);

  if (rpcError) {
    const msg = rpcError.message.toLowerCase();
    const benignTransition =
      msg.includes("stale round") ||
      msg.includes("planning window closed") ||
      msg.includes("round is resolving") ||
      msg.includes("round resolving") ||
      msg.includes("resolving");
    if (benignTransition) {
      return withTiming(NextResponse.json(
        { ok: true, skipped: true, reason: "round_transition" },
        { status: 201 },
      ));
    }
    return withTiming(jsonError(rpcError.message, 400));
  }

  if (!data) {
    return withTiming(jsonError("Failed to submit turn", 400));
  }

  // Move AI turn submission off the hot /matches route.
  const aiMatchStart = performance.now();
  const { data: matchData, error: matchError } = await client
    .from("matches")
    .select("type,status,phase,current_turn,board_state,obstacles,attacker_slot")
    .eq("id", parsedParams.data.matchId)
    .maybeSingle();
  addTiming("ai_match_select", aiMatchStart);

  if (matchError) {
    return withTiming(jsonError(matchError.message, 400));
  }

  const aiMatch = matchData as AiMatchSnapshot | null;
  if (
    aiMatch &&
    aiMatch.type === "ai" &&
    aiMatch.status === "active" &&
    aiMatch.phase === "planning" &&
    aiMatch.current_turn === body.data.round &&
    aiMatch.board_state
  ) {
    const aiTurnsStart = performance.now();
    const { data: currentTurns, error: turnsError } = await client
      .from("turns")
      .select("player_slot")
      .eq("match_id", parsedParams.data.matchId)
      .eq("turn_number", aiMatch.current_turn);
    addTiming("ai_turns_select", aiTurnsStart);

    if (turnsError) {
      return withTiming(jsonError(turnsError.message, 400));
    }

    const botAlreadySubmitted = (currentTurns ?? []).some((t) => t.player_slot === 2);
    if (!botAlreadySubmitted) {
      const p1 = aiMatch.board_state.p1;
      const p2 = aiMatch.board_state.p2;
      const maxPoints = Math.min(aiMatch.current_turn + 4, 10);
      const role = aiMatch.attacker_slot === 2 ? "ATTACK" : "EVADE";
      const path = generatePathForRole({
        gridSize: 5,
        role,
        maxPoints,
        selfPos: p2,
        opponentPos: p1,
        obstacles: aiMatch.obstacles ?? [],
      });

      const aiSubmitStart = performance.now();
      const { error: botSubmitError } = await client.rpc("submit_bot_turn", {
        p_match_id: parsedParams.data.matchId,
        p_round: aiMatch.current_turn,
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

  return withTiming(NextResponse.json(data, { status: 201 }));
}


