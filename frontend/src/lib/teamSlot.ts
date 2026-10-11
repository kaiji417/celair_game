/**
 * チームスロットの表示番号を生成する。
 * 参加者画面・管理者画面で同じ番号が出るよう共通化している。
 * @param index 0始まりのスロット位置
 */
export function formatSlotNumber(index: number): string {
  return String(index + 1).padStart(2, '0');
}
