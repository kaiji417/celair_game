import { describe, it, vi } from 'vitest';
import * as fc from 'fast-check';
import { GameManager } from '../game';
import type { Quiz, Team, RevealAnswerResult } from '@ce-liar-game/shared';
import { v4 as uuidv4 } from 'uuid';

// save/loadのファイルI/Oをモックして純粋なロジックテストにする
vi.mock('fs', () => ({
  default: {
    existsSync: () => false,
    writeFileSync: () => {},
    renameSync: () => {},
    readFileSync: () => '',
  },
}));

// ---- ヘルパー ----

/** GameManagerにクイズをセットしてanswering状態にする */
function setupQuiz(manager: GameManager, quiz: Quiz): void {
  (manager as any).quizzes = [{ ...quiz, status: 'answering' }];
  (manager as any).currentQuizIndex = 0;
  // 正解発表は締め切り後のみ受け付けるので、テストでは発表直前に自動で締め切る
  // 正解はクイズ作成時に登録する仕様なので、テストでは発表直前に正解を書き込んでから発表する
  const original = manager.revealAnswer.bind(manager);
  (manager as any).revealAnswer = (payload: { correctOptionId?: string }): RevealAnswerResult => {
    manager.closeAnswers();
    (manager as any).quizzes[0].correctOptionId = payload.correctOptionId;
    const res = original();
    if (!res) throw new Error('revealAnswer was rejected');
    return res;
  };
}

// setupQuiz 済みの manager は revealAnswer が必ず結果を返す
type SetupManager = GameManager & { revealAnswer: (p: { correctOptionId?: string }) => RevealAnswerResult };

/** チームを直接登録する（addTeamはsaveを呼ぶので内部マップに直接セット） */
function addTeamDirect(manager: GameManager, team: Team): void {
  (manager as any).teams.set(team.id, { ...team });
}

const optionArb = fc.record({ id: fc.uuid(), text: fc.string({ minLength: 1, maxLength: 20 }) });

// ---- テスト ----

describe('銀行配当型 配分計算プロパティテスト', () => {
  /**
   * Property 1: 山分けは均等・端数切り捨て。
   * 正解者がいれば perWinner = floor(prizePool / winnerCount)、
   * 配分総額のうち perWinner*winnerCount のみが分配され、端数は消える（誰にも渡らない）。
   */
  it('Property 1: perWinner = floor(配分総額 / 正解チーム数)、端数は消滅', () => {
    fc.assert(
      fc.property(
        fc.array(optionArb, { minLength: 2, maxLength: 4 }),
        fc.array(
          fc.record({
            id: fc.uuid(),
            name: fc.string({ minLength: 1, maxLength: 10 }),
            correct: fc.boolean(),
          }),
          { minLength: 2, maxLength: 12 },
        ),
        fc.integer({ min: 100, max: 10000 }),
        (options, teamSpecs, prizePool) => {
          const manager = new GameManager() as SetupManager;
          const correctId = options[0].id;
          const wrongId = options[1].id;

          const quiz: Quiz = { id: uuidv4(), question: 'Q', options, prizePool, status: 'answering' };
          setupQuiz(manager, quiz);

          // 全チーム0スタート
          const teams: Team[] = teamSpecs.map((s) => ({ id: s.id, name: s.name, points: 0 }));
          teams.forEach((t) => addTeamDirect(manager, t));
          teamSpecs.forEach((s) => {
            manager.submitAnswer({ teamId: s.id, quizId: quiz.id, optionId: s.correct ? correctId : wrongId });
          });

          const res = manager.revealAnswer({ correctOptionId: correctId });
          const winnerCount = teamSpecs.filter((s) => s.correct).length;

          expect(res.winnerCount).toBe(winnerCount);
          if (winnerCount === 0) {
            expect(res.noWinner).toBe(true);
            expect(res.perWinner).toBe(0);
          } else {
            expect(res.perWinner).toBe(Math.floor(prizePool / winnerCount));
            // 分配総額は配分総額以下（端数分だけ少ない）
            const distributed = res.perWinner * winnerCount;
            expect(distributed).toBeLessThanOrEqual(prizePool);
            expect(prizePool - distributed).toBeLessThan(winnerCount);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * Property 2: 外したチームは増減なし（減点は一切ない）。正解チームのみ加算。
   */
  it('Property 2: 外したチームは増減なし、正解チームのみ加算', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 50000 }), // 各チームの現在ポイント（累積想定）
        fc.integer({ min: 100, max: 10000 }),
        (startingPoints, prizePool) => {
          const manager = new GameManager() as SetupManager;
          const options = [{ id: uuidv4(), text: 'A' }, { id: uuidv4(), text: 'B' }];
          const quiz: Quiz = { id: uuidv4(), question: 'Q', options, prizePool, status: 'answering' };
          setupQuiz(manager, quiz);

          const winner: Team = { id: uuidv4(), name: 'W', points: startingPoints };
          const loser: Team = { id: uuidv4(), name: 'L', points: startingPoints };
          addTeamDirect(manager, winner);
          addTeamDirect(manager, loser);
          manager.submitAnswer({ teamId: winner.id, quizId: quiz.id, optionId: options[0].id });
          manager.submitAnswer({ teamId: loser.id, quizId: quiz.id, optionId: options[1].id });

          const res = manager.revealAnswer({ correctOptionId: options[0].id });
          const state = manager.getState();

          // 正解者1名なので独占
          expect(res.perWinner).toBe(prizePool);
          expect(state.teams.find((t) => t.id === winner.id)!.points).toBe(startingPoints + prizePool);
          // 外したチームは不変
          expect(state.teams.find((t) => t.id === loser.id)!.points).toBe(startingPoints);
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * Property 3: 1チーム独占なら配分総額を総取り
   */
  it('Property 3: 1チームだけ正解なら総取り', () => {
    const manager = new GameManager() as SetupManager;
    const options = [{ id: uuidv4(), text: 'A' }, { id: uuidv4(), text: 'B' }];
    const quiz: Quiz = { id: uuidv4(), question: 'Q', options, prizePool: 27000, status: 'answering' };
    setupQuiz(manager, quiz);

    const winner: Team = { id: uuidv4(), name: 'W', points: 0 };
    addTeamDirect(manager, winner);
    for (let i = 0; i < 8; i++) {
      const l: Team = { id: uuidv4(), name: `L${i}`, points: 0 };
      addTeamDirect(manager, l);
      manager.submitAnswer({ teamId: l.id, quizId: quiz.id, optionId: options[1].id });
    }
    manager.submitAnswer({ teamId: winner.id, quizId: quiz.id, optionId: options[0].id });

    const res = manager.revealAnswer({ correctOptionId: options[0].id });
    expect(res.winnerCount).toBe(1);
    expect(res.perWinner).toBe(27000);
    expect(manager.getState().teams.find((t) => t.id === winner.id)!.points).toBe(27000);
  });

  /**
   * Property 4: 正解者ゼロ（全員不正解・無回答含む）なら誰も増えない
   */
  it('Property 4: 正解者ゼロなら誰も増えない', () => {
    const manager = new GameManager() as SetupManager;
    const options = [{ id: uuidv4(), text: 'A' }, { id: uuidv4(), text: 'B' }];
    const quiz: Quiz = { id: uuidv4(), question: 'Q', options, prizePool: 5000, status: 'answering' };
    setupQuiz(manager, quiz);

    const t1: Team = { id: uuidv4(), name: 'T1', points: 3000 };
    const t2: Team = { id: uuidv4(), name: 'T2', points: 1000 };
    addTeamDirect(manager, t1);
    addTeamDirect(manager, t2);
    // t1は不正解、t2は無回答
    manager.submitAnswer({ teamId: t1.id, quizId: quiz.id, optionId: options[1].id });

    const res = manager.revealAnswer({ correctOptionId: options[0].id });
    expect(res.noWinner).toBe(true);
    expect(manager.getState().teams.find((t) => t.id === t1.id)!.points).toBe(3000);
    expect(manager.getState().teams.find((t) => t.id === t2.id)!.points).toBe(1000);
  });

  /**
   * Property 5: 全員正解なら配分総額を全員で山分け（薄くなる）
   */
  it('Property 5: 全員正解なら均等に薄く分配', () => {
    const manager = new GameManager() as SetupManager;
    const options = [{ id: uuidv4(), text: 'A' }, { id: uuidv4(), text: 'B' }];
    const quiz: Quiz = { id: uuidv4(), question: 'Q', options, prizePool: 2000, status: 'answering' };
    setupQuiz(manager, quiz);

    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      const t: Team = { id: uuidv4(), name: `T${i}`, points: 0 };
      ids.push(t.id);
      addTeamDirect(manager, t);
      manager.submitAnswer({ teamId: t.id, quizId: quiz.id, optionId: options[0].id });
    }

    const res = manager.revealAnswer({ correctOptionId: options[0].id });
    expect(res.winnerCount).toBe(4);
    expect(res.perWinner).toBe(500); // 2000 / 4
    ids.forEach((id) => {
      expect(manager.getState().teams.find((t) => t.id === id)!.points).toBe(500);
    });
  });

  /**
   * Property 7: 締め切り前は選び直せる。最後に選んだ回答だけが有効。
   */
  it('Property 7: 締め切り前の選び直しは最後の回答が有効', () => {
    const manager = new GameManager() as SetupManager;
    const options = [{ id: uuidv4(), text: 'A' }, { id: uuidv4(), text: 'B' }];
    const quiz: Quiz = { id: uuidv4(), question: 'Q', options, prizePool: 3000, status: 'answering' };
    setupQuiz(manager, quiz);

    const t: Team = { id: uuidv4(), name: 'T', points: 0 };
    addTeamDirect(manager, t);

    // 不正解を選んだあと正解に変更する
    expect(manager.submitAnswer({ teamId: t.id, quizId: quiz.id, optionId: options[1].id })).toBe(true);
    expect(manager.submitAnswer({ teamId: t.id, quizId: quiz.id, optionId: options[0].id })).toBe(true);

    // 回答は増えず1件のまま
    expect(manager.getState().answers.filter((a) => a.teamId === t.id).length).toBe(1);

    const res = manager.revealAnswer({ correctOptionId: options[0].id });
    expect(res.winnerCount).toBe(1);
    expect(manager.getState().teams.find((x) => x.id === t.id)!.points).toBe(3000);
  });

  /**
   * Property 8: 締め切り後は選び直せない
   */
  it('Property 8: 締め切り後は回答を受け付けない', () => {
    const manager = new GameManager() as SetupManager;
    const options = [{ id: uuidv4(), text: 'A' }, { id: uuidv4(), text: 'B' }];
    const quiz: Quiz = { id: uuidv4(), question: 'Q', options, prizePool: 1000, status: 'answering' };
    setupQuiz(manager, quiz);

    const t: Team = { id: uuidv4(), name: 'T', points: 0 };
    addTeamDirect(manager, t);
    manager.submitAnswer({ teamId: t.id, quizId: quiz.id, optionId: options[1].id });

    manager.closeAnswers();

    // 締め切り後の変更は拒否され、元の回答（不正解）が残る
    expect(manager.submitAnswer({ teamId: t.id, quizId: quiz.id, optionId: options[0].id })).toBe(false);

    const res = manager.revealAnswer({ correctOptionId: options[0].id });
    expect(res.noWinner).toBe(true);
    expect(manager.getState().teams.find((x) => x.id === t.id)!.points).toBe(0);
  });

  /**
   * Property 6: 無回答チームは不正解扱い（貰えないだけ、減点なし）
   */
  it('Property 6: 無回答チームは貰えないが減点もされない', () => {
    const manager = new GameManager() as SetupManager;
    const options = [{ id: uuidv4(), text: 'A' }, { id: uuidv4(), text: 'B' }];
    const quiz: Quiz = { id: uuidv4(), question: 'Q', options, prizePool: 1000, status: 'answering' };
    setupQuiz(manager, quiz);

    const winner: Team = { id: uuidv4(), name: 'W', points: 500 };
    const silent: Team = { id: uuidv4(), name: 'S', points: 500 };
    addTeamDirect(manager, winner);
    addTeamDirect(manager, silent);
    manager.submitAnswer({ teamId: winner.id, quizId: quiz.id, optionId: options[0].id });

    const res = manager.revealAnswer({ correctOptionId: options[0].id });
    expect(res.winnerCount).toBe(1);
    expect(manager.getState().teams.find((t) => t.id === winner.id)!.points).toBe(1500);
    expect(manager.getState().teams.find((t) => t.id === silent.id)!.points).toBe(500);
  });
});
