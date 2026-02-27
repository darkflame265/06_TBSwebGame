type MatchResultPanelProps = {
  darkMode: boolean;
  showResult: boolean;
  iWon: boolean;
  iLost: boolean;
  matchType: string;
  requestingRematch: boolean;
  myRematchRequested: boolean;
  opponentRematchRequested: boolean;
  rematchMatchId: string | null;
  presenceReady: boolean;
  opponentOnline: boolean;
  opponentLeft: boolean;
  onRequestRematch: () => void;
};

export function MatchResultPanel({
  darkMode,
  showResult,
  iWon,
  iLost,
  matchType,
  requestingRematch,
  myRematchRequested,
  opponentRematchRequested,
  rematchMatchId,
  presenceReady,
  opponentOnline,
  opponentLeft,
  onRequestRematch,
}: MatchResultPanelProps) {
  if (!showResult) return null;

  return (
    <>
      <div
        className={`mx-auto mt-3 max-w-7xl rounded-xl p-4 text-center text-2xl font-extrabold ${
          iWon ? "bg-emerald-100 text-emerald-700" : iLost ? "bg-rose-100 text-rose-700" : "bg-slate-100 text-slate-700"
        }`}
      >
        {iWon ? "YOU WIN" : iLost ? "YOU LOSE" : "MATCH FINISHED"}
      </div>

      <div
        className={`mx-auto mt-3 max-w-7xl rounded-xl p-4 shadow-sm ${
          darkMode ? "bg-[#1E252B]" : "bg-white"
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={onRequestRematch}
            disabled={
              matchType === "ai"
                ? requestingRematch
                : requestingRematch || myRematchRequested || !!rematchMatchId || (presenceReady && !opponentOnline)
            }
            className="rounded-lg bg-indigo-700 px-4 py-2 text-white disabled:cursor-not-allowed disabled:bg-slate-400"
          >
            {matchType === "ai"
              ? requestingRematch
                ? "Starting..."
                : "REMATCH"
              : rematchMatchId
                ? "Starting rematch..."
                : myRematchRequested
                  ? "Rematch requested"
                  : requestingRematch
                    ? "Requesting..."
                    : "REMATCH"}
          </button>
          {matchType === "ai" && (
            <p className={`ml-auto text-sm ${darkMode ? "text-slate-300" : "text-slate-600"}`}>AI match finished.</p>
          )}
          {opponentRematchRequested && !myRematchRequested && !rematchMatchId && !opponentLeft && (
            <p className="text-sm font-semibold text-indigo-700">The opponent has requested a rematch.</p>
          )}
          {myRematchRequested && !opponentRematchRequested && !rematchMatchId && !opponentLeft && (
            <p className={`text-sm ${darkMode ? "text-slate-300" : "text-slate-600"}`}>
              Rematch request sent. Waiting for opponent...
            </p>
          )}
          {opponentLeft && <p className="text-sm font-semibold text-rose-700">The opponent has left the game.</p>}
        </div>
      </div>
    </>
  );
}


