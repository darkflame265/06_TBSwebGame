import { createAdminSupabase } from "@/lib/supabase/server";
import { generateObstacles, seedForMatchRound, type Coord } from "@/lib/obstacles";

type ReadClient = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: unknown) => {
        maybeSingle: () => Promise<{
          data: {
            phase: "planning" | "resolving";
            current_turn: number;
            board_state: { p1: Coord; p2: Coord } | null;
            obstacles_turn: number | null;
            attacker_slot: 1 | 2 | null;
          } | null;
          error: { message: string } | null;
        }>;
      };
    };
  };
};

export async function ensurePlanningObstaclesReady(
  client: ReadClient,
  matchId: string,
): Promise<string | null> {
  const { data: matchData, error: matchError } = await client
    .from("matches")
    .select("phase,current_turn,board_state,obstacles_turn,attacker_slot")
    .eq("id", matchId)
    .maybeSingle();

  if (matchError) return matchError.message;
  if (!matchData) return null;

  if (
    matchData.phase !== "planning" ||
    !matchData.board_state ||
    matchData.obstacles_turn === matchData.current_turn
  ) {
    return null;
  }

  const p1 = matchData.board_state.p1 as Coord;
  const p2 = matchData.board_state.p2 as Coord;
  const chaserPos = matchData.attacker_slot === 1 ? p1 : p2;
  const runnerPos = matchData.attacker_slot === 1 ? p2 : p1;
  const seed = seedForMatchRound(matchId, matchData.current_turn);
  const generated = generateObstacles({
    gridSize: 5,
    chaserPos,
    runnerPos,
    obstacleCount: 3,
    seed,
  });
  const obstacleArray = Array.from(generated).map((key) => {
    const [x, y] = key.split(",").map(Number);
    return [x, y] as [number, number];
  });

  const admin = createAdminSupabase();
  const { error: updateObstacleError } = await admin
    .from("matches")
    .update({
      obstacles: obstacleArray,
      obstacles_turn: matchData.current_turn,
    })
    .eq("id", matchId)
    .eq("current_turn", matchData.current_turn)
    .eq("phase", "planning");

  if (updateObstacleError) return updateObstacleError.message;
  return null;
}
