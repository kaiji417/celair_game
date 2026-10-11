import { useEffect } from 'react';

/**
 * 画面を点けたままにする（スマホのスリープで回線が切れるのを防ぐ）。
 * Wake Lock API 非対応のブラウザでは何もしない。
 * タブを離れると OS 側で解除されるので、戻ってきたら取り直す。
 */
export function useWakeLock(enabled: boolean): void {
  useEffect(() => {
    if (!enabled || !('wakeLock' in navigator)) return;

    let lock: WakeLockSentinel | null = null;
    let cancelled = false;

    const request = async () => {
      try {
        const next = await navigator.wakeLock.request('screen');
        if (cancelled) { next.release().catch(() => {}); return; }
        lock = next;
      } catch {
        // 省電力モード等で拒否されることがある。ゲーム自体は続けられるので無視する
      }
    };

    const onVisible = () => {
      if (document.visibilityState === 'visible') request();
    };

    request();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      lock?.release().catch(() => {});
    };
  }, [enabled]);
}
