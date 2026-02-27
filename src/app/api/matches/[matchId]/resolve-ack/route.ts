import { NextResponse } from "next/server";

export const preferredRegion = "icn1";
import { z } from "zod";
import { getAuthedClient, jsonError, parseBody } from "@/lib/api";

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
  const { error, client } = await getAuthedClient(request);
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

  // Best effort: advance phase immediately after ack to reduce perceived idle gap.
  const { error: tickError } = await client.rpc("tick_match_round", {
    p_match_id: parsedParams.data.matchId,
  });
  if (tickError) {
    const msg = tickError.message.toLowerCase();
    const ignorable =
      msg.includes("stale round") ||
      msg.includes("not active") ||
      msg.includes("already") ||
      msg.includes("resolving") ||
      msg.includes("planning");
    if (!ignorable) {
      return NextResponse.json({ ok: true, ticked: false });
    }
  }

  return NextResponse.json({ ok: true, ticked: true });
}

