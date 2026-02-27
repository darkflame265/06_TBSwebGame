import { NextResponse } from "next/server";
import { getAuthedUser, jsonError } from "@/lib/api";
import { ensurePlanningObstaclesReady } from "@/lib/match-obstacles";

export async function POST(request: Request) {
  const { error, client } = await getAuthedUser(request);
  if (error || !client) {
    return error ?? jsonError("Unauthorized", 401);
  }

  const { data, error: rpcError } = await client.rpc("create_ai_match");
  if (rpcError || !Array.isArray(data) || !data[0]?.match_id) {
    return jsonError(rpcError?.message ?? "Failed to create AI match", 400);
  }
  const matchId = data[0].match_id as string;
  const obstacleError = await ensurePlanningObstaclesReady(client, matchId);
  if (obstacleError) {
    return jsonError(obstacleError, 400);
  }

  return NextResponse.json({ match_id: matchId }, { status: 201 });
}

