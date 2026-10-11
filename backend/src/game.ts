import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type {
  Team, Quiz, Answer, GameState, AnswerResult, RevealAnswerResult, JoinTeamResult, FinalRevealState,
} from '@ce-liar-game/shared';
import { buildFinalStages } from './finalReveal';

const STARTING_POINTS = 0;
const MAX_TEAM_NAME_LENGTH = 30;
// サーバー運用時は永続ディスクのパスを STATE_FILE で指定する
const SAVE_FILE = process.env.STATE_FILE || path.join(__dirname, '../../game-state.json');

export class GameManager {
  private teams: Map<string, Team> = new Map();
  private quizzes: Quiz[] = [];
  private currentQuizIndex = -1;
  private answers: Answer[] = [];
  private phase: GameState['phase'] = 'lobby';
  private finalReveal: FinalRevealState | null = null;
  private sessionId: string = uuidv4();
  private teamSlots: string[] = [];
  // teamId -> 端末トークン（1チーム1端末）。クライアントには送らない
  private teamTokens: Map<string, string> = new Map();

  /**
   * チームに参加する（1チーム1端末）。
   * - 自分のトークンを持っていれば同じチームに復帰（再接続・再読み込み）
   * - 端末が外れているチームなら新しい端末を紐付ける
   * - 別の端末が使っているチームには入れない
   * - 新規チーム作成はロビー中のみ
   */
  joinTeam(rawName: string, token?: string): JoinTeamResult {
    const name = (rawName ?? '').trim();
    if (!name || name.length > MAX_TEAM_NAME_LENGTH) return { ok: false, reason: 'invalid' };

    const existing = Array.from(this.teams.values()).find(
      (t) => t.name.toLowerCase() === name.toLowerCase()
    );

    if (existing) {
      const bound = this.teamTokens.get(existing.id);
      if (bound && token && this.tokenEquals(bound, token)) {
        return { ok: true, team: this.withDevice(existing), token: bound };
      }
      if (bound) return { ok: false, reason: 'taken' };
      const newToken = this.issueToken();
      this.teamTokens.set(existing.id, newToken);
      this.save();
      return { ok: true, team: this.withDevice(existing), token: newToken };
    }

    // ゲーム開始後は新規チーム作成を禁止（ロビーで確定）
    if (this.phase !== 'lobby') return { ok: false, reason: 'closed' };
    // チーム名リストがある場合はリスト外の名前を受け付けない（公開サーバーでの荒らし対策）
    if (this.teamSlots.length > 0 && !this.teamSlots.includes(name)) {
      return { ok: false, reason: 'invalid' };
    }

    const team: Team = { id: uuidv4(), name, points: STARTING_POINTS };
    this.teams.set(team.id, team);
    const newToken = this.issueToken();
    this.teamTokens.set(team.id, newToken);
    this.save();
    return { ok: true, team: this.withDevice(team), token: newToken };
  }

  /** トークンからチームIDを引く（無効ならnull） */
  resolveToken(token: string | undefined): string | null {
    if (!token) return null;
    for (const [teamId, t] of this.teamTokens) {
      if (this.tokenEquals(t, token)) return teamId;
    }
    return null;
  }

  /** ロビー中に参加者自身がチームを抜ける（チーム選び直し用）。チームごと削除する */
  leaveTeam(token: string): boolean {
    if (this.phase !== 'lobby') return false;
    const teamId = this.resolveToken(token);
    if (!teamId) return false;
    return this.removeTeam(teamId);
  }

  /** 管理者が端末の紐付けを外す（スマホの電池切れ・端末交換時） */
  releaseDevice(teamId: string): boolean {
    if (!this.teamTokens.has(teamId)) return false;
    this.teamTokens.delete(teamId);
    this.save();
    return true;
  }

  private issueToken(): string {
    return crypto.randomBytes(24).toString('hex');
  }

  private tokenEquals(a: string, b: string): boolean {
    const ba = Buffer.from(a);
    const bb = Buffer.from(b);
    return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
  }

  private withDevice(team: Team): Team {
    return { ...team, hasDevice: this.teamTokens.has(team.id) };
  }

  /**
   * クイズ一覧を更新する。
   * 出題済み（waiting以外）のクイズは内容・状態ともサーバー側を正とし、削除も許さない。
   * 進行中に編集しても status が waiting に戻って二重配当されないようにするため。
   */
  setQuizzes(quizzes: Quiz[]): { ok: true } | { ok: false; message: string } {
    const incomingIds = new Set(quizzes.map((q) => q.id).filter(Boolean));
    const lockedMissing = this.quizzes.find((q) => q.status !== 'waiting' && !incomingIds.has(q.id));
    if (lockedMissing) {
      return { ok: false, message: '出題済みのクイズは削除できません' };
    }

    const currentId = this.quizzes[this.currentQuizIndex]?.id;
    this.quizzes = quizzes.map((q) => {
      const existing = this.quizzes.find((e) => e.id === q.id);
      if (existing && existing.status !== 'waiting') return existing;
      return {
        ...q,
        id: q.id || uuidv4(),
        prizePool: q.prizePool ?? 1000,
        status: 'waiting' as const,
        // 正解は作成時に登録する。選択肢に存在しないIDは未設定扱い（出題前に弾く）
        correctOptionId: q.options?.some((o) => o.id === q.correctOptionId) ? q.correctOptionId : undefined,
      };
    });
    // 並び替え・削除で配列位置がずれても、進行中のクイズを指し続ける
    this.currentQuizIndex = currentId ? this.quizzes.findIndex((q) => q.id === currentId) : -1;
    this.save();
    return { ok: true };
  }

  /** 出題する。未出題のクイズのみ、かつ前の問題が受付中/締め切りのまま残っていないこと */
  startQuiz(index: number): { ok: true } | { ok: false; message: string } {
    const quiz = this.quizzes[index];
    if (!quiz) return { ok: false, message: 'クイズが見つかりません' };
    if (quiz.status !== 'waiting') return { ok: false, message: 'このクイズは出題済みです' };
    if (!quiz.options.some((o) => o.id === quiz.correctOptionId)) {
      return { ok: false, message: 'このクイズは正解が設定されていません。編集して正解を選んでください' };
    }
    if (this.finalReveal) return { ok: false, message: '最終結果発表を始めた後は出題できません（ゲームリセットで戻せます）' };
    const current = this.quizzes[this.currentQuizIndex];
    if (current && (current.status === 'answering' || current.status === 'closed')) {
      return { ok: false, message: '現在のクイズの正解発表を先に行ってください' };
    }
    this.currentQuizIndex = index;
    this.phase = 'playing';
    quiz.status = 'answering';
    this.answers = this.answers.filter((a) => a.quizId !== quiz.id);
    this.save();
    return { ok: true };
  }

  closeAnswers(): boolean {
    const quiz = this.quizzes[this.currentQuizIndex];
    if (!quiz || quiz.status !== 'answering') return false;
    quiz.status = 'closed';
    this.save();
    return true;
  }

  /**
   * 回答を登録する。
   * 締め切り前なら選び直しを許可する（誤タップの救済 + 迷って変える余地を残す）。
   * 締め切り後は一切受け付けない。
   */
  submitAnswer(answer: Answer): boolean {
    const quiz = this.quizzes[this.currentQuizIndex];
    if (!quiz || quiz.status !== 'answering') return false;
    // 前の問題の画面から遅れて届いた送信を、今の問題の回答として扱わない
    if (answer.quizId !== quiz.id) return false;

    const team = this.teams.get(answer.teamId);
    if (!team) return false;

    // optionId が有効な選択肢か確認
    const option = quiz.options.find((o) => o.id === answer.optionId);
    if (!option) return false;

    const existing = this.answers.find(
      (a) => a.teamId === answer.teamId && a.quizId === quiz.id
    );

    if (existing) {
      // 同じ選択肢なら何もしない（二重送信）
      if (existing.optionId === answer.optionId) return true;
      existing.optionId = answer.optionId;
    } else {
      this.answers.push({ teamId: answer.teamId, quizId: quiz.id, optionId: answer.optionId });
    }

    this.save();
    return true;
  }

  /**
   * 正解発表・ポイント計算（銀行配当型）
   * 1. 正解チームを判定（無回答=不正解）
   * 2. 正解者ゼロなら誰も貰えない（noWinner）。配分総額は消える
   * 3. 山分け額 = floor(prizePool / 正解チーム数)、端数は切り捨て消滅
   * 4. 正解チームに加算。外したチームは増減なし（減点なし）
   */
  /**
   * 正解はクイズ作成時に登録したものを使う（本番中に選び間違える事故を防ぐ）。
   * payload は互換のために受け取るが、正解の指定には使わない
   */
  revealAnswer(_payload: { correctOptionId?: string } = {}): RevealAnswerResult | null {
    const quiz = this.quizzes[this.currentQuizIndex];
    // 締め切り済みの問題に対して1回だけ。二重送信で配当が2回入るのを防ぐ
    if (!quiz || quiz.status !== 'closed') return null;
    if (!quiz.options.some((o) => o.id === quiz.correctOptionId)) return null;

    quiz.status = 'revealed';

    const prizePool = quiz.prizePool;

    // 全チームを対象にする（回答していない=無回答も不正解として扱う）
    const judged = Array.from(this.teams.values()).map((team) => {
      const answer = this.answers.find((a) => a.teamId === team.id && a.quizId === quiz.id);
      const won = !!answer && answer.optionId === quiz.correctOptionId;
      return { team, answer, won };
    });

    const winners = judged.filter((j) => j.won);
    const noWinner = winners.length === 0;

    // 山分け額（正解者がいれば均等・端数切り捨て）
    const perWinner = noWinner ? 0 : Math.floor(prizePool / winners.length);

    const results: AnswerResult[] = [];
    for (const j of judged) {
      const received = j.won ? perWinner : 0;
      if (received > 0) j.team.points += received; // 外したチームは増減なし
      results.push({
        teamId: j.team.id,
        teamName: j.team.name,
        optionId: j.answer?.optionId,
        won: j.won,
        received,
        delta: received,
        newPoints: j.team.points,
      });
    }

    this.save();
    return {
      correctOptionId: quiz.correctOptionId,
      prizePool,
      perWinner,
      winnerCount: winners.length,
      results,
      noWinner,
    };
  }

  setTeamSlots(slots: string[]): void {
    this.teamSlots = slots.filter((s) => s.trim() !== '');
    this.save();
  }

  getSessionId(): string {
    return this.sessionId;
  }

  getState(): GameState {
    return {
      teams: Array.from(this.teams.values()).map((t) => this.withDevice(t)),
      quizzes: this.quizzes,
      currentQuizIndex: this.currentQuizIndex,
      answers: this.answers,
      phase: this.phase,
      rankingHidden: this.isHidden(),
      teamSlots: this.teamSlots,
      finalReveal: this.finalReveal,
    };
  }

  /**
   * ランキング・得点・投票内訳を伏せる状態か。手動の切り替えはなく、最終問題フラグから決まる。
   *   最終問題を出題した時点から（受付中・締め切り・発表後も）最終結果発表が終わるまで伏せる
   */
  isHidden(): boolean {
    if (this.finalReveal) return true;
    return this.quizzes.some((q) => q.isLastQuiz && q.status !== 'waiting');
  }

  /**
   * 最終結果発表を1段進める（初回は段取りを組んで intro を出す）。
   * 発表中に得点が変わっても順位がぶれないよう、開始時点の順位で固定する。
   */
  advanceFinalReveal(): { ok: true } | { ok: false; message: string } {
    if (!this.finalReveal) {
      if (!this.quizzes.some((q) => q.status === 'revealed')) {
        return { ok: false, message: 'まだ1問も正解発表していません' };
      }
      const current = this.quizzes[this.currentQuizIndex];
      if (current && (current.status === 'answering' || current.status === 'closed')) {
        return { ok: false, message: '現在の問題の正解発表を先に行ってください' };
      }
      if (!this.quizzes.some((q) => q.isLastQuiz && q.status === 'revealed')) {
        return { ok: false, message: '最終問題の正解発表がまだです' };
      }
      this.finalReveal = {
        step: 0,
        stages: buildFinalStages(Array.from(this.teams.values())),
      };
      this.phase = 'finished';
      this.save();
      return { ok: true };
    }
    if (this.finalReveal.step >= this.finalReveal.stages.length - 1) {
      return { ok: false, message: '最終結果はすべて発表済みです' };
    }
    this.finalReveal.step += 1;
    this.save();
    return { ok: true };
  }

  removeTeam(teamId: string): boolean {
    if (!this.teams.has(teamId)) return false;
    this.teams.delete(teamId);
    this.teamTokens.delete(teamId);
    this.answers = this.answers.filter((a) => a.teamId !== teamId);
    this.save();
    return true;
  }

  // ポイント直接操作（管理者リカバリー）
  adjustPoints(teamId: string, delta: number): boolean {
    const team = this.teams.get(teamId);
    if (!team) return false;
    if (!Number.isFinite(delta) || !Number.isInteger(delta)) return false;
    team.points = Math.max(0, team.points + delta);
    this.save();
    return true;
  }

  // 回答差し戻し（管理者リカバリー）
  resetAnswer(teamId: string): boolean {
    const quiz = this.quizzes[this.currentQuizIndex];
    if (!quiz || quiz.status !== 'answering') return false;
    const before = this.answers.length;
    this.answers = this.answers.filter((a) => !(a.teamId === teamId && a.quizId === quiz.id));
    if (this.answers.length === before) return false;
    this.save();
    return true;
  }

  reset(): void {
    // セッションが変わると参加者側はチーム名・トークンを捨てるので、紐付けも外す
    this.teamTokens = new Map();
    this.teams.forEach((team) => {
      team.points = STARTING_POINTS;
    });
    this.quizzes = this.quizzes.map((q) => ({
      ...q,
      status: 'waiting' as const,
    }));
    this.currentQuizIndex = -1;
    this.answers = [];
    this.phase = 'lobby';
    this.finalReveal = null;
    this.sessionId = uuidv4();
    this.save();
  }

  // チームも含めて完全リセット
  fullReset(): void {
    this.teams = new Map();
    this.teamTokens = new Map();
    this.quizzes = this.quizzes.map((q) => ({
      ...q,
      status: 'waiting' as const,
    }));
    this.currentQuizIndex = -1;
    this.answers = [];
    this.phase = 'lobby';
    this.finalReveal = null;
    this.sessionId = uuidv4();
    this.save();
  }

  save(): void {
    try {
      const data = {
        teams: Array.from(this.teams.entries()),
        quizzes: this.quizzes,
        currentQuizIndex: this.currentQuizIndex,
        answers: this.answers,
        phase: this.phase,
        finalReveal: this.finalReveal,
        sessionId: this.sessionId,
        teamSlots: this.teamSlots,
        teamTokens: Array.from(this.teamTokens.entries()),
      };
      // 書き込み途中で落ちてもファイルが壊れないよう、一時ファイル経由で置き換える
      const tmp = `${SAVE_FILE}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(data), 'utf-8');
      fs.renameSync(tmp, SAVE_FILE);
    } catch (e) {
      console.error('Failed to save game state:', e);
    }
  }

  /**
   * 保存データが現行フォーマットかを判定する。
   * 旧フォーマット（ペリカ争奪戦由来: perica / bets / 'betting'）を読み込むと
   * points が undefined のチームが復元され、画面にNaNが出るため破棄する。
   */
  private isCurrentFormat(data: any): boolean {
    if (!data || !Array.isArray(data.teams)) return false;
    if (!Array.isArray(data.answers)) return false;
    // teams は [id, Team][] のエントリ配列
    return data.teams.every(
      (entry: unknown) =>
        Array.isArray(entry) &&
        entry.length === 2 &&
        typeof (entry[1] as Team)?.points === 'number'
    );
  }

  load(): boolean {
    try {
      if (!fs.existsSync(SAVE_FILE)) return false;
      const raw = fs.readFileSync(SAVE_FILE, 'utf-8');
      const data = JSON.parse(raw);

      if (!this.isCurrentFormat(data)) {
        console.warn(
          'Saved state is in an outdated format and was discarded. Starting from a clean state.'
        );
        return false;
      }

      this.teams = new Map(data.teams);
      this.quizzes = (data.quizzes as Quiz[]).map((q) => ({
        ...q,
        prizePool: q.prizePool ?? 1000,
      }));
      this.currentQuizIndex = data.currentQuizIndex;
      this.answers = data.answers;
      this.phase = data.phase;
      this.finalReveal = data.finalReveal ?? null;
      this.sessionId = data.sessionId || uuidv4();
      this.teamSlots = data.teamSlots || [];
      this.teamTokens = new Map(data.teamTokens || []);
      console.log(`Game state restored: ${this.teams.size} teams, ${this.quizzes.length} quizzes`);
      return true;
    } catch (e) {
      console.error('Failed to load game state:', e);
      return false;
    }
  }
}
