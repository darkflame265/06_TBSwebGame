import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthedUser, jsonError, parseBody } from "@/lib/api";

const paramsSchema = z.object({
  matchId: z.string().uuid()
});

const bodySchema = z.object({
  action: z.record(z.any())
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

  const { data, error: rpcError } = await client.rpc("submit_turn", {
    p_match_id: parsedParams.data.matchId,
    p_action: body.data.action
  });

  if (rpcError || !data) {
    return jsonError(rpcError?.message ?? "Failed to submit turn", 400);
  }

  return NextResponse.json(data, { status: 201 });
}
