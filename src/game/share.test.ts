import { describe, expect, it } from 'vitest';
import { shareText, xShareUrl } from './share';

describe('share', () => {
  it('describes a cleared run with formatted score and kills', () => {
    expect(shareText({ score: 123456, kills: 42, completed: true })).toBe('TRACE EFFECTを突破！\nSCORE 123,456 / 撃破 42');
  });

  it('describes a failed run as a challenge', () => {
    expect(shareText({ score: 800, kills: 3, completed: false })).toContain('TRACE EFFECTに挑戦！');
  });

  it('builds an X intent URL with text, page url and hashtag', () => {
    const url = new URL(xShareUrl({ score: 1500, kills: 7, completed: true }, 'https://trace-effect.trace-effect.workers.dev/'));
    expect(url.origin + url.pathname).toBe('https://x.com/intent/tweet');
    expect(url.searchParams.get('text')).toContain('SCORE 1,500');
    expect(url.searchParams.get('url')).toBe('https://trace-effect.trace-effect.workers.dev/');
    expect(url.searchParams.get('hashtags')).toBe('TraceEffect');
  });
});
