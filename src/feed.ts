export interface ResetEvent { id: string; reset_type: string; announced_at: string; text?: string; source: {type: string; author: string; url: string}; }
export function verifiedEvents(payload: unknown, now = Date.now()): ResetEvent[] {
  if (!payload || typeof payload !== 'object') return [];
  const p = payload as any;
  if (p.stale === true || p.is_prediction === true || !Array.isArray(p.data)) return [];
  return p.data.filter((e: any) => {
    if (!e || typeof e.id !== 'string' || !/^[\w-]{1,128}$/.test(e.id) || e.stale === true || e.is_prediction === true) return false;
    if (!['regular', 'full', 'global'].includes(e.reset_type) || /\bbanked\b/i.test(e.text || '')) return false;
    if (e.source?.type !== 'x_post' || e.source?.author !== 'thsottiaux') return false;
    try {
      const u = new URL(e.source.url);
      if (u.protocol !== 'https:' || !['x.com','twitter.com'].includes(u.hostname) || !/^\/thsottiaux\/status\/\d+\/?$/.test(u.pathname)) return false;
    } catch { return false; }
    const t = Date.parse(e.announced_at);
    return typeof e.announced_at === 'string' && Number.isFinite(t) && t <= now;
  }).sort((a: ResetEvent, b: ResetEvent) => Date.parse(a.announced_at) - Date.parse(b.announced_at));
}
