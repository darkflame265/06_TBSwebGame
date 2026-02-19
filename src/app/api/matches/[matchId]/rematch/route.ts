import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthedUser, jsonError } from "@/lib/api";

const paramsSchema = z.object({
  matchId: z.string().uuid()
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

  const { data, error: rpcError } = await client.rpc("request_rematch", {
    p_match_id: parsedParams.data.matchId
  });

  if (rpcError || !data) {
    return jsonError(rpcError?.message ?? "Failed to request rematch", 400);
  }

  return NextResponse.json(data, { status: 200 });
}
