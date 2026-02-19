"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getBrowserSupabaseClient } from "@/lib/supabase/browser";
import { apiGet, apiPost } from "@/lib/client-api";
import type { MatchResponse } from "@/types/api";

type Props = {
  matchId: string;
};

type Coord = [number, number];
type DisplayBoard = { p1: Coord; p2: Coord };

const BOARD_SIZE = 7;
const STEP_ANIMATION_MS = 320;
const PREVIEW_PATH_MS = 250;
const CELL_SIZE = 56;
const CELL_GAP = 4;
const BOARD_PX = BOARD_SIZE * CELL_SIZE + (BOARD_SIZE - 1) * CELL_GAP;
const DEFAULT_BOARD: DisplayBoard = { p1: [0, 3], p2: [6, 3] };

const sameCoord = (a: Coord, b: Coord) => a[0] === b[0] && a[1] === b[1];
const isOrthogonalStep = (from: Coord, to: Coord) =>
  Math.abs(from[0] - to[0]) + Math.abs(from[1] - to[1]) === 1;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const coordToPx = ([row, col]: Coord) => ({
  left: col * (CELL_SIZE + CELL_GAP) + CELL_SIZE / 2,
  top: row * (CELL_SIZE + CELL_GAP) + CELL_SIZE / 2
});
const heartsForHp = (hp: number) => [0, 1, 2].map((i) => i < hp);

export function MatchClient({ matchId }: Props) {
  const router = useRouter();
  const supabase = getBrowserSupabaseClient();

  const [match, setMatch] = useState<MatchResponse | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [plannedPath, setPlannedPath] = useState<Coord[]>([]);
  const [displayBoard, setDisplayBoard] = useState<DisplayBoard>(DEFAULT_BOARD);
  const [message, setMessage] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [animating, setAnimating] = useState(false);
  const [draggingPath, setDraggingPath] = useState(false);
  const [nowMs, setNowMs] = useState(Date.now());
  const [frozenTimerMs, setFrozenTimerMs] = useState<number | null>(null);
  const [resolvedOverlay, setResolvedOverlay] = useState<{
    start: DisplayBoard;
    p1: Coord[];
    p2: Coord[];
  } | null>(null);

  const prevMatchRef = useRef<MatchResponse | null>(null);
  const animatingRef = useRef(false);
  const animatedTurnRef = useRef<number | null>(null);
  const autoSubmittedRoundRef = useRef<number | null>(null);
  const latestMillisLeftRef = useRef(0);

  const mySlot = useMemo(() => {
    if (!match || !me) return null;
    return match.players.find((p) => p.user_id === me)?.slot ?? null;
  }, [match, me]);

  const mySubmitted = useMemo(() => {
    if (!match || mySlot === null) return false;
    return match.turns.some((t) => t.turn_number === match.current_turn && t.player_slot === mySlot);
  }, [match, mySlot]);
  const p1Submitted = useMemo(() => {
    if (!match) return false;
    return match.turns.some((t) => t.turn_number === match.current_turn && t.player_slot === 1);
  }, [match]);
  const p2Submitted = useMemo(() => {
    if (!match) return false;
    return match.turns.some((t) => t.turn_number === match.current_turn && t.player_slot === 2);
  }, [match]);

  const canPlan = !!match && match.status === "active" && match.phase === "planning" && mySlot !== null && !mySubmitted && !animating;
  const attackerSlot = match?.attacker_slot ?? 1;
  const myRole = mySlot ? (attackerSlot === mySlot ? "ATTACK" : "EVADE") : "-";

  const animateResolvedRound = async (start: DisplayBoard, p1Path: Coord[], p2Path: Coord[]) => {
    const steps = Math.max(p1Path.length, p2Path.length);
    setResolvedOverlay({ start, p1: p1Path, p2: p2Path });
    setDisplayBoard(start);
    setFrozenTimerMs(Math.max(0, latestMillisLeftRef.current));
    animatingRef.current = true;
    setAnimating(true);

    let p1 = start.p1;
    let p2 = start.p2;
    if (steps <= 0) {
      await sleep(200);
      setDisplayBoard({ p1, p2 });
      setAnimating(false);
      animatingRef.current = false;
      setFrozenTimerMs(null);
      return;
    }

    await sleep(PREVIEW_PATH_MS);

    for (let i = 0; i < steps; i += 1) {
      if (i < p1Path.length) p1 = p1Path[i];
      if (i < p2Path.length) p2 = p2Path[i];
      setDisplayBoard({ p1, p2 });
      await sleep(STEP_ANIMATION_MS);
    }

    setAnimating(false);
    animatingRef.current = false;
    setFrozenTimerMs(null);
  };

  const loadMatch = async () => {
    try {
      const data = await apiGet<MatchResponse>(`/api/matches/${matchId}`);
      const nextBoard = data.board_state ?? DEFAULT_BOARD;
      const prev = prevMatchRef.current;

      if (!prev) {
        setDisplayBoard(nextBoard);
      } else if (
        data.phase === "resolving" &&
        data.resolved_paths &&
        animatedTurnRef.current !== data.resolved_paths.turn &&
        !animatingRef.current
      ) {
        const start = data.resolved_paths.start;
        await animateResolvedRound({ p1: start.p1, p2: start.p2 }, data.resolved_paths.p1, data.resolved_paths.p2);
        animatedTurnRef.current = data.resolved_paths.turn;
      } else if (!animatingRef.current) {
        setDisplayBoard(nextBoard);
      }

      if (prev && prev.phase === "resolving" && data.phase === "planning") {
        setResolvedOverlay(null);
        setPlannedPath([]);
        setDraggingPath(false);
        autoSubmittedRoundRef.current = null;
      }
      if (prev && data.current_turn !== prev.current_turn) {
        setResolvedOverlay(null);
        setPlannedPath([]);
        setDraggingPath(false);
        autoSubmittedRoundRef.current = null;
      }

      prevMatchRef.current = data;
      setMatch(data);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to load match");
    }
  };

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setMe(data.user?.id ?? null));
    loadMatch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchId]);

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 33);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const poll = setInterval(() => loadMatch(), 1000);
    return () => clearInterval(poll);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchId]);

  useEffect(() => {
    const stopDragging = () => setDraggingPath(false);
    window.addEventListener("pointerup", stopDragging);
    return () => window.removeEventListener("pointerup", stopDragging);
  }, []);

  useEffect(() => {
    const channel = supabase
      .channel(`match-stream-${matchId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "turns", filter: `match_id=eq.${matchId}` },
        () => loadMatch()
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "matches", filter: `id=eq.${matchId}` },
        () => loadMatch()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchId]);

  const submitPath = async (pathToSubmit: Coord[]) => {
    if (!match || !canPlan) return;
    try {
      await apiPost(`/api/matches/${matchId}/turns`, { action: { path: pathToSubmit } });
      await loadMatch();
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Failed to submit path";
      setMessage(msg);
      if (msg.toLowerCase().includes("planning window closed") || msg.toLowerCase().includes("resolving")) {
        await loadMatch();
      }
    }
  };

  const deadlineMs =
    match?.phase === "planning"
      ? match.planning_ends_at
        ? new Date(match.planning_ends_at).getTime()
        : nowMs
      : match?.resolution_ends_at
        ? new Date(match.resolution_ends_at).getTime()
        : nowMs;
  const millisLeft = Math.max(0, deadlineMs - nowMs);
  const shownMillisLeft = frozenTimerMs ?? millisLeft;

  useEffect(() => {
    latestMillisLeftRef.current = millisLeft;
  }, [millisLeft]);

  useEffect(() => {
    if (!match || !canPlan || mySubmitted) return;
    if (millisLeft > 2000) return;
    if (autoSubmittedRoundRef.current === match.current_turn) return;
    autoSubmittedRoundRef.current = match.current_turn;
    void submitPath(plannedPath);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [millisLeft, canPlan, mySubmitted, match?.current_turn, plannedPath]);

  const leaveMatch = async () => {
    setMessage(null);
    if (match?.status === "finished") {
      router.push("/");
      return;
    }
    setLeaving(true);
    try {
      await apiPost(`/api/matches/${matchId}/leave`);
      router.push("/");
    } catch (error) {
      setLeaving(false);
      setMessage(error instanceof Error ? error.message : "Failed to leave match");
    }
  };

  if (!match) {
    return (
      <main className="mx-auto min-h-screen max-w-5xl p-6">
        <p>Loading match data...</p>
        {message && <p className="mt-3 text-red-700">{message}</p>}
      </main>
    );
  }

  const myPos: Coord | null = mySlot === 1 ? displayBoard.p1 : mySlot === 2 ? displayBoard.p2 : null;
  const currentEnd: Coord | null = myPos ? (plannedPath.length > 0 ? plannedPath[plannedPath.length - 1] : myPos) : null;
  const maxPoints = Math.min(match.current_turn, 10);
  const myColor = mySlot === 1 ? "Red" : mySlot === 2 ? "Blue" : "-";
  const p1IsAttacker = attackerSlot === 1;
  const p2IsAttacker = attackerSlot === 2;
  const secondsLeft = (shownMillisLeft / 1000).toFixed(1);

  const beginPathDrag = (row: number, col: number) => {
    if (!canPlan || !currentEnd) return;
    if (currentEnd[0] !== row || currentEnd[1] !== col) return;
    setDraggingPath(true);
  };

  const extendOrRewindPath = (row: number, col: number) => {
    if (!draggingPath || !canPlan || !myPos) return;
    setPlannedPath((prev) => {
      const end = prev.length > 0 ? prev[prev.length - 1] : myPos;
      const target: Coord = [row, col];
      if (sameCoord(end, target)) return prev;

      const back = prev.length > 0 ? (prev.length > 1 ? prev[prev.length - 2] : myPos) : null;
      if (back && sameCoord(back, target)) return prev.slice(0, -1);
      if (!isOrthogonalStep(end, target)) return prev;
      if (prev.length >= maxPoints) return prev;
      return [...prev, target];
    });
  };

  const pathToLine = (points: Coord[]) =>
    points
      .map((coord) => {
        const p = coordToPx(coord);
        return `${p.left},${p.top}`;
      })
      .join(" ");

  const planningLine = myPos ? pathToLine([myPos, ...plannedPath]) : "";
  const resolvingP1Line = resolvedOverlay ? pathToLine([resolvedOverlay.start.p1, ...resolvedOverlay.p1]) : "";
  const resolvingP2Line = resolvedOverlay ? pathToLine([resolvedOverlay.start.p2, ...resolvedOverlay.p2]) : "";

  const p1Px = coordToPx(displayBoard.p1);
  const p2Px = coordToPx(displayBoard.p2);

  return (
    <main className="mx-auto min-h-screen max-w-5xl p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-3xl font-bold">Match {match.id}</h1>
        <button
          onClick={leaveMatch}
          disabled={leaving}
          className="rounded-lg bg-red-700 px-4 py-2 text-white disabled:cursor-not-allowed disabled:bg-slate-400"
        >
          {leaving ? "Leaving..." : match.status === "finished" ? "Back to lobby" : "Leave match"}
        </button>
      </div>

      <div className="mt-3 rounded-xl bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-slate-700">
            Status: {match.status} | Phase: {match.phase} | Round: {match.current_turn} | Piece: {myColor} | Role: {myRole} | Max path points: {maxPoints}
          </p>
          <p className="font-mono text-sm font-semibold text-slate-900">
            {animating ? "moving..." : `${match.phase} timer: ${secondsLeft}s`}
          </p>
        </div>
        <div className="mt-2 h-2 w-full overflow-hidden rounded bg-slate-200">
          <div className="h-full bg-emerald-500" style={{ width: `${Math.max(0, Math.min(100, (shownMillisLeft / 10000) * 100))}%` }} />
        </div>
      </div>

      <section className="mt-4 rounded-xl bg-white p-4 shadow-sm">
        <h2 className="font-semibold">Board 7x7</h2>
        <div className="mt-2 grid max-w-md grid-cols-2 gap-2 text-sm">
          <div className="flex items-center justify-between rounded border border-slate-200 bg-slate-50 px-3 py-2">
            <span className="font-medium text-slate-700">Red (Slot 1){p1IsAttacker ? " - ATTACK" : " - EVADE"}</span>
            <span className={p1Submitted ? "font-semibold text-emerald-600" : "font-semibold text-slate-400"}>
              {p1Submitted ? "Ready" : "Waiting"}
            </span>
          </div>
          <div className="flex items-center justify-between rounded border border-slate-200 bg-slate-50 px-3 py-2">
            <span className="font-medium text-slate-700">Blue (Slot 2){p2IsAttacker ? " - ATTACK" : " - EVADE"}</span>
            <span className={p2Submitted ? "font-semibold text-emerald-600" : "font-semibold text-slate-400"}>
              {p2Submitted ? "Ready" : "Waiting"}
            </span>
          </div>
          <div className="col-span-2 rounded border border-slate-200 bg-slate-50 px-3 py-2">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-1">
                <span className="text-xs font-medium text-slate-600">Red HP:</span>
                {heartsForHp(match.p1_hp).map((filled, idx) => (
                  <span key={`p1-heart-${idx}`} className={`text-lg text-rose-500 ${filled ? "opacity-100" : "opacity-25"}`}>
                    ♥
                  </span>
                ))}
              </div>
              <div className="flex items-center gap-1">
                <span className="text-xs font-medium text-slate-600">Blue HP:</span>
                {heartsForHp(match.p2_hp).map((filled, idx) => (
                  <span key={`p2-heart-${idx}`} className={`text-lg text-rose-500 ${filled ? "opacity-100" : "opacity-25"}`}>
                    ♥
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
        <div className="relative mt-3" style={{ width: BOARD_PX, height: BOARD_PX }}>
          <div className="grid grid-cols-7 gap-1" style={{ width: BOARD_PX, height: BOARD_PX }}>
            {Array.from({ length: BOARD_SIZE }).map((_, row) =>
              Array.from({ length: BOARD_SIZE }).map((__, col) => (
                <button
                  key={`${row}-${col}`}
                  type="button"
                  onPointerDown={() => beginPathDrag(row, col)}
                  onPointerEnter={() => extendOrRewindPath(row, col)}
                  onPointerUp={() => setDraggingPath(false)}
                  className={`rounded border border-slate-300 bg-white text-[10px] text-slate-500 ${
                    canPlan ? "hover:bg-slate-100" : "cursor-default"
                  }`}
                  style={{ width: CELL_SIZE, height: CELL_SIZE }}
                >
                  ({row},{col})
                </button>
              ))
            )}
          </div>

          <svg className="pointer-events-none absolute inset-0" width={BOARD_PX} height={BOARD_PX} viewBox={`0 0 ${BOARD_PX} ${BOARD_PX}`}>
            {match.phase === "planning" && planningLine.split(" ").length >= 2 && (
              <polyline points={planningLine} fill="none" stroke={mySlot === 1 ? "#dc2626" : "#2563eb"} strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" opacity="0.75" />
            )}
            {match.phase === "resolving" && resolvingP1Line.split(" ").length >= 2 && (
              <polyline points={resolvingP1Line} fill="none" stroke="#dc2626" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" opacity="0.75" />
            )}
            {match.phase === "resolving" && resolvingP2Line.split(" ").length >= 2 && (
              <polyline points={resolvingP2Line} fill="none" stroke="#2563eb" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" opacity="0.75" />
            )}
          </svg>

          <div
            className="pointer-events-none absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-red-500"
            style={{
              left: p1Px.left,
              top: p1Px.top,
              transition: `left ${STEP_ANIMATION_MS}ms linear, top ${STEP_ANIMATION_MS}ms linear`,
              boxShadow:
                (mySlot === 1
                  ? "0 0 0 3px rgba(34,197,94,0.85), 0 0 12px 3px rgba(34,197,94,0.65)"
                  : "0 2px 6px rgba(15,23,42,0.25)") + (p1IsAttacker ? ", 0 0 14px 5px rgba(249,115,22,0.65)" : "")
            }}
          />
          {p1IsAttacker && (
            <div
              className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 animate-pulse text-xs text-orange-500"
              style={{ left: p1Px.left, top: p1Px.top - 14 }}
            >
              🔥
            </div>
          )}
          <div
            className="pointer-events-none absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-500"
            style={{
              left: p2Px.left,
              top: p2Px.top,
              transition: `left ${STEP_ANIMATION_MS}ms linear, top ${STEP_ANIMATION_MS}ms linear`,
              boxShadow:
                (mySlot === 2
                  ? "0 0 0 3px rgba(34,197,94,0.85), 0 0 12px 3px rgba(34,197,94,0.65)"
                  : "0 2px 6px rgba(15,23,42,0.25)") + (p2IsAttacker ? ", 0 0 14px 5px rgba(249,115,22,0.65)" : "")
            }}
          />
          {p2IsAttacker && (
            <div
              className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 animate-pulse text-xs text-orange-500"
              style={{ left: p2Px.left, top: p2Px.top - 14 }}
            >
              🔥
            </div>
          )}
        </div>
      </section>

      <section className="mt-4 rounded-xl bg-white p-4 shadow-sm">
        <h2 className="font-semibold">Path Planning</h2>
        <p className="mt-1 text-sm text-slate-600">
          {match.phase === "resolving"
            ? "Resolving round..."
            : mySubmitted
              ? "Path submitted."
              : "Drag from your piece (or path end) to set route."}
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => submitPath(plannedPath)}
            disabled={!canPlan}
            className="rounded-lg bg-slate-900 px-4 py-2 text-white disabled:cursor-not-allowed disabled:bg-slate-400"
          >
            Submit path
          </button>
          <button
            type="button"
            onClick={() => setPlannedPath((prev) => prev.slice(0, -1))}
            disabled={!canPlan || plannedPath.length === 0}
            className="rounded-lg bg-slate-700 px-4 py-2 text-white disabled:cursor-not-allowed disabled:bg-slate-400"
          >
            Undo
          </button>
          <button
            type="button"
            onClick={() => setPlannedPath([])}
            disabled={!canPlan || plannedPath.length === 0}
            className="rounded-lg bg-slate-500 px-4 py-2 text-white disabled:cursor-not-allowed disabled:bg-slate-400"
          >
            Clear
          </button>
        </div>
      </section>

      {message && <p className="mt-4 rounded-lg bg-red-100 p-3 text-sm text-red-700">{message}</p>}
    </main>
  );
}
