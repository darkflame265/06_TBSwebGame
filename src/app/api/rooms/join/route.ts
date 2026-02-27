import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthedUser, jsonError, parseBody } from "@/lib/api";
import { ensurePlanningObstaclesReady } from "@/lib/match-obstacles";

const schema = z.object({
  roomCode: z.string().min(4).max(16)
});

export async function POST(request: Request) {
  const { error, client } = await getAuthedUser(request);
  if (error || !client) {
    return error ?? jsonError("Unauthorized", 401);
  }

  const parsed = await parseBody(request, schema);
  if (!parsed.success) {
    return parsed.response;
  }

  const { data, error: rpcError } = await client.rpc("join_friend_match", {
    p_room_code: parsed.data.roomCode
  });

  if (rpcError || !data || data.length === 0) {
    return jsonError(rpcError?.message ?? "Failed to join room", 400);
  }
  const matchId = data[0].match_id as string;
  const obstacleError = await ensurePlanningObstaclesReady(client, matchId);
  if (obstacleError) {
    return jsonError(obstacleError, 400);
  }

  return NextResponse.json(data[0], { status: 200 });
}
