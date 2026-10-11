import type { AnswerResult } from '../hooks/useSocket';

export type RankMovement = {
  prevRank: number;
  newRank: number;
  /** 正の値で順位が上がった（例: 5位→2位 なら +3） */
  delta: number;
  prevPoints: number;
  newPoints: number;
};

/** 同点は同順位（1,1,3...）。自分より厳密に高い得点のチーム数 + 1 */
function rankOf(points: number, all: number[]): number {
  return all.filter((p) => p > points).length + 1;
}

/**
 * 正解発表の結果から、各チームの順位変動を求める。
 * results は全チーム分が入っている（無回答チームも含む）ので、
 * 発表前の得点は newPoints - received で復元できる。
 */
export function calcRankMovement(results: AnswerResult[]): Map<string, RankMovement> {
  const prev = results.map((r) => r.newPoints - r.received);
  const next = results.map((r) => r.newPoints);

  const map = new Map<string, RankMovement>();
  results.forEach((r, i) => {
    const prevRank = rankOf(prev[i], prev);
    const newRank = rankOf(next[i], next);
    map.set(r.teamId, {
      prevRank,
      newRank,
      delta: prevRank - newRank,
      prevPoints: prev[i],
      newPoints: next[i],
    });
  });
  return map;
}
