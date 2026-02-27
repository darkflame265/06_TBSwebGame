type MatchHeaderProps = {
  darkMode: boolean;
  matchId: string;
  status: string;
  phase: "planning" | "resolving";
  currentTurn: number;
  myColor: string;
  myRole: string;
  muted: boolean;
  leaving: boolean;
  obstaclesReadyForTurn: boolean;
  isMovingUi: boolean;
  secondsLeft: string;
  shownMillisLeft: number;
  timerBarBase: number;
  onToggleMuted: () => void;
  onLeaveMatch: () => void;
  isFinished: boolean;
};

export function MatchHeader({
  darkMode,
  matchId,
  status,
  phase,
  currentTurn,
  myColor,
  myRole,
  muted,
  leaving,
  obstaclesReadyForTurn,
  isMovingUi,
  secondsLeft,
  shownMillisLeft,
  timerBarBase,
  onToggleMuted,
  onLeaveMatch,
  isFinished,
}: MatchHeaderProps) {
  return (
    <header className="mx-auto max-w-7xl px-6 pb-2 pt-8">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1
            className={`flex items-center gap-2 text-3xl font-bold tracking-tight ${darkMode ? "text-slate-100" : "text-slate-900"}`}
          >
            <span className="text-[#ef4444]">🎮</span>
            Match{" "}
            <span
              className={`rounded-md px-2 py-1 font-mono text-sm font-medium ${
                darkMode ? "bg-[#1E252B] text-[#9AA4AE]" : "bg-slate-200 text-slate-600"
              }`}
            >
              {matchId}
            </span>
          </h1>
          <div
            className={`mt-2 flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] ${
              darkMode ? "text-[#9AA4AE]" : "text-slate-600"
            }`}
          >
            <span>
              Status:{" "}
              <span
                className={`${
                  status === "active"
                    ? "text-emerald-500"
                    : status === "finished"
                      ? "text-rose-500"
                      : darkMode
                        ? "text-slate-200"
                        : "text-slate-800"
                }`}
              >
                {status}
              </span>
            </span>
            <span className="opacity-50">|</span>
            <span>
              Phase:{" "}
              <span className={phase === "planning" ? "text-amber-400" : "text-blue-400"}>
                {phase}
              </span>
            </span>
            <span className="opacity-50">|</span>
            <span>Round: {currentTurn}</span>
            <span className="opacity-50">|</span>
            <span>
              Piece: <span className={myColor === "Red" ? "text-red-500" : "text-blue-400"}>{myColor}</span>
            </span>
            <span className="opacity-50">|</span>
            <span>Role: {myRole}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onToggleMuted}
            className={`rounded-lg border px-3 py-2 text-sm shadow-sm ${
              darkMode
                ? "border-[#3A444D] bg-[#1E252B] text-slate-100"
                : "border-slate-200 bg-white text-slate-700"
            }`}
          >
            {muted ? "SFX Off" : "SFX On"}
          </button>
          <button
            onClick={onLeaveMatch}
            disabled={leaving}
            className="rounded-lg bg-[#bc4749] px-4 py-2 text-white shadow-sm disabled:cursor-not-allowed disabled:bg-slate-400"
          >
            {leaving ? "Leaving..." : isFinished ? "Back to lobby" : "Leave match"}
          </button>
        </div>
      </div>
      <div
        className={`rounded-xl border p-4 shadow-sm ${
          darkMode ? "border-[#3A444D] bg-[#1E252B]" : "border-slate-200/70 bg-white"
        }`}
      >
        <div
          className={`mb-2 flex items-center justify-between text-xs font-bold uppercase tracking-wider ${
            darkMode ? "text-slate-300" : "text-slate-500"
          }`}
        >
          <span>{phase} phase</span>
          <div className="flex items-center gap-3">
            {phase === "planning" && !obstaclesReadyForTurn && (
              <span
                className={`text-[11px] font-semibold normal-case ${
                  darkMode ? "text-amber-400" : "text-amber-700"
                }`}
              >
                Preparing obstacle layout...
              </span>
            )}
            <span className="text-[#386641]">{isMovingUi ? "moving..." : `timer: ${secondsLeft}s`}</span>
          </div>
        </div>
        <div className={`h-1.5 w-full overflow-hidden rounded ${darkMode ? "bg-[#2A3137]" : "bg-slate-200"}`}>
          <div
            className="h-full bg-[#386641]"
            style={{
              width: `${Math.max(0, Math.min(100, ((isMovingUi ? 0 : shownMillisLeft) / timerBarBase) * 100))}%`,
            }}
          />
        </div>
      </div>
    </header>
  );
}
