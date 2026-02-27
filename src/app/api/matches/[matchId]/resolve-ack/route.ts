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

  const ackStart = performance.now();
  const { error: rpcError } = await client.rpc("ack_resolve", {
    p_match_id: parsedParams.data.matchId,
    p_turn: body.data.turn
  });
  addTiming("ack_resolve_rpc", ackStart);

  if (rpcError) {
    const msg = rpcError.message.toLowerCase();
    if (msg.includes("stale round") || msg.includes("not resolving")) {
      return withTiming(NextResponse.json({ ok: true }));
    }
    return withTiming(jsonError(rpcError.message, 400));
  }

  // Best effort: advance phase immediately after ack to reduce perceived idle gap.
  const tickStart = performance.now();
  const { error: tickError } = await client.rpc("tick_match_round", {
    p_match_id: parsedParams.data.matchId,
  });
  addTiming("tick_round_rpc", tickStart);
  if (tickError) {
    const msg = tickError.message.toLowerCase();
    const ignorable =
      msg.includes("stale round") ||
      msg.includes("not active") ||
      msg.includes("already") ||
      msg.includes("resolving") ||
      msg.includes("planning");
    if (!ignorable) {
      return withTiming(NextResponse.json({ ok: true, ticked: false }));
    }
  }

  return withTiming(NextResponse.json({ ok: true, ticked: true }));
}

