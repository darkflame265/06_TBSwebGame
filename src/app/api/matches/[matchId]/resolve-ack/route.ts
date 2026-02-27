import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthedUser, jsonError, parseBody } from "@/lib/api";
import { ensurePlanningObstaclesReady } from "@/lib/match-obstacles";

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

  const obstacleError = await ensurePlanningObstaclesReady(
    client,
    parsedParams.data.matchId,
  );
  if (obstacleError) {
    return jsonError(obstacleError, 400);
  }

  return NextResponse.json({ ok: true });
}
