import { NextResponse } from "next/server";
import { getAuthedUser, jsonError } from "@/lib/api";

export async function POST(request: Request) {
  const { error, client, user } = await getAuthedUser(request);
  if (error || !client || !user) {
    return error ?? jsonError("Unauthorized", 401);
  }

  const { error: deleteError } = await client
    .from("matchmaking_queue")
    .delete()
    .eq("user_id", user.id);

  if (deleteError) {
    return jsonError(deleteError.message, 400);
  }

  return NextResponse.json({ status: "cancelled" }, { status: 200 });
}

