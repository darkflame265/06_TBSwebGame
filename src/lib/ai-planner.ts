export type Coord = [number, number];
export type AiRole = "ATTACK" | "EVADE";

type PlannerInput = {
  gridSize: number;
  role: AiRole;
  maxPoints: number;
  selfPos: Coord;
  opponentPos: Coord;
  obstacles: Array<Coord>;
};

const toKey = ([r, c]: Coord) => `${r},${c}`;
const manhattan = (a: Coord, b: Coord) =>
  Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);

const inBounds = ([r, c]: Coord, gridSize: number) =>
  r >= 0 && r < gridSize && c >= 0 && c < gridSize;

const legalMoves = (from: Coord, gridSize: number, obstacleSet: Set<string>) => {
  const candidates: Coord[] = [
    [from[0] - 1, from[1]],
    [from[0] + 1, from[1]],
    [from[0], from[1] - 1],
    [from[0], from[1] + 1]
  ];
  return candidates.filter((next) => inBounds(next, gridSize) && !obstacleSet.has(toKey(next)));
};

const legalMovesNoRevisit = (
  from: Coord,
  gridSize: number,
  obstacleSet: Set<string>,
  visited: Set<string>
) => legalMoves(from, gridSize, obstacleSet).filter((next) => !visited.has(toKey(next)));

const pickRandom = <T>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];

const maxFutureChain = (
  from: Coord,
  remainingSteps: number,
  gridSize: number,
  obstacleSet: Set<string>,
  visited: Set<string>
): number => {
  if (remainingSteps <= 0) return 0;
  const moves = legalMovesNoRevisit(from, gridSize, obstacleSet, visited);
  if (moves.length === 0) return 0;

  let best = 0;
  for (const next of moves) {
    const key = toKey(next);
    visited.add(key);
    const depth = 1 + maxFutureChain(next, remainingSteps - 1, gridSize, obstacleSet, visited);
    visited.delete(key);
    if (depth > best) best = depth;
  }
  return best;
};

export const chooseMoveChase = (
  current: Coord,
  target: Coord,
  gridSize: number,
  obstacleSet: Set<string>,
  visited: Set<string>,
  remainingStepsAfterMove: number
): Coord | null => {
  const moves = legalMovesNoRevisit(current, gridSize, obstacleSet, visited);
  if (moves.length === 0) return null;

  const scored = moves
    .map((move) => {
      const key = toKey(move);
      visited.add(key);
      const runway = maxFutureChain(
        move,
        remainingStepsAfterMove,
        gridSize,
        obstacleSet,
        visited
      );
      visited.delete(key);
      return {
        move,
        dist: manhattan(move, target),
        runway
      };
    })
    .sort((a, b) => {
      // Primary: reduce distance to target.
      if (a.dist !== b.dist) return a.dist - b.dist;
      // Secondary: avoid dead-ends so AI can spend more path points.
      if (a.runway !== b.runway) return b.runway - a.runway;
      return 0;
    });

  if (scored.length > 1 && Math.random() < 0.2) {
    return pickRandom(scored.slice(0, 2)).move;
  }
  return scored[0].move;
};

export const chooseMoveFlee = (
  current: Coord,
  chaser: Coord,
  gridSize: number,
  obstacleSet: Set<string>,
  visited: Set<string>
): Coord | null => {
  const moves = legalMovesNoRevisit(current, gridSize, obstacleSet, visited);
  if (moves.length === 0) return null;

  const currentDist = manhattan(current, chaser);
  const scored = moves
    .map((move) => ({ move, score: manhattan(move, chaser) }))
    .sort((a, b) => b.score - a.score);

  if (Math.random() < 0.3) {
    const safeSideways = scored.filter(
      (entry) => entry.score >= currentDist && entry.score < scored[0].score
    );
    if (safeSideways.length > 0) return pickRandom(safeSideways).move;
  }

  return scored[0].move;
};

export const generatePathForRole = ({
  gridSize,
  role,
  maxPoints,
  selfPos,
  opponentPos,
  obstacles
}: PlannerInput): Coord[] => {
  if (maxPoints <= 0) return [];

  const obstacleSet = new Set(obstacles.map(toKey));
  const visited = new Set<string>([toKey(selfPos)]);
  const path: Coord[] = [];
  let cur: Coord = [selfPos[0], selfPos[1]];

  const spendPoints =
    role === "ATTACK"
      ? maxPoints
      : Math.max(
          1,
          Math.min(
            maxPoints,
            Math.round(maxPoints * (0.4 + Math.random() * 0.4))
          )
        );

  for (let i = 0; i < spendPoints; i += 1) {
    const remainingAfterMove = spendPoints - i - 1;
    const next =
      role === "ATTACK"
        ? chooseMoveChase(
            cur,
            opponentPos,
            gridSize,
            obstacleSet,
            visited,
            remainingAfterMove
          )
        : chooseMoveFlee(cur, opponentPos, gridSize, obstacleSet, visited);

    if (!next) break;
    path.push(next);
    visited.add(toKey(next));
    cur = next;
  }

  return path;
};
