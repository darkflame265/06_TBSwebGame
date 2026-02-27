import { NextResponse } from "next/server";

export const preferredRegion = "icn1";
import { z } from "zod";
import { getAuthedClient, jsonError, parseBody } from "@/lib/api";

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

  const { data, error: rpcError } = await client.rpc("submit_turn", {
    p_match_id: parsedParams.data.matchId,
    p_round: body.data.round,
    p_action: body.data.action
  });

  if (rpcError) {
    const msg = rpcError.message.toLowerCase();
    const benignTransition =
      msg.includes("stale round") ||
      msg.includes("planning window closed") ||
      msg.includes("round is resolving") ||
      msg.includes("round resolving") ||
      msg.includes("resolving");
    if (benignTransition) {
      return NextResponse.json(
        { ok: true, skipped: true, reason: "round_transition" },
        { status: 201 },
      );
    }
    return jsonError(rpcError.message, 400);
  }

  if (!data) {
    return jsonError("Failed to submit turn", 400);
  }

  return NextResponse.json(data, { status: 201 });
}

