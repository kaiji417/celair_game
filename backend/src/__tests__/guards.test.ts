import { describe, it, expect, vi } from 'vitest';
import { GameManager } from '../game';
import type { Quiz } from '@ce-liar-game/shared';

vi.mock('fs', () => ({
  default: {
    existsSync: () => false,
    writeFileSync: () => {},
    renameSync: () => {},
    readFileSync: () => '',
  },
}));

function makeQuiz(id: string, prizePool = 1000): Quiz {
  return {
    id,
    question: `Q-${id}`,
    options: [{ id: `${id}-a`, text: 'A' }, { id: `${id}-b`, text: 'B' }],
    correctOptionId: `${id}-a`, // 正解は作成時に登録する
    prizePool,
    status: 'waiting',
  };
}

function setup() {
  const m = new GameManager();
  m.setQuizzes([makeQuiz('q1'), makeQuiz('q2'), makeQuiz('q3')]);
  const a = m.joinTeam('Alpha');
  const b = m.joinTeam('Bravo');
  if (!a.ok || !b.ok) throw new Error('join failed');
  return { m, a, b };
}

describe('1チーム1端末 / 再接続', () => {
  it('同じトークンなら同じチームに復帰できる', () => {
    const { m, a } = setup();
    const again = m.joinTeam('alpha', a.token);
    expect(again.ok && again.team.id).toBe(a.team.id);
  });

  it('別の端末（トークンなし・別トークン）は使用中のチームに入れない', () => {
    const { m, a, b } = setup();
    expect(m.joinTeam('Alpha')).toEqual({ ok: false, reason: 'taken' });
    expect(m.joinTeam('Alpha', b.token)).toEqual({ ok: false, reason: 'taken' });
    expect(m.resolveToken(a.token)).toBe(a.team.id);
  });

  it('端末を外すと別の端末で入れ、古いトークンは無効になる', () => {
    const { m, a } = setup();
    m.releaseDevice(a.team.id);
    expect(m.resolveToken(a.token)).toBeNull();
    const next = m.joinTeam('Alpha');
    expect(next.ok && next.team.id).toBe(a.team.id);
  });

  it('ゲーム開始後は新しいチームを作れない', () => {
    const { m } = setup();
    m.startQuiz(0);
    expect(m.joinTeam('Charlie')).toEqual({ ok: false, reason: 'closed' });
  });

  it('チーム名リストがあればリスト外の名前は拒否', () => {
    const m = new GameManager();
    m.setTeamSlots(['Alpha']);
    expect(m.joinTeam('Hacker')).toEqual({ ok: false, reason: 'invalid' });
    expect(m.joinTeam('Alpha').ok).toBe(true);
  });
});

describe('状態遷移ガード', () => {
  it('正解発表は締め切り後に1回だけ（二重配当しない）', () => {
    const { m, a } = setup();
    m.startQuiz(0);
    m.submitAnswer({ teamId: a.team.id, quizId: 'q1', optionId: 'q1-a' });
    expect(m.revealAnswer({ correctOptionId: 'q1-a' })).toBeNull(); // 締め切り前
    m.closeAnswers();
    expect(m.revealAnswer({ correctOptionId: 'q1-a' })).not.toBeNull();
    expect(m.revealAnswer({ correctOptionId: 'q1-a' })).toBeNull(); // 2回目
    expect(m.getState().teams.find((t) => t.id === a.team.id)!.points).toBe(1000);
  });

  it('正解は作成時に登録したものが使われ、発表時の指定では変えられない', () => {
    const { m, a, b } = setup();
    m.startQuiz(0);
    m.submitAnswer({ teamId: a.team.id, quizId: 'q1', optionId: 'q1-a' }); // 登録済みの正解
    m.submitAnswer({ teamId: b.team.id, quizId: 'q1', optionId: 'q1-b' });
    m.closeAnswers();
    const res = m.revealAnswer({ correctOptionId: 'q1-b' })!; // 違う選択肢を渡しても無視される
    expect(res.correctOptionId).toBe('q1-a');
    expect(res.results.find((r) => r.teamId === a.team.id)!.won).toBe(true);
    expect(res.results.find((r) => r.teamId === b.team.id)!.won).toBe(false);
  });

  it('正解が未設定のクイズは出題できない', () => {
    const m = new GameManager();
    const q = makeQuiz('x');
    m.setQuizzes([{ ...q, correctOptionId: undefined }]);
    expect(m.startQuiz(0).ok).toBe(false);
    // 存在しない選択肢を正解にしても未設定扱い
    m.setQuizzes([{ ...q, correctOptionId: 'nope' }]);
    expect(m.startQuiz(0).ok).toBe(false);
  });

  it('リセットしても正解は消えない', () => {
    const { m } = setup();
    m.reset();
    expect(m.getState().quizzes[0].correctOptionId).toBe('q1-a');
    m.fullReset();
    expect(m.getState().quizzes[0].correctOptionId).toBe('q1-a');
  });

  it('発表済みのクイズは再開できない', () => {
    const { m } = setup();
    m.startQuiz(0);
    m.closeAnswers();
    m.revealAnswer({ correctOptionId: 'q1-a' });
    expect(m.startQuiz(0).ok).toBe(false);
  });

  it('前の問題が未発表のまま次を開始できない', () => {
    const { m } = setup();
    m.startQuiz(0);
    expect(m.startQuiz(1).ok).toBe(false);
    m.closeAnswers();
    expect(m.startQuiz(1).ok).toBe(false);
  });

  it('前の問題IDで届いた回答は受け付けない', () => {
    const { m, a } = setup();
    m.startQuiz(0);
    m.closeAnswers();
    m.revealAnswer({ correctOptionId: 'q1-a' });
    m.startQuiz(1);
    expect(m.submitAnswer({ teamId: a.team.id, quizId: 'q1', optionId: 'q2-a' })).toBe(false);
  });
});

describe('進行中のクイズ編集', () => {
  it('編集しても出題済みクイズの状態は保持される', () => {
    const { m } = setup();
    m.startQuiz(0);
    m.closeAnswers();
    m.revealAnswer({ correctOptionId: 'q1-a' });

    // 管理画面から古い状態（waiting）で送られてきても上書きされない
    const edited = m.getState().quizzes.map((q) => ({ ...q, status: 'waiting' as const }));
    edited.push(makeQuiz('q4'));
    expect(m.setQuizzes(edited).ok).toBe(true);

    const state = m.getState();
    expect(state.quizzes[0].status).toBe('revealed');
    expect(state.quizzes[0].correctOptionId).toBe('q1-a');
    expect(state.quizzes).toHaveLength(4);
  });

  it('出題済みクイズは削除できない', () => {
    const { m } = setup();
    m.startQuiz(0);
    const without = m.getState().quizzes.filter((q) => q.id !== 'q1');
    expect(m.setQuizzes(without).ok).toBe(false);
    expect(m.getState().quizzes).toHaveLength(3);
  });

  it('未出題クイズを削除しても進行中クイズを指し続ける', () => {
    const { m } = setup();
    m.startQuiz(1);
    const without = m.getState().quizzes.filter((q) => q.id !== 'q1');
    expect(m.setQuizzes(without).ok).toBe(true);
    const state = m.getState();
    expect(state.quizzes[state.currentQuizIndex].id).toBe('q2');
    expect(state.quizzes[state.currentQuizIndex].status).toBe('answering');
  });
});

describe('ポイント調整', () => {
  it('0未満にはならない・整数以外は拒否', () => {
    const { m, a } = setup();
    m.adjustPoints(a.team.id, -500);
    expect(m.getState().teams.find((t) => t.id === a.team.id)!.points).toBe(0);
    expect(m.adjustPoints(a.team.id, 1.5)).toBe(false);
  });
});
