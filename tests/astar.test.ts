import { describe, expect, it } from 'vitest';
import { findPath } from '@/world/astar';
import { distanceField } from '@/world/bfs';
import { FLOOR, Grid, WALL } from '@/world/grid';

function fromRows(rows: string[]): Grid {
  const g = new Grid(rows[0]!.length, rows.length, WALL);
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] === '.') g.set(x, y, FLOOR);
  });
  return g;
}

describe('A*', () => {
  it('finds a path through a maze with BFS-optimal length (4-dir maze)', () => {
    const g = fromRows(['#########', '#...#...#', '#.#.#.#.#', '#.#...#.#', '#.#####.#', '#.......#', '#########']);
    const path = findPath(g, 1, 1, 7, 1);
    expect(path).not.toBeNull();
    expect(path![path!.length - 1]).toEqual([7, 1]);
    // every step is adjacent and walkable
    let px = 1;
    let py = 1;
    for (const [x, y] of path!) {
      expect(Math.max(Math.abs(x - px), Math.abs(y - py))).toBe(1);
      expect(g.isSolid(x, y)).toBe(false);
      px = x;
      py = y;
    }
    const d = distanceField(g, 1, 1);
    expect(path!.length).toBeLessThanOrEqual(d[1 * 9 + 7]!);
  });
  it('returns null when blocked', () => {
    const g = fromRows(['#######', '#..#..#', '#..#..#', '#######']);
    expect(findPath(g, 1, 1, 5, 1)).toBeNull();
  });
  it('does not cut corners', () => {
    const g = fromRows(['#####', '#..##', '#.#.#', '##..#', '#####']);
    // from (1,1) to (3,3): diagonal through (2,2) is a wall corner; must go around... which is impossible here
    const p = findPath(g, 1, 1, 3, 3);
    expect(p).toBeNull();
    const g2 = fromRows(['#####', '#...#', '#...#', '#...#', '#####']);
    const p2 = findPath(g2, 1, 1, 3, 3);
    expect(p2).not.toBeNull();
    expect(p2!.length).toBe(2); // two diagonal steps
  });
  it('start equals goal gives empty path', () => {
    const g = fromRows(['###', '#.#', '###']);
    expect(findPath(g, 1, 1, 1, 1)).toEqual([]);
  });
});
