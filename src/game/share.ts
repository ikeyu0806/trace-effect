export interface ShareResult {
  score: number;
  kills: number;
  completed: boolean;
}

export const SHARE_HASHTAG = 'TraceEffect';

export function shareText(result: ShareResult): string {
  const score = result.score.toLocaleString('en-US');
  const outcome = result.completed ? 'TRACE EFFECTを突破！' : 'TRACE EFFECTに挑戦！';
  return `${outcome}\nSCORE ${score} / 撃破 ${result.kills}`;
}

/** X（旧Twitter）の投稿画面をスコア入りの文面で開くURL。 */
export function xShareUrl(result: ShareResult, pageUrl: string): string {
  const params = new URLSearchParams({ text: shareText(result), url: pageUrl, hashtags: SHARE_HASHTAG });
  return `https://x.com/intent/tweet?${params.toString()}`;
}
