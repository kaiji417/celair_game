export * from './types';
import type { GameState } from './types';

/**
 * GameStateをJSON文字列にシリアライズする。
 * GameStateの全フィールドはプレーンなオブジェクト/配列なので
 * JSON.stringifyで直接変換可能。
 */
export function serializeGameState(state: GameState): string {
  return JSON.stringify(state);
}

/**
 * JSON文字列をGameStateにデシリアライズする。
 * パース後のオブジェクトをGameStateとして返す。
 */
export function deserializeGameState(json: string): GameState {
  const parsed = JSON.parse(json) as GameState;
  return parsed;
}
