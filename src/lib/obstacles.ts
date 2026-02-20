export type Coord = [number, number];

type GenerateObstaclesParams = {
  gridSize: number;
  chaserPos: Coord;
  runnerPos: Coord;
  obstacleCount: number;
  seed: number;
};

const manhattan = (a: [number, number], b: [number, number]) =>
  Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);

const coordKey = ([x, y]: Coord) => `${x},${y}`;

// mulberry32 PRNG
const mulberry32 = (seed: number) => {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
};

const hashStringToSeed = (value: string) => {
  // FNV-1a 32-bit
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

const weightedPickIndex = (
  candidates: Coord[],
  midpoint: [number, number],
  rand: () => number
) => {
  const weights = candidates.map((tile) => 1 / (1 + manhattan(tile, midpoint)));
  const total = weights.reduce((acc, w) => acc + w, 0);
  if (total <= 0) return -1;
  let r = rand() * total;
  for (let i = 0; i < candidates.length; i += 1) {
    r -= weights[i];
    if (r <= 0) return i;
  }
  return candidates.length - 1;
};

export const isReachable = (
  chaserPos: Coord,
  runnerPos: Coord,
  obstacles: Set<string>,
  gridSize: number
) => {
  const startKey = coordKey(chaserPos);
  const goalKey = coordKey(runnerPos);
  if (obstacles.has(startKey) || obstacles.has(goalKey)) return false;

  const visited = new Set<string>([startKey]);
  const queue: Coord[] = [chaserPos];
  const dirs: Coord[] = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1]
  ];

  while (queue.length > 0) {
    const [x, y] = queue.shift() as Coord;
    if (x === runnerPos[0] && y === runnerPos[1]) return true;

    for (const [dx, dy] of dirs) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || nx >= gridSize || ny < 0 || ny >= gridSize) continue;
      const k = `${nx},${ny}`;
      if (visited.has(k) || obstacles.has(k)) continue;
      visited.add(k);
      queue.push([nx, ny]);
    }
  }
  return false;
};

export const generateObstacles = ({
  gridSize,
  chaserPos,
  runnerPos,
  obstacleCount,
  seed
}: GenerateObstaclesParams): Set<string> => {
  const MAX_TRIES = 50;
  const midpoint: [number, number] = [
    (chaserPos[0] + runnerPos[0]) / 2,
    (chaserPos[1] + runnerPos[1]) / 2
  ];
  const pieceKeys = new Set([coordKey(chaserPos), coordKey(runnerPos)]);

  let desired = Math.max(0, Math.min(6, obstacleCount));
  while (desired >= 0) {
    for (let attempt = 0; attempt < MAX_TRIES; attempt += 1) {
      const rand = mulberry32(seed ^ (desired << 16) ^ attempt);
      const candidates: Coord[] = [];

      for (let x = 0; x < gridSize; x += 1) {
        for (let y = 0; y < gridSize; y += 1) {
          const key = `${x},${y}`;
          if (pieceKeys.has(key)) continue;
          // spawn protection
          if (manhattan([x, y], chaserPos) <= 1) continue;
          if (manhattan([x, y], runnerPos) <= 1) continue;
          // midpoint ring r <= 2
          const d = manhattan([x, y], midpoint);
          if (d > 2) continue;
          candidates.push([x, y]);
        }
      }

      candidates.sort((a, b) => manhattan(a, midpoint) - manhattan(b, midpoint));
      if (desired > candidates.length) continue;

      const remaining = [...candidates];
      const selected = new Set<string>();
      for (let i = 0; i < desired; i += 1) {
        const idx = weightedPickIndex(remaining, midpoint, rand);
        if (idx < 0) break;
        const tile = remaining[idx];
        selected.add(coordKey(tile));
        remaining.splice(idx, 1);
      }
      if (selected.size !== desired) continue;

      if (isReachable(chaserPos, runnerPos, selected, gridSize)) {
        if (desired !== obstacleCount) {
          console.warn(
            `[obstacles] fallback used: requested=${obstacleCount}, generated=${desired}, attempt=${attempt + 1}`
          );
        }
        return selected;
      }
    }
    desired -= 1;
  }

  console.warn(
    `[obstacles] generation failed completely: requested=${obstacleCount}, seed=${seed}`
  );
  return new Set<string>();
};

export const seedForMatchRound = (matchId: string, roundNumber: number) =>
  hashStringToSeed(`${matchId}:${roundNumber}`);

