import { DurableObject } from 'cloudflare:workers';
import { verifiedEvents, type ResetEvent } from './feed';
import type { Env } from './index';
type Round = {id:string; started_at:string; hit_count:number; source_url:string};
export class ResetRaidDO extends DurableObject<Env> {
  private rate = new Map<string, {time:number; requests:number}>();
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS rounds (
      id TEXT PRIMARY KEY, source_event_id TEXT UNIQUE, source_type TEXT NOT NULL,
      source_url TEXT, source_text TEXT, started_at TEXT NOT NULL, ended_at TEXT,
      hit_count INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE UNIQUE INDEX IF NOT EXISTS one_open_round ON rounds(status) WHERE status = 'open';
      CREATE TABLE IF NOT EXISTS participants (round_id TEXT NOT NULL, visitor_hash TEXT NOT NULL,
      hit_count INTEGER NOT NULL DEFAULT 0, first_hit_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_hit_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(round_id,visitor_hash));
      CREATE INDEX IF NOT EXISTS participants_round_idx ON participants(round_id);
      CREATE TABLE IF NOT EXISTS hit_batches (batch_id TEXT PRIMARY KEY, round_id TEXT NOT NULL,
      visitor_hash TEXT NOT NULL, hit_count INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE INDEX IF NOT EXISTS hit_batches_round_idx ON hit_batches(round_id);`);
  }
  private current() { return this.ctx.storage.sql.exec<Round>("SELECT * FROM rounds WHERE status='open' LIMIT 1").toArray()[0]; }
  private state() {
    const r = this.current();
    if (!r) return null;
    const fans = this.ctx.storage.sql.exec<{n:number}>('SELECT COUNT(*) n FROM participants WHERE round_id=?',r.id).one().n;
    return {roundId:r.id, fans, hits:r.hit_count, lastResetAt:r.started_at, sourceUrl:r.source_url, hpDecayK:Number(this.env.HP_DECAY_K)||5000, updatedAt:new Date().toISOString()};
  }
  private transition(e: ResetEvent) {
    const r = this.current();
    if (this.ctx.storage.sql.exec('SELECT id FROM rounds WHERE source_event_id=?',e.id).toArray().length) return false;
    if (r && Date.parse(e.announced_at) <= Date.parse(r.started_at)) return false;
    this.ctx.storage.transactionSync(() => {
      if (r) this.ctx.storage.sql.exec("UPDATE rounds SET status='closed',ended_at=? WHERE id=?",e.announced_at,r.id);
      this.ctx.storage.sql.exec("INSERT INTO rounds (id,source_event_id,source_type,source_url,source_text,started_at) VALUES (?,?,?,?,?,?)",e.id,e.id,e.reset_type,e.source.url,e.text||'',e.announced_at);
    });
    return true;
  }
  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === '/state') return this.state() ? Response.json(this.state()) : Response.json({error:'awaiting_verified_reset'}, {status:503});
    if (path === '/sync') {
      const events = verifiedEvents(await request.json());
      let changed = false;
      // Bootstrap only the newest verified event, never manufacture a round.
      if (!this.current() && events.length) changed = this.transition(events[events.length-1]);
      else for (const e of events) changed = this.transition(e) || changed;
      return Response.json({changed,state:this.state()});
    }
    if (path !== '/hit') return new Response('Not found',{status:404});
    const b = await request.json() as {roundId:string;visitorHash:string;batchId:string;hits:number};
    return this.ctx.storage.transactionSync(() => {
      const r = this.current();
      if (!r) return Response.json({error:'awaiting_verified_reset'}, {status:503});
      if (b.roundId !== r.id) return Response.json({error:'round_changed', ...this.state()}, {status:409});
      const duplicate = this.ctx.storage.sql.exec<{visitor_hash:string;round_id:string;hit_count:number}>('SELECT * FROM hit_batches WHERE batch_id=?',b.batchId).toArray()[0];
      if (duplicate) {
        if (duplicate.visitor_hash !== b.visitorHash || duplicate.round_id !== b.roundId || duplicate.hit_count !== b.hits) return Response.json({error:'batch_conflict'}, {status:409});
        return Response.json({...this.state(),joined:false,duplicateBatch:true});
      }
      const now = Date.now();
      const rate = this.rate.get(b.visitorHash);
      if (rate && now-rate.time < 60000 && rate.requests >= 120) return Response.json({error:'rate_limited'},{status:429,headers:{'Retry-After':'5'}});
      if (!rate || now-rate.time >= 60000) {
        if (this.rate.size >= 10000) for (const [key,v] of this.rate) if(now-v.time>=60000) this.rate.delete(key);
        if (this.rate.size >= 10000) return Response.json({error:'rate_limited'},{status:429});
        this.rate.set(b.visitorHash,{time:now,requests:1});
      } else rate.requests++;
      if (!Number.isSafeInteger(r.hit_count+b.hits)) return Response.json({error:'counter_capacity'}, {status:503});
      const joined = !this.ctx.storage.sql.exec('SELECT 1 FROM participants WHERE round_id=? AND visitor_hash=?',r.id,b.visitorHash).toArray().length;
      this.ctx.storage.sql.exec('INSERT OR IGNORE INTO participants (round_id,visitor_hash) VALUES (?,?)',r.id,b.visitorHash);
      this.ctx.storage.sql.exec('UPDATE participants SET hit_count=hit_count+?,last_hit_at=CURRENT_TIMESTAMP WHERE round_id=? AND visitor_hash=?',b.hits,r.id,b.visitorHash);
      this.ctx.storage.sql.exec('UPDATE rounds SET hit_count=hit_count+? WHERE id=?',b.hits,r.id);
      this.ctx.storage.sql.exec('INSERT INTO hit_batches(batch_id,round_id,visitor_hash,hit_count) VALUES (?,?,?,?)',b.batchId,r.id,b.visitorHash,b.hits);
      return Response.json({...this.state(),joined});
    });
  }
}
