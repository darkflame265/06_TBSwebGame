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
type CollisionMeta = {
  collision: boolean;
  hitSlot: 1 | 2 | null;
  collisionAt: Coord | null;
  collisionStep: number | null;
  collisionT: number | null;
};

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
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

const deriveCollisionAt = (start: DisplayBoard, p1Path: Coord[], p2Path: Coord[]): Coord | null => {
  const steps = Math.max(p1Path.length, p2Path.length);
  let p1 = start.p1;
  let p2 = start.p2;
  for (let i = 0; i < steps; i += 1) {
    if (i < p1Path.length) p1 = p1Path[i];
    if (i < p2Path.length) p2 = p2Path[i];
    if (sameCoord(p1, p2)) return p1;
  }
  return null;
};
const progressOnSegment = (from: Coord, to: Coord, point: Coord): number | null => {
  const eps = 0.0001;
  if (sameCoord(from, to)) return null;
  if (Math.abs(from[0] - to[0]) < eps) {
    if (Math.abs(point[0] - from[0]) > eps) return null;
    const den = to[1] - from[1];
    if (Math.abs(den) < eps) return null;
    const t = (point[1] - from[1]) / den;
    return t >= -eps && t <= 1 + eps ? clamp01(t) : null;
  }
  if (Math.abs(from[1] - to[1]) < eps) {
    if (Math.abs(point[1] - from[1]) > eps) return null;
    const den = to[0] - from[0];
    if (Math.abs(den) < eps) return null;
    const t = (point[0] - from[0]) / den;
    return t >= -eps && t <= 1 + eps ? clamp01(t) : null;
  }
  return null;
};

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
  const [muted, setMuted] = useState(false);
  const [impactCoord, setImpactCoord] = useState<Coord | null>(null);
  const [hitFlashSlot, setHitFlashSlot] = useState<1 | 2 | null>(null);
  const [shakingHeart, setShakingHeart] = useState<{ slot: 1 | 2; index: number; nonce: number } | null>(null);
  const [displayHp, setDisplayHp] = useState<{ p1: number; p2: number }>({ p1: 3, p2: 3 });

  const prevMatchRef = useRef<MatchResponse | null>(null);
  const animatingRef = useRef(false);
  const animatedTurnRef = useRef<number | null>(null);
  const autoSubmittedRoundRef = useRef<number | null>(null);
  const latestMillisLeftRef = useRef(0);
  const audioCtxRef = useRef<AudioContext | null>(null);

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

  const playHitSfx = () => {
    if (muted) return;
    try {
      if (!audioCtxRef.current) audioCtxRef.current = new window.AudioContext();
      const ctx = audioCtxRef.current;
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "square";
      osc.frequency.setValueAtTime(220, now);
      osc.frequency.exponentialRampToValueAtTime(90, now + 0.16);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.2, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.2);
    } catch {
      // ignore audio init errors
    }
  };

  const triggerImpactFx = (meta: CollisionMeta) => {
    if (!meta.collision || !meta.hitSlot || !meta.collisionAt) return;
    setImpactCoord(meta.collisionAt);
    setHitFlashSlot(meta.hitSlot);
    playHitSfx();
    setTimeout(() => setImpactCoord(null), 450);
    setTimeout(() => setHitFlashSlot(null), 700);
  };

  const animateResolvedRound = async (start: DisplayBoard, p1Path: Coord[], p2Path: Coord[], meta: CollisionMeta) => {
    const steps = Math.max(p1Path.length, p2Path.length);
    setResolvedOverlay({ start, p1: p1Path, p2: p2Path });
    setDisplayBoard(start);
    setFrozenTimerMs(Math.max(0, latestMillisLeftRef.current));
    animatingRef.current = true;
    setAnimating(true);
    let didTriggerHit = false;

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
      const prevP1 = p1;
      const prevP2 = p2;
      if (i < p1Path.length) p1 = p1Path[i];
      if (i < p2Path.length) p2 = p2Path[i];
      setDisplayBoard({ p1, p2 });
      if (!didTriggerHit && meta.collision && meta.collisionAt && meta.collisionStep === i) {
        didTriggerHit = true;
        let collisionT = meta.collisionT ?? null;
        if (collisionT === null) {
          const t1 = progressOnSegment(prevP1, p1, meta.collisionAt);
          const t2 = progressOnSegment(prevP2, p2, meta.collisionAt);
          if (t1 !== null && t2 !== null) {
            collisionT = clamp01((t1 + t2) / 2);
          } else if (sameCoord(p1, meta.collisionAt) && sameCoord(p2, meta.collisionAt)) {
            collisionT = 1;
          } else {
            collisionT = 1;
          }
        }
        const delay = Math.round(STEP_ANIMATION_MS * clamp01(collisionT));
        if (delay > 0) await sleep(delay);
        triggerImpactFx(meta);
        if (meta.hitSlot === 1) {
          setDisplayHp((hp) => {
            const next = Math.max(hp.p1 - 1, 0);
            setShakingHeart({ slot: 1, index: next, nonce: Date.now() });
            return { ...hp, p1: next };
          });
        } else if (meta.hitSlot === 2) {
          setDisplayHp((hp) => {
            const next = Math.max(hp.p2 - 1, 0);
            setShakingHeart({ slot: 2, index: next, nonce: Date.now() });
            return { ...hp, p2: next };
          });
        }
        if (delay < STEP_ANIMATION_MS) await sleep(STEP_ANIMATION_MS - delay);
      } else {
        await sleep(STEP_ANIMATION_MS);
      }
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
        setDisplayHp({ p1: data.p1_hp, p2: data.p2_hp });
      } else if (
        data.phase === "resolving" &&
        data.resolved_paths &&
        animatedTurnRef.current !== data.resolved_paths.turn &&
        !animatingRef.current
      ) {
        const start = data.resolved_paths.start;
        const collisionAt =
          data.resolved_paths.collision_at ??
          deriveCollisionAt({ p1: start.p1, p2: start.p2 }, data.resolved_paths.p1, data.resolved_paths.p2);
        await animateResolvedRound(
          { p1: start.p1, p2: start.p2 },
          data.resolved_paths.p1,
          data.resolved_paths.p2,
          {
            collision: !!data.resolved_paths.collision,
            hitSlot: data.resolved_paths.hit_slot ?? null,
            collisionAt,
            collisionStep: data.resolved_paths.collision_step ?? null,
            collisionT: data.resolved_paths.collision_t ?? null
          }
        );
        animatedTurnRef.current = data.resolved_paths.turn;
      } else if (!animatingRef.current) {
        setDisplayBoard(nextBoard);
        setDisplayHp({ p1: data.p1_hp, p2: data.p2_hp });
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
    const saved = localStorage.getItem("tbs-muted");
    if (saved) setMuted(saved === "1");
    supabase.auth.getUser().then(({ data }) => setMe(data.user?.id ?? null));
    loadMatch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchId]);

  useEffect(() => {
    localStorage.setItem("tbs-muted", muted ? "1" : "0");
  }, [muted]);

  useEffect(() => {
    if (!shakingHeart) return;
    const t = setTimeout(() => setShakingHeart(null), 550);
    return () => clearTimeout(t);
  }, [shakingHeart]);

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
  const impactPx = impactCoord ? coordToPx(impactCoord) : null;

  return (
    <main className="mx-auto min-h-screen max-w-5xl p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-3xl font-bold">Match {match.id}</h1>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setMuted((v) => !v)}
            className="rounded-lg bg-slate-700 px-3 py-2 text-sm text-white"
          >
            {muted ? "Unmute SFX" : "Mute SFX"}
          </button>
          <button
            onClick={leaveMatch}
            disabled={leaving}
            className="rounded-lg bg-red-700 px-4 py-2 text-white disabled:cursor-not-allowed disabled:bg-slate-400"
          >
            {leaving ? "Leaving..." : match.status === "finished" ? "Back to lobby" : "Leave match"}
          </button>
        </div>
      </div>

      <div className="mt-3 rounded-xl bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-slate-700">
            Status: {match.status} | Phase: {match.phase} | Round: {match.current_turn} | Piece: {myColor} | Role: {myRole} | Max path points: {maxPoints}
          </p>
          <p className="font-mono text-sm font-semibold text-slate-900">{animating ? "moving..." : `${match.phase} timer: ${secondsLeft}s`}</p>
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
            <span className={p1Submitted ? "font-semibold text-emerald-600" : "font-semibold text-slate-400"}>{p1Submitted ? "Ready" : "Waiting"}</span>
          </div>
          <div className="flex items-center justify-between rounded border border-slate-200 bg-slate-50 px-3 py-2">
            <span className="font-medium text-slate-700">Blue (Slot 2){p2IsAttacker ? " - ATTACK" : " - EVADE"}</span>
            <span className={p2Submitted ? "font-semibold text-emerald-600" : "font-semibold text-slate-400"}>{p2Submitted ? "Ready" : "Waiting"}</span>
          </div>
          <div className="col-span-2 rounded border border-slate-200 bg-slate-50 px-3 py-2">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-1">
                <span className="text-xs font-medium text-slate-600">Red HP:</span>
                {heartsForHp(displayHp.p1).map((filled, idx) => (
                  <span
                    key={`p1-heart-${idx}-${shakingHeart?.nonce ?? 0}`}
                    className={`text-lg text-rose-500 ${filled ? "opacity-100" : "opacity-25"} ${
                      shakingHeart?.slot === 1 && shakingHeart.index === idx ? "heart-shake" : ""
                    }`}
                  >
                    {"\u2665"}
                  </span>
                ))}
              </div>
              <div className="flex items-center gap-1">
                <span className="text-xs font-medium text-slate-600">Blue HP:</span>
                {heartsForHp(displayHp.p2).map((filled, idx) => (
                  <span
                    key={`p2-heart-${idx}-${shakingHeart?.nonce ?? 0}`}
                    className={`text-lg text-rose-500 ${filled ? "opacity-100" : "opacity-25"} ${
                      shakingHeart?.slot === 2 && shakingHeart.index === idx ? "heart-shake" : ""
                    }`}
                  >
                    {"\u2665"}
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

          {impactPx && (
            <div
              className="pointer-events-none absolute impact-burst -translate-x-1/2 -translate-y-1/2"
              style={{ left: impactPx.left, top: impactPx.top }}
            />
          )}

          <div
            className={`pointer-events-none absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-red-500 ${
              hitFlashSlot === 1 ? "hit-blink" : ""
            }`}
            style={{
              left: p1Px.left,
              top: p1Px.top,
              transition: `left ${STEP_ANIMATION_MS}ms linear, top ${STEP_ANIMATION_MS}ms linear`,
              boxShadow:
                (mySlot === 1 ? "0 0 0 3px rgba(34,197,94,0.85), 0 0 12px 3px rgba(34,197,94,0.65)" : "0 2px 6px rgba(15,23,42,0.25)") +
                (p1IsAttacker ? ", 0 0 14px 5px rgba(249,115,22,0.65)" : "")
            }}
          />
          {p1IsAttacker && (
            <div
              className="pointer-events-none absolute flame-aura -translate-x-1/2 -translate-y-1/2"
              style={{ left: p1Px.left, top: p1Px.top, transition: `left ${STEP_ANIMATION_MS}ms linear, top ${STEP_ANIMATION_MS}ms linear` }}
            />
          )}

          <div
            className={`pointer-events-none absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-500 ${
              hitFlashSlot === 2 ? "hit-blink" : ""
            }`}
            style={{
              left: p2Px.left,
              top: p2Px.top,
              transition: `left ${STEP_ANIMATION_MS}ms linear, top ${STEP_ANIMATION_MS}ms linear`,
              boxShadow:
                (mySlot === 2 ? "0 0 0 3px rgba(34,197,94,0.85), 0 0 12px 3px rgba(34,197,94,0.65)" : "0 2px 6px rgba(15,23,42,0.25)") +
                (p2IsAttacker ? ", 0 0 14px 5px rgba(249,115,22,0.65)" : "")
            }}
          />
          {p2IsAttacker && (
            <div
              className="pointer-events-none absolute flame-aura -translate-x-1/2 -translate-y-1/2"
              style={{ left: p2Px.left, top: p2Px.top, transition: `left ${STEP_ANIMATION_MS}ms linear, top ${STEP_ANIMATION_MS}ms linear` }}
            />
          )}
        </div>
      </section>

      <section className="mt-4 rounded-xl bg-white p-4 shadow-sm">
        <h2 className="font-semibold">Path Planning</h2>
        <p className="mt-1 text-sm text-slate-600">
          {match.phase === "resolving" ? "Resolving round..." : mySubmitted ? "Path submitted." : "Drag from your piece (or path end) to set route."}
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

      <style jsx global>{`
        .hit-blink {
          animation: hit-blink 0.18s steps(2, end) 4;
        }
        .impact-burst {
          width: 18px;
          height: 18px;
          border-radius: 9999px;
          border: 3px solid rgba(251, 146, 60, 0.95);
          box-shadow: 0 0 18px rgba(251, 146, 60, 0.9);
          animation: impact-burst 0.42s ease-out forwards;
        }
        .heart-shake {
          animation: heart-shake 0.45s ease-in-out;
        }
        .flame-aura {
          width: 22px;
          height: 22px;
          border-radius: 9999px;
          background: radial-gradient(circle at 50% 65%, rgba(251, 146, 60, 0.9), rgba(251, 146, 60, 0.35) 55%, rgba(251, 146, 60, 0) 75%);
          filter: blur(0.4px);
          animation: flame-flicker 0.28s ease-in-out infinite alternate;
        }
        @keyframes hit-blink {
          0% {
            opacity: 1;
          }
          50% {
            opacity: 0.2;
          }
          100% {
            opacity: 1;
          }
        }
        @keyframes impact-burst {
          0% {
            transform: translate(-50%, -50%) scale(0.4);
            opacity: 1;
          }
          100% {
            transform: translate(-50%, -50%) scale(2.1);
            opacity: 0;
          }
        }
        @keyframes heart-shake {
          0% {
            transform: translateX(0);
          }
          20% {
            transform: translateX(-2px);
          }
          40% {
            transform: translateX(2px);
          }
          60% {
            transform: translateX(-2px);
          }
          80% {
            transform: translateX(2px);
          }
          100% {
            transform: translateX(0);
          }
        }
        @keyframes flame-flicker {
          0% {
            transform: translate(-50%, -50%) scale(1);
            opacity: 0.8;
          }
          100% {
            transform: translate(-50%, -50%) scale(1.12);
            opacity: 1;
          }
        }
      `}</style>
    </main>
  );
}
