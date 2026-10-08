import {env, SELF, runInDurableObject} from 'cloudflare:test';
import {describe,it,expect,vi} from 'vitest';
import {verifiedEvents} from '../src/feed';
import {syncFeed} from '../src/index';
import type {Env} from '../src/index';
const E=env as Env;
const event=(id='test-reset',announced_at='2026-10-01T00:00:00Z')=>({id,reset_type:'regular',announced_at,text:'Reset all propagated.',source:{type:'x_post',author:'thsottiaux',url:'https://x.com/thsottiaux/status/2107676072871600470'}});
const doStub=()=>E.RAID.get(E.RAID.idFromName('global'));
const sync=async(data:any,rest={})=>{const r=await doStub().fetch('https://raid/sync',{method:'POST',body:JSON.stringify({data,...rest})});return r.json() as Promise<any>};
const hit=async(roundId:string,visitorId=crypto.randomUUID(),hits=10,batchId=crypto.randomUUID())=>SELF.fetch('https://example.com/api/hit',{method:'POST',headers:{Origin:'https://example.com','Content-Type':'application/json'},body:JSON.stringify({roundId,visitorId,hits,batchId})});
describe('conservative feed validation',()=>{
 it('accepts regular/full/global and filters banked, prediction, unknown, malformed and future',()=>{
  for(const type of ['regular','full','global'])expect(verifiedEvents({data:[{...event(),reset_type:type}]})).toHaveLength(1);
  for(const type of ['banked','automatic','unknown'])expect(verifiedEvents({data:[{...event(),reset_type:type}]})).toHaveLength(0);
  for(const extra of [{is_prediction:true},{stale:true},{text:'A full banked reset'},{source:{type:'observed'}},{announced_at:'garbage'},{announced_at:'2099-01-01T00:00:00Z'}])expect(verifiedEvents({data:[{...event(),...extra}]})).toHaveLength(0);
  for(const p of [null,{}, {stale:true,data:[event()]},{is_prediction:true,data:[event()]},{data:[null,{}]}])expect(verifiedEvents(p)).toHaveLength(0);
 });
});
describe('persistent global raid',()=>{
 it('initializes newest reset with truthful zero counts',async()=>{
  const p=await sync([event('older','2026-09-01T00:00:00Z'),event()]);
  expect(p.state).toMatchObject({roundId:'test-reset',fans:0,hits:0,lastResetAt:'2026-10-01T00:00:00Z'});
 });
 it('counts distinct fans and deduplicates retry, preserves hashes only',async()=>{
  await sync([event()]);const visitor=crypto.randomUUID(),batch=crypto.randomUUID();
  let r=await hit('test-reset',visitor,12,batch);expect(r.status).toBe(200);const p=await r.json() as any;expect(p.joined).toBe(true);
  r=await hit('test-reset',visitor,12,batch);expect(await r.json()).toMatchObject({hits:p.hits,fans:p.fans,duplicateBatch:true});
  r=await hit('test-reset',visitor,3);expect(await r.json()).toMatchObject({hits:p.hits+3,fans:p.fans,joined:false});
  const stub=doStub();await runInDurableObject(stub,async(_instance:any,state:any)=>{const rows=state.storage.sql.exec('SELECT visitor_hash FROM participants').toArray();expect(rows.every((v:any)=>/^[a-f0-9]{64}$/.test(v.visitor_hash))).toBe(true);});
 });
 it('rejects >50, invalid visitor, fractional, zero, cross-origin and oversized body',async()=>{
  for(const n of [51,0,-1,1.5])expect((await hit('test-reset',crypto.randomUUID(),n)).status).toBe(400);
  expect((await hit('test-reset','invalid')).status).toBe(400);
  expect((await SELF.fetch('https://example.com/api/hit',{method:'POST',headers:{Origin:'https://other.com'},body:'{}'})).status).toBe(403);
  expect((await SELF.fetch('https://example.com/api/hit',{method:'POST',headers:{Origin:'https://example.com'},body:' '.repeat(2050)})).status).toBe(413);
 });
 it('atomically sums concurrent +10 and +10',async()=>{
  const r=await doStub().fetch('https://raid/state');const p=await r.json() as any;
  await Promise.all([hit(p.roundId),hit(p.roundId)]);
  const s=await (await doStub().fetch('https://raid/state')).json() as any;expect(s.hits).toBe(p.hits+20);expect(s.fans).toBe(p.fans+2);
 });
 it('ignores duplicate/stale/prediction/banked and transitions only to newer verified reset',async()=>{
  expect((await sync([event()])).changed).toBe(false);
  for(const extra of [{stale:true},{is_prediction:true}])expect((await sync([event('next','2026-10-02T00:00:00Z')],extra)).changed).toBe(false);
  expect((await sync([{...event('banked','2026-10-02T00:00:00Z'),reset_type:'banked'}])).changed).toBe(false);
  const s=await sync([event('next','2026-10-02T00:00:00Z')]);expect(s.state).toMatchObject({roundId:'next',hits:0,fans:0});
  expect((await hit('test-reset')).status).toBe(409);expect((await sync([event()])).changed).toBe(false);
  await runInDurableObject(doStub(),async(_i:any,state:any)=>{expect(state.storage.sql.exec("SELECT * FROM rounds WHERE status='closed'").toArray()).toHaveLength(1)});
 });
 it('protects manual endpoint and rejects banked events',async()=>{
  expect((await SELF.fetch('https://example.com/api/admin/reset',{method:'POST',body:'{}'})).status).toBe(401);
  expect((await SELF.fetch('https://example.com/api/admin/reset',{method:'POST',headers:{Authorization:'Bearer test-admin'},body:JSON.stringify({...event(),reset_type:'banked'})})).status).toBe(400);
 });
});

describe('Cron feed fetch',()=>{
 it('handles non-200 and malformed JSON as no-op; consumes a verified event',async()=>{
  const mock=vi.spyOn(globalThis,'fetch');
  const before=await (await doStub().fetch('https://raid/state')).json() as any;
  for(const [code,payload] of [[429,'{}'],[500,'{}'],[200,'invalid JSON'],[200,JSON.stringify({stale:true,data:[event('cron-next','2026-10-03T00:00:00Z')]})]] as const){
   mock.mockResolvedValueOnce(new Response(payload,{status:code}));
   await syncFeed(E);expect(await (await doStub().fetch('https://raid/state')).json()).toMatchObject({roundId:before.roundId});
  }
  mock.mockResolvedValueOnce(Response.json({data:[event('cron-next','2026-10-03T00:00:00Z')]}));
  await syncFeed(E);expect(await (await doStub().fetch('https://raid/state')).json()).toMatchObject({roundId:'cron-next',hits:0,fans:0});
  expect(mock).toHaveBeenCalledTimes(5);mock.mockRestore();
 });
});
