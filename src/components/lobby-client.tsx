"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getBrowserSupabaseClient } from "@/lib/supabase/browser";
import { apiGet, apiPost } from "@/lib/client-api";

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

type ProfileResponse = {
  nickname: string | null;
};

export function LobbyClient() {
  const router = useRouter();
  const supabase = getBrowserSupabaseClient();
  const [darkMode, setDarkMode] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [roomCode, setRoomCode] = useState("");
  const [createdRoom, setCreatedRoom] = useState<RoomCreateResponse | null>(null);
  const [queueing, setQueueing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [nicknameInput, setNicknameInput] = useState("");
  const [savedNickname, setSavedNickname] = useState<string | null>(null);
  const [savingNickname, setSavingNickname] = useState(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const queueTicketRef = useRef<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUserId(data.user?.id ?? null);
    });
  }, [supabase]);

  useEffect(() => {
    const savedDark = localStorage.getItem("tbs-dark");
    if (savedDark) setDarkMode(savedDark === "1");
  }, []);

  useEffect(() => {
    localStorage.setItem("tbs-dark", darkMode ? "1" : "0");
    if (typeof document !== "undefined") {
      document.documentElement.classList.toggle("dark", darkMode);
    }
  }, [darkMode]);

  useEffect(() => {
    const loadProfile = async () => {
      if (!userId) {
        setSavedNickname(null);
        setNicknameInput("");
        return;
      }
      try {
        const data = await apiGet<ProfileResponse>("/api/profile");
        setSavedNickname(data.nickname);
        setNicknameInput(data.nickname ?? "");
      } catch {
        // ignore initial profile load errors in lobby
      }
    };
    loadProfile();
  }, [userId]);

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

  const saveNickname = async () => {
    setMessage(null);
    if (!userId) return;
    setSavingNickname(true);
    try {
      const data = await apiPost<ProfileResponse>("/api/profile", {
        nickname: nicknameInput
      });
      setSavedNickname(data.nickname);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to save nickname");
    } finally {
      setSavingNickname(false);
    }
  };

  return (
    <main
      className={`min-h-screen transition-colors duration-300 ${darkMode ? "bg-[#1a1c18] text-white" : "bg-[#F2E8CF] text-slate-900"}`}
    >
      <div className="mx-auto max-w-3xl px-6 py-16 md:py-24">
        <div className="fixed right-6 top-6 z-50">
          <button
            type="button"
            onClick={() => setDarkMode((v) => !v)}
            className={`rounded-full border p-3 shadow-lg transition ${
              darkMode
                ? "border-slate-700 bg-[#242822] text-slate-200"
                : "border-slate-200 bg-white text-slate-600"
            }`}
          >
            {darkMode ? "Light" : "Dark"}
          </button>
        </div>

        <header className="mb-12 text-center">
          <h1 className="text-4xl font-extrabold tracking-tight md:text-5xl">1v1 TBS Lobby</h1>
          <p className={`mt-4 text-lg ${darkMode ? "text-slate-400" : "text-slate-600"}`}>
            Sign in, then start a friend match or join random matchmaking.
          </p>
        </header>

        <div className="space-y-6">
          <section
            className={`rounded-3xl border p-8 shadow-sm transition ${
              darkMode ? "border-slate-800 bg-[#242822]" : "border-slate-100 bg-white"
            }`}
          >
            <div className="mb-6 flex items-center gap-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#386641]/10 text-sm font-bold text-[#386641]">
                1
              </span>
              <h2 className="text-xl font-bold">Guest Profile</h2>
            </div>

            {userId ? (
              <>
                <p className="mb-4 text-xs font-medium text-[#386641]">Signed in: {userId}</p>
                <div className="flex flex-col gap-3 md:flex-row">
                  <div className="flex-grow">
                    <input
                      value={nicknameInput}
                      onChange={(e) => setNicknameInput(e.target.value)}
                      placeholder="Enter nickname..."
                      maxLength={24}
                      className={`w-full rounded-xl border px-4 py-3 transition ${
                        darkMode
                          ? "border-slate-700 bg-slate-800/50 text-white"
                          : "border-slate-200 bg-slate-50 text-slate-900"
                      }`}
                    />
                    <p className={`ml-1 mt-2 text-xs ${darkMode ? "text-slate-400" : "text-slate-500"}`}>
                      Current nickname:{" "}
                      <span className={darkMode ? "font-semibold text-slate-200" : "font-semibold text-slate-700"}>
                        {savedNickname ?? "-"}
                      </span>
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={saveNickname}
                    disabled={savingNickname || nicknameInput.trim().length < 2}
                    className="rounded-xl bg-[#386641] px-8 py-3 font-semibold text-white transition hover:bg-[#2a4d31] disabled:cursor-not-allowed disabled:bg-slate-400"
                  >
                    {savingNickname ? "Saving..." : "Confirm"}
                  </button>
                </div>
              </>
            ) : (
              <button
                type="button"
                onClick={signInGuest}
                className="rounded-xl bg-[#386641] px-6 py-3 font-semibold text-white transition hover:bg-[#2a4d31]"
              >
                Sign in anonymously
              </button>
            )}
          </section>

          <section
            className={`rounded-3xl border p-8 shadow-sm transition ${
              darkMode ? "border-slate-800 bg-[#242822]" : "border-slate-100 bg-white"
            }`}
          >
            <div className="mb-6 flex items-center gap-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#386641]/10 text-sm font-bold text-[#386641]">
                2
              </span>
              <h2 className="text-xl font-bold">Friend Match</h2>
            </div>
            <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
              <div className="space-y-3">
                <p className={`ml-1 text-sm font-medium ${darkMode ? "text-slate-400" : "text-slate-500"}`}>
                  Start a new match
                </p>
                <button
                  onClick={createRoom}
                  disabled={!userId}
                  className="w-full rounded-xl bg-blue-600 px-6 py-4 font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-400"
                >
                  Create Room
                </button>
              </div>
              <div className="space-y-3">
                <p className={`ml-1 text-sm font-medium ${darkMode ? "text-slate-400" : "text-slate-500"}`}>
                  Enter invite code
                </p>
                <div className="flex gap-2">
                  <input
                    value={roomCode}
                    onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                    placeholder="INVITE-CODE"
                    className={`flex-grow rounded-xl border px-4 py-3 uppercase tracking-widest placeholder:normal-case placeholder:tracking-normal ${
                      darkMode
                        ? "border-slate-700 bg-slate-800/50 text-white"
                        : "border-slate-200 bg-slate-50 text-slate-900"
                    }`}
                  />
                  <button
                    onClick={joinRoom}
                    disabled={!userId || !roomCode}
                    className="rounded-xl bg-slate-500 px-6 py-3 font-semibold text-white transition hover:bg-slate-600 disabled:cursor-not-allowed disabled:bg-slate-400"
                  >
                    Join
                  </button>
                </div>
              </div>
            </div>
            {createdRoom && (
              <p className={`mt-4 text-sm ${darkMode ? "text-slate-300" : "text-slate-700"}`}>
                Room code: <span className="font-mono font-bold">{createdRoom.room_code}</span> |{" "}
                <a className="underline" href={`/match/${createdRoom.match_id}`}>
                  Open match
                </a>
              </p>
            )}
          </section>

          <section
            className={`rounded-3xl border p-8 shadow-sm transition ${
              darkMode ? "border-slate-800 bg-[#242822]" : "border-slate-100 bg-white"
            }`}
          >
            <div className="mb-6 flex items-center gap-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#386641]/10 text-sm font-bold text-[#386641]">
                3
              </span>
              <h2 className="text-xl font-bold">Random Matchmaking</h2>
            </div>
            <button
              onClick={joinMatchmaking}
              disabled={!userId || queueing}
              className="w-full rounded-xl bg-[#386641] px-8 py-5 text-lg font-bold text-white transition hover:bg-[#2a4d31] disabled:cursor-not-allowed disabled:bg-slate-400"
            >
              {queueing ? "Queueing..." : "Join Matchmaking Queue"}
            </button>
          </section>
        </div>

        {message && <p className="mt-4 rounded-lg bg-red-100 p-3 text-sm text-red-700">{message}</p>}
      </div>
    </main>
  );
}
