import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthedUser, jsonError, parseBody } from "@/lib/api";

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

  return NextResponse.json(data, { status: 200 });
}
