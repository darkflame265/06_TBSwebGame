"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getBrowserSupabaseClient } from "@/lib/supabase/browser";
import { apiPost } from "@/lib/client-api";

type RoomCreateResponse = {
  match_id: string;
  room_code: string;
};

type RoomJoinResponse = {
  match_id: string;
};

type MatchmakingResponse = {
  status: "queued" | "matched";
  match_id?: string;
  ticket_id?: string;
};

export function LobbyClient() {
  const router = useRouter();
  const supabase = getBrowserSupabaseClient();
  const [userId, setUserId] = useState<string | null>(null);
  const [roomCode, setRoomCode] = useState("");
  const [createdRoom, setCreatedRoom] = useState<RoomCreateResponse | null>(null);
  const [queueing, setQueueing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const queueTicketRef = useRef<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUserId(data.user?.id ?? null);
    });
  }, [supabase]);

  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  const signInGuest = async () => {
    setMessage(null);
    const { data, error } = await supabase.auth.signInAnonymously();
    if (error) {
      setMessage(error.message);
      return;
    }
    setUserId(data.user?.id ?? null);
  };

  const createRoom = async () => {
    setMessage(null);
    try {
      const data = await apiPost<RoomCreateResponse>("/api/rooms/create");
      setCreatedRoom(data);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to create room");
    }
  };

  const joinRoom = async () => {
    setMessage(null);
    try {
      const data = await apiPost<RoomJoinResponse>("/api/rooms/join", { roomCode });
      router.push(`/match/${data.match_id}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to join room");
    }
  };

  const tryMatchmake = async (ticketId?: string | null) => {
    try {
      const data = await apiPost<MatchmakingResponse>("/api/matchmaking/join", {
        ticketId: ticketId ?? undefined
      });

      if (data.ticket_id) {
        queueTicketRef.current = data.ticket_id;
      }

      if (data.status === "matched" && data.match_id) {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
        }
        setQueueing(false);
        queueTicketRef.current = null;
        router.push(`/match/${data.match_id}`);
        return true;
      }

      return false;
    } catch (error) {
      setQueueing(false);
      queueTicketRef.current = null;
      setMessage(error instanceof Error ? error.message : "Failed to join matchmaking queue");
      return false;
    }
  };

  const joinMatchmaking = async () => {
    setMessage(null);
    setQueueing(true);
    queueTicketRef.current = null;

    const matched = await tryMatchmake(null);
    if (matched) {
      return;
    }

    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }

    intervalRef.current = setInterval(async () => {
      const done = await tryMatchmake(queueTicketRef.current);
      if (done && intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    }, 2500);
  };

  return (
    <main className="mx-auto min-h-screen max-w-3xl p-6">
      <h1 className="text-3xl font-bold">1v1 TBS Lobby</h1>
      <p className="mt-2 text-sm text-slate-600">Sign in, then start friend match or random matchmaking.</p>

      <section className="mt-6 rounded-xl bg-white p-4 shadow-sm">
        <h2 className="font-semibold">1) Guest Login</h2>
        {userId ? (
          <p className="mt-2 text-sm text-emerald-700">Signed in: {userId}</p>
        ) : (
          <button
            onClick={signInGuest}
            className="mt-3 rounded-lg bg-slate-900 px-4 py-2 text-white hover:bg-slate-700"
          >
            Sign in anonymously
          </button>
        )}
      </section>

      <section className="mt-4 rounded-xl bg-white p-4 shadow-sm">
        <h2 className="font-semibold">2) Friend Match</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            onClick={createRoom}
            disabled={!userId}
            className="rounded-lg bg-blue-700 px-4 py-2 text-white disabled:cursor-not-allowed disabled:bg-slate-400"
          >
            Create room
          </button>
          <input
            value={roomCode}
            onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
            placeholder="Invite code"
            className="rounded-lg border border-slate-300 px-3 py-2"
          />
          <button
            onClick={joinRoom}
            disabled={!userId || !roomCode}
            className="rounded-lg bg-emerald-700 px-4 py-2 text-white disabled:cursor-not-allowed disabled:bg-slate-400"
          >
            Join by code
          </button>
        </div>
        {createdRoom && (
          <p className="mt-3 text-sm">
            Room code: <span className="font-mono font-semibold">{createdRoom.room_code}</span> |{" "}
            <a className="text-blue-700 underline" href={`/match/${createdRoom.match_id}`}>
              Open match
            </a>
          </p>
        )}
      </section>

      <section className="mt-4 rounded-xl bg-white p-4 shadow-sm">
        <h2 className="font-semibold">3) Random Matchmaking</h2>
        <button
          onClick={joinMatchmaking}
          disabled={!userId || queueing}
          className="mt-3 rounded-lg bg-rose-700 px-4 py-2 text-white disabled:cursor-not-allowed disabled:bg-slate-400"
        >
          {queueing ? "Queueing..." : "Join queue"}
        </button>
      </section>

      {message && <p className="mt-4 rounded-lg bg-red-100 p-3 text-sm text-red-700">{message}</p>}
    </main>
  );
}
