import { describe, it } from 'vitest';
import * as fc from 'fast-check';
import { serializeGameState, deserializeGameState } from '@ce-liar-game/shared';
import type { GameState, Quiz, Team, Answer } from '@ce-liar-game/shared';

// ---- Arbitraries ----

const teamArb = fc.record<Team>({
  id: fc.uuid(),
  name: fc.string({ minLength: 1, maxLength: 20 }),
  points: fc.integer({ min: 0, max: 100000 }),
});

const quizOptionArb = fc.record({
  id: fc.uuid(),
  text: fc.string({ minLength: 1, maxLength: 50 }),
});

const quizStatusArb = fc.constantFrom(
  'waiting' as const,
  'answering' as const,
  'closed' as const,
  'revealed' as const,
);

const quizArb: fc.Arbitrary<Quiz> = fc.record({
  id: fc.uuid(),
  question: fc.string({ minLength: 1, maxLength: 100 }),
  options: fc.array(quizOptionArb, { minLength: 2, maxLength: 4 }),
  correctOptionId: fc.option(fc.uuid(), { nil: undefined }),
  prizePool: fc.integer({ min: 100, max: 10000 }),
  status: quizStatusArb,
  isLastQuiz: fc.option(fc.boolean(), { nil: undefined }),
});

const answerArb = (teamIds: string[], quizIds: string[]): fc.Arbitrary<Answer> => {
  const teamId = teamIds.length > 0 ? fc.constantFrom(...teamIds) : fc.uuid();
  const quizId = quizIds.length > 0 ? fc.constantFrom(...quizIds) : fc.uuid();
  return fc.record<Answer>({
    teamId,
    quizId,
    optionId: fc.uuid(),
  });
};

const gameStateArb: fc.Arbitrary<GameState> = fc
  .tuple(
    fc.array(teamArb, { minLength: 0, maxLength: 5 }),
    fc.array(quizArb, { minLength: 0, maxLength: 5 }),
  )
  .chain(([teams, quizzes]) => {
    const teamIds = teams.map((t) => t.id);
    const quizIds = quizzes.map((q) => q.id);
    return fc.record<GameState>({
      teams: fc.constant(teams),
      quizzes: fc.constant(quizzes),
      currentQuizIndex: fc.integer({ min: -1, max: Math.max(0, quizzes.length - 1) }),
      answers: fc.array(answerArb(teamIds, quizIds), { minLength: 0, maxLength: 10 }),
      phase: fc.constantFrom('lobby' as const, 'playing' as const, 'finished' as const),
      rankingHidden: fc.boolean(),
      teamSlots: fc.array(fc.string({ minLength: 1, maxLength: 10 }), { minLength: 0, maxLength: 5 }),
    });
  });

// ---- Property Test ----

describe('GameState serialization', () => {
  /**
   * Property: GameStateシリアライズのラウンドトリップ
   * 任意の有効なGameStateに対して、
   * deserializeGameState(serializeGameState(state)) は元のstateと一致する。
   */
  it('round-trip serialize→deserialize preserves GameState', () => {
    fc.assert(
      fc.property(gameStateArb, (state) => {
        const serialized = serializeGameState(state);
        const restored = deserializeGameState(serialized);
        expect(restored).toEqual(state);
      }),
      { numRuns: 100 },
    );
  });
});
