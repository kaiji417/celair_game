import { describe, it, expect, vi } from 'vitest';
import { buildFinalStages, sanitizeFinalReveal } from '../finalReveal';
import { GameManager } from '../game';
import type { Team } from '@ce-liar-game/shared';

vi.mock('fs', () => ({
  default: { existsSync: () => false, writeFileSync: () => {}, renameSync: () => {}, readFileSync: () => '' },
}));

const t = (id: string, points: number): Team => ({ id, name: id, points });

describe('最終結果発表の段取り', () => {
  it('10チーム: intro → 4位以下 → 3位 → 2位 → 優勝 → 全順位', () => {
    const teams = Array.from({ length: 10 }, (_, i) => t(`T${i}`, (10 - i) * 100));
    const stages = buildFinalStages(teams);
    expect(stages.map((s) => s.kind + (s.rank ?? ''))).toEqual(['intro', 'lower', 'podium3', 'podium2', 'champion', 'ranking']);
    expect(stages[1].teams).toHaveLength(7);
  });

  it('同点は同じ段に入る（3位と4位が同点なら両方3位）', () => {
    const stages = buildFinalStages([t('A', 900), t('B', 800), t('C', 500), t('D', 500), t('E', 100)]);
    const third = stages.find((s) => s.kind === 'podium' && s.rank === 3)!;
    expect(third.teams.map((x) => x.id).sort()).toEqual(['C', 'D']);
    expect(stages.find((s) => s.kind === 'lower')!.teams.map((x) => x.rank)).toEqual([5]);
  });

  it('1位が同点なら2位の段はなく、3位の次に優勝', () => {
    const stages = buildFinalStages([t('A', 900), t('B', 900), t('C', 100)]);
    expect(stages.map((s) => s.kind + (s.rank ?? ''))).toEqual(['intro', 'podium3', 'champion', 'ranking']);
  });

  it('2チームなら 2位 → 優勝', () => {
    const stages = buildFinalStages([t('A', 900), t('B', 100)]);
    expect(stages.map((s) => s.kind + (s.rank ?? ''))).toEqual(['intro', 'podium2', 'champion', 'ranking']);
  });

  it('参加者向けには未発表の段を空にする', () => {
    const stages = buildFinalStages([t('Z', 900), t('A', 800), t('C', 100)]);
    const safe = sanitizeFinalReveal({ step: 1, stages })!;
    expect(safe.stages[1].teams).toHaveLength(1);
    expect(safe.stages.slice(2).every((s) => s.teams.length === 0)).toBe(true);
  });
});

describe('チーム数が変わっても段取りが崩れない', () => {
  it('1〜20チーム・同点ありでも、1位以外は優勝発表の前にちょうど1回ずつ出る', () => {
    for (let n = 1; n <= 20; n++) {
      for (const tieEvery of [0, 2, 3]) {
        const teams = Array.from({ length: n }, (_, i) =>
          t(`T${i}`, tieEvery ? Math.floor(i / tieEvery) * -100 + 5000 : (n - i) * 100),
        );
        const stages = buildFinalStages(teams);
        expect(stages[0].kind).toBe('intro');
        expect(stages.at(-1)!.kind).toBe('ranking');
        expect(stages.at(-2)!.kind).toBe('champion');
        expect(stages.at(-1)!.teams).toHaveLength(n);

        const shown = stages.filter((s) => s.kind === 'lower' || s.kind === 'podium').flatMap((s) => s.teams.map((x) => x.id));
        const champions = stages.at(-2)!.teams.map((x) => x.id);
        expect(stages.at(-2)!.teams.every((x) => x.rank === 1)).toBe(true);
        expect(new Set(shown).size).toBe(shown.length);
        expect(shown.length + champions.length).toBe(n);
        for (const id of champions) expect(shown.includes(id)).toBe(false);
      }
    }
  });
});

describe('最終結果発表の進行', () => {
  it('条件を満たすまで始められず、最後の段より先には進まない', () => {
    const m = new GameManager();
    const opts = [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }];
    m.setQuizzes([
      { id: 'q', question: 'Q', options: opts, correctOptionId: 'a', prizePool: 1000, status: 'waiting' },
      { id: 'f', question: 'FINAL', options: opts, correctOptionId: 'a', prizePool: 10000, status: 'waiting', isLastQuiz: true },
    ]);
    m.joinTeam('A');
    m.joinTeam('B');
    expect(m.advanceFinalReveal().ok).toBe(false); // 未発表
    m.startQuiz(0);
    m.closeAnswers();
    m.revealAnswer({ correctOptionId: 'a' });
    expect(m.advanceFinalReveal().ok).toBe(false); // 最終問題がまだ
    m.startQuiz(1);
    expect(m.getState().rankingHidden).toBe(true); // 最終問題を出した時点で自動的に伏せる
    m.closeAnswers();
    m.revealAnswer({ correctOptionId: 'a' });
    expect(m.advanceFinalReveal().ok).toBe(true);
    const total = m.getState().finalReveal!.stages.length;
    for (let i = 1; i < total; i++) expect(m.advanceFinalReveal().ok).toBe(true);
    expect(m.advanceFinalReveal().ok).toBe(false);
    m.reset();
    expect(m.getState().finalReveal).toBeNull();
    expect(m.getState().rankingHidden).toBe(false); // リセットで最終問題が未出題に戻るので公開に戻る
  });
});
