import type { Dispatch, RefObject, SetStateAction } from "react";
import {
  BOARD_SIZE,
  CELL_GAP,
  BLUE_PATH_STROKE,
  RED_PATH_STROKE,
} from "./constants";
import { heartsForHp } from "./utils";

const SwordIcon = () => (
  <svg viewBox="0 0 64 64" className="h-full w-full" aria-hidden>
    <g
      fill="none"
      stroke="currentColor"
      strokeWidth="4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M50 10L28 32" />
      <path d="M54 6L46 14" />
      <path d="M28 32L20 40" />
      <path d="M20 40L12 34L6 40L12 46L6 52L12 58L18 52L24 58L30 52L24 46L30 40L24 34L20 40" />
    </g>
  </svg>
);

const RunIcon = () => (
  <svg viewBox="0 0 64 64" className="h-full w-full" aria-hidden>
    <g
      fill="none"
      stroke="currentColor"
      strokeWidth="4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="42" cy="10" r="5" />
      <path d="M36 20L28 30L40 34L34 46" />
      <path d="M28 30L18 24" />
      <path d="M24 44L14 54" />
      <path d="M40 34L50 42" />
      <path d="M6 58H58" />
    </g>
  </svg>
);

type MatchBoardSectionProps = {
  darkMode: boolean;
  boardClusterHostRef: RefObject<HTMLDivElement | null>;
  clusterGap: number;
  boardPx: number;
  boardCellSize: number;
  obstacleKeys: Set<string>;
  canPlan: boolean;
  beginPathDrag: (row: number, col: number) => void;
  extendOrRewindPath: (row: number, col: number) => void;
  tapPathStep: (row: number, col: number) => void;
  setDraggingPath: Dispatch<SetStateAction<boolean>>;
  matchPhase: "planning" | "resolving";
  planningLine: string;
  mySlot: number | null;
  showResolvedPaths: boolean;
  resolvingP1Line: string;
  resolvingP2Line: string;
  impactPx: { left: number; top: number } | null;
  hitFlashSlot: 1 | 2 | null;
  explodedSlot: 1 | 2 | null;
  p1Px: { left: number; top: number };
  p2Px: { left: number; top: number };
  pieceTransitionMs: number;
  p1IsAttacker: boolean;
  p2IsAttacker: boolean;
  roleTitleFontSize: number;
  roleOuterSize: number;
  roleIconSize: number;
  myRole: string;
  roleLabelFontSize: number;
  remainingPathPoints: number;
  maxPoints: number;
  pathGaugeSegments: boolean[];
  sidePanelWidth: number;
  p1Name: string;
  p2Name: string;
  p1Record: string | false | undefined;
  p2Record: string | false | undefined;
  p1UserId: string;
  p2UserId: string;
  openProfileSlot: 1 | 2 | null;
  setOpenProfileSlot: Dispatch<SetStateAction<1 | 2 | null>>;
  displayHp: { p1: number; p2: number };
  shakingHeart: { slot: 1 | 2; index: number; nonce: number } | null;
  showAiThinking: boolean;
};

export function MatchBoardSection({
  darkMode,
  boardClusterHostRef,
  clusterGap,
  boardPx,
  boardCellSize,
  obstacleKeys,
  canPlan,
  beginPathDrag,
  extendOrRewindPath,
  tapPathStep,
  setDraggingPath,
  matchPhase,
  planningLine,
  mySlot,
  showResolvedPaths,
  resolvingP1Line,
  resolvingP2Line,
  impactPx,
  hitFlashSlot,
  explodedSlot,
  p1Px,
  p2Px,
  pieceTransitionMs,
  p1IsAttacker,
  p2IsAttacker,
  roleTitleFontSize,
  roleOuterSize,
  roleIconSize,
  myRole,
  roleLabelFontSize,
  remainingPathPoints,
  maxPoints,
  pathGaugeSegments,
  sidePanelWidth,
  p1Name,
  p2Name,
  p1Record,
  p2Record,
  p1UserId,
  p2UserId,
  openProfileSlot,
  setOpenProfileSlot,
  displayHp,
  shakingHeart,
  showAiThinking,
}: MatchBoardSectionProps) {
  return (
    <section
      className={`rounded-2xl border p-6 shadow-sm lg:col-span-8 ${
        darkMode ? "border-[#3A444D] bg-[#1E252B]" : "border-slate-200/60 bg-white"
      }`}
    >
      <div className="mb-8 flex items-center justify-between">
        <h2 className="text-xl font-bold">Board 5x5</h2>
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-3">
            <div className="text-right">
              <p className="max-w-[140px] truncate text-[10px] font-bold uppercase text-red-600" title={p1Name}>
                {p1Name}
              </p>
              <div className="mt-0.5 flex justify-end gap-0.5">
                {heartsForHp(displayHp.p1).map((filled, idx) => (
                  <span
                    key={`p1-heart-header-${idx}-${shakingHeart?.nonce ?? 0}`}
                    className={`text-lg text-rose-500 ${filled ? "opacity-100" : "opacity-25"} ${
                      shakingHeart?.slot === 1 && shakingHeart.index === idx ? "heart-shake" : ""
                    }`}
                  >
                    {"♥"}
                  </span>
                ))}
              </div>
            </div>
            <div className="relative">
              <button
                type="button"
                onClick={() => setOpenProfileSlot((prev) => (prev === 1 ? null : 1))}
                className="relative flex h-10 w-10 items-center justify-center rounded-full border-2 border-red-500 bg-red-50 text-red-500"
                title={p1Name}
              >
                <span>◎</span>
              </button>
              {openProfileSlot === 1 && (
                <div
                  className={`absolute -bottom-[90px] left-1/2 z-20 w-[320px] -translate-x-1/2 rounded border p-3 text-xs shadow ${
                    darkMode
                      ? "border-[#3A444D] bg-[#2A3137] text-slate-200"
                      : "border-slate-200 bg-white text-slate-700"
                  }`}
                >
                  <p className="select-text font-semibold">
                    {p1Name}
                    {p1Record ? ` (${p1Record})` : ""}
                  </p>
                  <p className="mt-1 select-text break-all font-mono text-[11px]">Guest: {p1UserId}</p>
                </div>
              )}
            </div>
          </div>
          <div className="h-8 w-px bg-slate-200" />
          <div className="flex items-center gap-3">
            <div className="relative">
              <button
                type="button"
                onClick={() => setOpenProfileSlot((prev) => (prev === 2 ? null : 2))}
                className="relative flex h-10 w-10 items-center justify-center rounded-full border-2 border-blue-500 bg-blue-50 text-blue-500"
                title={p2Name}
              >
                <span>◎</span>
              </button>
              {openProfileSlot === 2 && (
                <div
                  className={`absolute -bottom-[90px] left-1/2 z-20 w-[320px] -translate-x-1/2 rounded border p-3 text-xs shadow ${
                    darkMode
                      ? "border-[#3A444D] bg-[#2A3137] text-slate-200"
                      : "border-slate-200 bg-white text-slate-700"
                  }`}
                >
                  <p className="select-text font-semibold">
                    {p2Name}
                    {p2Record ? ` (${p2Record})` : ""}
                  </p>
                  <p className="mt-1 select-text break-all font-mono text-[11px]">Guest: {p2UserId}</p>
                </div>
              )}
            </div>
            <div>
              <p className="max-w-[140px] truncate text-[10px] font-bold uppercase text-blue-500" title={p2Name}>
                {p2Name}
              </p>
              {showAiThinking && <p className="text-[10px] font-semibold text-emerald-600">AI is thinking...</p>}
              <div className="mt-0.5 flex gap-0.5">
                {heartsForHp(displayHp.p2).map((filled, idx) => (
                  <span
                    key={`p2-heart-header-${idx}-${shakingHeart?.nonce ?? 0}`}
                    className={`text-lg text-rose-500 ${filled ? "opacity-100" : "opacity-25"} ${
                      shakingHeart?.slot === 2 && shakingHeart.index === idx ? "heart-shake" : ""
                    }`}
                  >
                    {"♥"}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
      <div ref={boardClusterHostRef} className="mt-5 w-full">
        <div className="flex items-start gap-4" style={{ gap: clusterGap }}>
          <div className="relative flex-none" style={{ width: boardPx, height: boardPx, touchAction: "none" }}>
            <div
              className="grid"
              style={{
                width: boardPx,
                height: boardPx,
                gridTemplateColumns: `repeat(${BOARD_SIZE}, minmax(0, 1fr))`,
                gap: `${CELL_GAP}px`,
              }}
            >
              {Array.from({ length: BOARD_SIZE }).map((_, row) =>
                Array.from({ length: BOARD_SIZE }).map((__, col) => {
                  const isObstacle = obstacleKeys.has(`${row},${col}`);
                  return (
                    <button
                      key={`${row}-${col}`}
                      type="button"
                      onPointerDown={(e) => {
                        e.preventDefault();
                        beginPathDrag(row, col);
                      }}
                      onPointerEnter={() => extendOrRewindPath(row, col)}
                      onPointerUp={() => setDraggingPath(false)}
                      onClick={() => tapPathStep(row, col)}
                      className={`relative rounded-lg border text-[10px] ${
                        isObstacle
                          ? darkMode
                            ? "cursor-not-allowed border-[#3A444D] bg-slate-900/80 text-slate-300"
                            : "cursor-not-allowed border-slate-700 bg-slate-800 text-slate-300"
                          : darkMode
                            ? `border-[#3A444D] bg-[#2A3137] text-[#9AA4AE] ${
                                canPlan ? "hover:bg-[#333C44]" : "cursor-default"
                              }`
                            : `border-slate-200 bg-slate-50 text-slate-500 ${
                                canPlan ? "hover:bg-slate-100" : "cursor-default"
                              }`
                      }`}
                      style={{
                        width: boardCellSize,
                        height: boardCellSize,
                        touchAction: "none",
                        userSelect: "none",
                      }}
                    >
                      ({row},{col})
                    </button>
                  );
                }),
              )}
            </div>

            <svg
              className="pointer-events-none absolute inset-0"
              width={boardPx}
              height={boardPx}
              viewBox={`0 0 ${boardPx} ${boardPx}`}
            >
              {matchPhase === "planning" && planningLine.split(" ").length >= 2 && (
                <polyline
                  points={planningLine}
                  fill="none"
                  stroke={mySlot === 1 ? "#dc2626" : "#2563eb"}
                  strokeWidth={mySlot === 1 ? RED_PATH_STROKE : BLUE_PATH_STROKE}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity="0.75"
                />
              )}
              {showResolvedPaths && resolvingP1Line.split(" ").length >= 2 && (
                <polyline
                  points={resolvingP1Line}
                  fill="none"
                  stroke="#dc2626"
                  strokeWidth={RED_PATH_STROKE}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity="0.75"
                />
              )}
              {showResolvedPaths && resolvingP2Line.split(" ").length >= 2 && (
                <polyline
                  points={resolvingP2Line}
                  fill="none"
                  stroke="#2563eb"
                  strokeWidth={BLUE_PATH_STROKE}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity="0.85"
                />
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
              } ${explodedSlot === 1 ? "piece-explode" : ""}`}
              style={{
                left: p1Px.left,
                top: p1Px.top,
                transition: `left ${pieceTransitionMs}ms linear, top ${pieceTransitionMs}ms linear`,
                boxShadow:
                  (mySlot === 1
                    ? "0 0 0 3px rgba(34,197,94,0.85), 0 0 12px 3px rgba(34,197,94,0.65)"
                    : "0 2px 6px rgba(15,23,42,0.25)") +
                  (p1IsAttacker ? ", 0 0 14px 5px rgba(249,115,22,0.65)" : ""),
              }}
            />
            {p1IsAttacker && (
              <div
                className="pointer-events-none absolute flame-aura -translate-x-1/2 -translate-y-1/2"
                style={{
                  left: p1Px.left,
                  top: p1Px.top,
                  transition: `left ${pieceTransitionMs}ms linear, top ${pieceTransitionMs}ms linear`,
                }}
              />
            )}

            <div
              className={`pointer-events-none absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-500 ${
                hitFlashSlot === 2 ? "hit-blink" : ""
              } ${explodedSlot === 2 ? "piece-explode" : ""}`}
              style={{
                left: p2Px.left,
                top: p2Px.top,
                transition: `left ${pieceTransitionMs}ms linear, top ${pieceTransitionMs}ms linear`,
                boxShadow:
                  (mySlot === 2
                    ? "0 0 0 3px rgba(34,197,94,0.85), 0 0 12px 3px rgba(34,197,94,0.65)"
                    : "0 2px 6px rgba(15,23,42,0.25)") +
                  (p2IsAttacker ? ", 0 0 14px 5px rgba(249,115,22,0.65)" : ""),
              }}
            />
            {p2IsAttacker && (
              <div
                className="pointer-events-none absolute flame-aura -translate-x-1/2 -translate-y-1/2"
                style={{
                  left: p2Px.left,
                  top: p2Px.top,
                  transition: `left ${pieceTransitionMs}ms linear, top ${pieceTransitionMs}ms linear`,
                }}
              />
            )}
          </div>

          <div
            className="space-y-4 flex-none"
            style={{
              width: sidePanelWidth,
              minWidth: sidePanelWidth,
            }}
          >
            <div
              className={`rounded-xl border p-4 text-center ${
                darkMode
                  ? "border-[#3A444D] bg-[#2A3137] text-slate-100"
                  : "border-slate-200 bg-slate-50 text-slate-700"
              }`}
            >
              <p
                className={`font-bold uppercase tracking-widest ${darkMode ? "text-[#9AA4AE]" : "text-slate-500"}`}
                style={{ fontSize: roleTitleFontSize }}
              >
                YOUR ROLE
              </p>
              <div
                className={`mx-auto mt-3 flex items-center justify-center rounded-full border-4 ${
                  myRole === "ATTACK"
                    ? darkMode
                      ? "border-red-400/40 bg-red-500/10 text-red-400"
                      : "border-red-200 bg-red-50 text-red-600"
                    : darkMode
                      ? "border-blue-400/40 bg-blue-500/10 text-blue-400"
                      : "border-blue-200 bg-blue-50 text-blue-600"
                }`}
                style={{ width: roleOuterSize, height: roleOuterSize }}
              >
                <div style={{ width: roleIconSize, height: roleIconSize }}>
                  {myRole === "ATTACK" ? <SwordIcon /> : <RunIcon />}
                </div>
              </div>
              <p
                className={`mt-2 font-bold ${myRole === "ATTACK" ? "text-red-600" : "text-blue-600"}`}
                style={{ fontSize: roleLabelFontSize }}
              >
                {myRole}
              </p>
            </div>
            <div
              className={`rounded-xl border p-3 ${
                darkMode ? "border-emerald-900/40 bg-emerald-950/20" : "border-green-200 bg-green-50"
              }`}
            >
              <div className="mb-1 flex items-center justify-between">
                <span className={`text-xs font-semibold ${darkMode ? "text-emerald-400/90" : "text-[#386641]"}`}>
                  Path Points
                </span>
                <span className={`text-xs font-bold ${darkMode ? "text-emerald-400" : "text-[#386641]"}`}>
                  {remainingPathPoints} / {maxPoints}
                </span>
              </div>
              <div className="flex gap-1">
                {pathGaugeSegments.map((filled, idx) => (
                  <div
                    key={`path-seg-${idx}`}
                    className={`h-1.5 flex-1 rounded-full ${
                      filled
                        ? darkMode
                          ? "bg-emerald-500/70"
                          : "bg-[#386641]"
                        : darkMode
                          ? "bg-slate-800"
                          : "bg-[#b9c7bd]"
                    }`}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
