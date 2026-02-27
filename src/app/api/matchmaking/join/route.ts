import { NextResponse } from "next/server";

export const preferredRegion = "icn1";
import { z } from "zod";
import { getAuthedUser, jsonError, parseBody } from "@/lib/api";
import {
  ensurePlanningObstaclesReady,
  type PlanningObstacleClient,
} from "@/lib/match-obstacles";

const schema = z.object({
  ticketId: z.string().uuid().optional()
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

  const ticketId = parsed.data.ticketId ?? null;

  const { data, error: rpcError } = await client.rpc("join_matchmaking_queue", {
    p_ticket_id: ticketId
  });
  if (rpcError || !data) {
    return jsonError(rpcError?.message ?? "Failed to join matchmaking queue", 400);
  }

  if (
    typeof data === "object" &&
    data !== null &&
    (data as { status?: unknown }).status === "matched" &&
    typeof (data as { match_id?: unknown }).match_id === "string"
  ) {
    const matchId = (data as { match_id: string }).match_id;
    const obstacleError = await ensurePlanningObstaclesReady(
      client as unknown as PlanningObstacleClient,
      matchId,
    );
    if (obstacleError) {
      return jsonError(obstacleError, 400);
    }
  }

  return NextResponse.json(data, { status: 200 });
}

