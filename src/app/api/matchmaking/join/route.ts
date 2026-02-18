import { NextResponse } from "next/server";
import { getAuthedUser, jsonError } from "@/lib/api";

export async function POST(request: Request) {
  const { error, client } = await getAuthedUser(request);
  if (error || !client) {
    return error ?? jsonError("Unauthorized", 401);
  }

  const { data, error: rpcError } = await client.rpc("join_matchmaking_queue");
  if (rpcError || !data) {
    return jsonError(rpcError?.message ?? "Failed to join matchmaking queue", 400);
  }

  return NextResponse.json(data, { status: 200 });
}
