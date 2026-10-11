import { describe, it, expect } from 'vitest';
import { calcRankMovement } from '../../../frontend/src/lib/ranking';

type R = { teamId: string; teamName: string; won: boolean; received: number; delta: number; newPoints: number; optionId?: string };

const row = (teamId: string, prev: number, received: number): R => ({
  teamId,
  teamName: teamId,
  won: received > 0,
  received,
  delta: received,
  newPoints: prev + received,
});

describe('calcRankMovement', () => {
  it('少数正解で下位チームが首位に上がる', () => {
    const res = [row('A', 3000, 0), row('B', 2000, 0), row('C', 500, 5000)];
    const m = calcRankMovement(res);
    expect(m.get('C')).toMatchObject({ prevRank: 3, newRank: 1, delta: 2 });
    expect(m.get('A')).toMatchObject({ prevRank: 1, newRank: 2, delta: -1 });
    expect(m.get('B')).toMatchObject({ prevRank: 2, newRank: 3, delta: -1 });
  });

  it('同点は同順位（1,1,3）', () => {
    const res = [row('A', 1000, 0), row('B', 1000, 0), row('C', 0, 0)];
    const m = calcRankMovement(res);
    expect(m.get('A')!.newRank).toBe(1);
    expect(m.get('B')!.newRank).toBe(1);
    expect(m.get('C')!.newRank).toBe(3);
  });

  it('全員0点スタートは全員1位から始まる', () => {
    const res = [row('A', 0, 500), row('B', 0, 500), row('C', 0, 0)];
    const m = calcRankMovement(res);
    expect(m.get('A')).toMatchObject({ prevRank: 1, newRank: 1, delta: 0 });
    expect(m.get('C')).toMatchObject({ prevRank: 1, newRank: 3, delta: -2 });
  });

  it('発表前の得点を newPoints - received で正しく復元する', () => {
    const m = calcRankMovement([row('A', 1200, 800)]);
    expect(m.get('A')).toMatchObject({ prevPoints: 1200, newPoints: 2000 });
  });
});
