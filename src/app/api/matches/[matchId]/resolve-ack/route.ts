import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthedUser, jsonError, parseBody } from "@/lib/api";
import { createAdminSupabase } from "@/lib/supabase/server";

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

  const admin = createAdminSupabase();
  const { data: matchRow } = await admin
    .from("matches")
    .select("id,type,phase,current_turn,resolve_ack_p2")
    .eq("id", parsedParams.data.matchId)
    .maybeSingle();

  if (
    matchRow &&
    matchRow.type === "ai" &&
    matchRow.phase === "resolving" &&
    matchRow.current_turn === body.data.turn &&
    !matchRow.resolve_ack_p2
  ) {
    await admin
      .from("matches")
      .update({ resolve_ack_p2: true })
      .eq("id", parsedParams.data.matchId)
      .eq("phase", "resolving")
      .eq("current_turn", body.data.turn);

    await client.rpc("tick_match_round", {
      p_match_id: parsedParams.data.matchId
    });
  }

  return NextResponse.json({ ok: true });
}
