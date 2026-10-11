import type { FinalStage, FinalTeam, FinalRevealState, Team } from '@ce-liar-game/shared';

/**
 * 最終結果発表の段取りを組む。司会が1段ずつ進める。
 *
 *   intro → lower(4位以下まとめて) → 3位 → 2位 → champion(1位のみ) → ranking(全順位)
 *
 * - 順位は標準方式（同点は同順位: 1,1,3...）。区切りは順位単位なので同点チームが分かれない
 * - 該当チームがいない段は作らない（チーム数が少ない・同点で順位が飛ぶ場合）
 */
export function buildFinalStages(teams: Team[]): FinalStage[] {
  const sorted = teams.slice().sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
  const ranked: FinalTeam[] = [];
  sorted.forEach((t, i) => {
    const rank = i > 0 && t.points === sorted[i - 1].points ? ranked[i - 1].rank : i + 1;
    ranked.push({ id: t.id, name: t.name, points: t.points, rank });
  });

  const stages: FinalStage[] = [{ kind: 'intro', teams: [] }];

  const lower = ranked.filter((t) => t.rank >= 4);
  if (lower.length > 0) stages.push({ kind: 'lower', teams: lower });

  for (const rank of [3, 2]) {
    const teamsAtRank = ranked.filter((t) => t.rank === rank);
    if (teamsAtRank.length > 0) stages.push({ kind: 'podium', rank, teams: teamsAtRank });
  }

  stages.push({ kind: 'champion', teams: ranked.filter((t) => t.rank === 1) });
  stages.push({ kind: 'ranking', teams: ranked });
  return stages;
}

/** 参加者・ディスプレイに送る用。未発表の段は中身を空にする */
export function sanitizeFinalReveal(state: FinalRevealState | null | undefined): FinalRevealState | null {
  if (!state) return null;
  return {
    step: state.step,
    stages: state.stages.map((s, i) => (i > state.step ? { kind: s.kind, rank: s.rank, teams: [] } : s)),
  };
}
