import crypto from 'crypto';

/**
 * 管理者認証。
 * トークンはパスワードから HMAC で導出するので、サーバー再起動後も同じトークンが有効
 * （本番中にサーバーが落ちても管理画面がログアウトされない）。パスワードを変えると無効になる。
 */
export function createAdminAuth(password: string) {
  const token = crypto.createHmac('sha256', password).update('celiar-admin-v1').digest('hex');

  const safeEqual = (a: string, b: string) => {
    const ba = Buffer.from(a);
    const bb = Buffer.from(b);
    return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
  };

  return {
    checkPassword: (input: unknown) => typeof input === 'string' && safeEqual(input, password),
    checkToken: (input: unknown) => typeof input === 'string' && safeEqual(input, token),
    token,
  };
}

/**
 * ログイン試行回数の制限（総当たり対策）。
 * 同一IPから windowMs 内に maxFailures 回失敗したらロックする。
 */
export function createLoginLimiter(maxFailures = 10, windowMs = 10 * 60 * 1000) {
  const failures = new Map<string, { count: number; since: number }>();

  return {
    isLocked(ip: string): boolean {
      const f = failures.get(ip);
      if (!f) return false;
      if (Date.now() - f.since > windowMs) {
        failures.delete(ip);
        return false;
      }
      return f.count >= maxFailures;
    },
    fail(ip: string): void {
      const f = failures.get(ip);
      if (!f || Date.now() - f.since > windowMs) {
        failures.set(ip, { count: 1, since: Date.now() });
      } else {
        f.count += 1;
      }
    },
    succeed(ip: string): void {
      failures.delete(ip);
    },
  };
}
