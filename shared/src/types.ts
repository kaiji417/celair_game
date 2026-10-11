// チーム
export interface Team {
  id: string;
  name: string;
  points: number;
  hasDevice?: boolean; // 端末が紐付いているか（getStateで付与。1チーム1端末）
}

// チーム参加の結果
export type JoinTeamResult =
  | { ok: true; team: Team; token: string }
  | { ok: false; reason: 'taken' | 'closed' | 'invalid' };

// クイズの選択肢
export interface QuizOption {
  id: string;
  text: string;
}

// クイズ（2択/4択の単一選択のみ）
export interface Quiz {
  id: string;
  question: string;
  options: QuizOption[];
  // 正解の選択肢。クイズ作成時に登録する（正解発表時には選ばせない）。
  // 参加者・ディスプレイには正解発表まで送らない
  correctOptionId?: string;
  prizePool: number;             // このラウンドの配分総額（正解チームで山分け）
  status: 'waiting' | 'answering' | 'closed' | 'revealed';
  // 最終問題フラグ。出題時に FINAL 予告が入り、この問題からランキング・得点・投票内訳を自動で伏せる
  isLastQuiz?: boolean;
}

// 回答（選んだ選択肢のみ。賭け金の概念はない）
export interface Answer {
  teamId: string;
  quizId: string;
  optionId: string;
}

// ---- 最終結果発表（司会のペースで1段ずつ進める）----
// intro:    「最終結果発表」タイトル
// lower:    4位以下をまとめて発表
// podium:   3位・2位を1順位ずつ発表（同点なら複数チーム）
// champion: 優勝チームだけを発表（余韻を残す）
// ranking:  全順位
export type FinalStageKind = 'intro' | 'lower' | 'podium' | 'champion' | 'ranking';

export interface FinalTeam {
  id: string;
  name: string;
  points: number;
  rank: number;
}

export interface FinalStage {
  kind: FinalStageKind;
  rank?: number;      // podium のときの順位
  teams: FinalTeam[]; // 未発表の段は参加者・ディスプレイには空で送る
}

export interface FinalRevealState {
  step: number;        // stages[0..step] が発表済み
  stages: FinalStage[];
}

// ゲーム状態
export interface GameState {
  teams: Team[];
  quizzes: Quiz[];
  currentQuizIndex: number;
  answers: Answer[];
  phase: 'lobby' | 'playing' | 'finished';
  // ランキング・得点・投票内訳を伏せている状態か（サーバーが算出。手動の切り替えはない）。
  // 最終問題を出題した時点から、最終結果発表が終わるまで true
  rankingHidden: boolean;
  teamSlots: string[]; // 事前登録チーム名リスト
  finalReveal?: FinalRevealState | null;
}

/**
 * 誰がどれに投票したかを伏せるか。伏せている状態（＝最終問題以降）は回答の内訳を出さない。
 * 内訳と正解が分かると、正解チーム数や得点の動きが推測できてしまうため。
 */
export function isVoteHidden(state: Pick<GameState, 'rankingHidden'>, _quiz?: unknown): boolean {
  return !!state.rankingHidden;
}

// 1チームの結果
export interface AnswerResult {
  teamId: string;
  teamName: string;
  optionId?: string;    // 選んだ選択肢（無回答はundefined）
  won: boolean;         // 正解したか
  received: number;     // 山分けで受け取った額（正解チームのみ >0）
  delta: number;        // 増減（= received。減点はないので常に >= 0）
  newPoints: number;
}

// 正解発表の結果ペイロード（サーバー→クライアント）
export interface RevealAnswerResult {
  correctOptionId?: string;
  prizePool: number;    // このラウンドの配分総額
  perWinner: number;    // 正解1チームあたりの山分け額
  winnerCount: number;
  results: AnswerResult[];
  noWinner: boolean;    // 正解チームがゼロ（誰も貰えない）
  // ランキング非表示中の発表。正解チーム数・獲得額・他チームの結果は伏せて送る
  // （results は受け取った端末のチーム分だけ、received / newPoints は 0）
  hidden?: boolean;
}

// 正解発表のペイロード（管理者→サーバー）
export interface RevealAnswerPayload {
  correctOptionId?: string;
}

// Socket.IO イベント
export interface ServerToClientEvents {
  gameState: (state: GameState) => void;
  quizStarted: (quiz: Quiz) => void;
  answersClosed: () => void;
  resultRevealed: (result: RevealAnswerResult) => void;
  rankingUpdate: (teams: Team[]) => void;
  error: (message: string) => void;
  showQrCode: (url: string) => void;
  hideQrCode: () => void;
  sessionId: (id: string) => void;
  showResults: () => void;
  hideResults: () => void;
  adminError: (message: string) => void;
  // この端末のチーム紐付けが外された（管理者操作・チーム削除）
  deviceReleased: () => void;
}

export interface ClientToServerEvents {
  joinTeam: (payload: { teamName: string; token?: string }, callback: (result: JoinTeamResult) => void) => void;
  // teamIdはsocketではなくtokenから解決する（再接続でsocketが変わっても回答できるように）
  submitAnswer: (answer: Omit<Answer, 'teamId'> & { token: string }, callback: (success: boolean) => void) => void;
  // ロビー中のみ。端末の紐付けを外してチームを選び直す
  leaveTeam: (token: string) => void;
}

export interface AdminToServerEvents {
  startQuiz: (quizIndex: number) => void;
  closeAnswers: () => void;
  revealAnswer: (payload: RevealAnswerPayload) => void;
  resetGame: () => void;
  fullReset: () => void;
  updateQuizzes: (quizzes: Quiz[]) => void;
  removeTeam: (teamId: string) => void;
  showQrCode: (url: string) => void;
  hideQrCode: () => void;
  // 最終結果発表を開始 / 次の段へ進める
  finalRevealNext: () => void;
  adjustPoints: (teamId: string, delta: number) => void;
  resetAnswer: (teamId: string) => void;
  releaseDevice: (teamId: string) => void;
  setTeamSlots: (slots: string[]) => void;
  showResults: () => void;
}
