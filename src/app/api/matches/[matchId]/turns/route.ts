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
  const timings: string[] = [];
  const addTiming = (name: string, start: number) => {
    timings.push(`${name};dur=${(performance.now() - start).toFixed(1)}`);
  };
  const withTiming = (response: NextResponse) => {
    if (timings.length > 0) {
      response.headers.set("Server-Timing", timings.join(", "));
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

  return withTiming(NextResponse.json(data, { status: 201 }));
}

