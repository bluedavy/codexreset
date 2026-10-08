export {ResetRaidDO} from './raid-do';
export interface Env { RAID:DurableObjectNamespace; ASSETS:Fetcher; VISITOR_HASH_SALT:string; ADMIN_RESET_SECRET?:string; HP_DECAY_K:string; }
const json = (body:unknown,status=200,headers={})=>Response.json(body,{status,headers:{'Cache-Control':'no-store',...headers}});
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const stub=(env:Env)=>env.RAID.get(env.RAID.idFromName('global'));
export async function syncFeed(env:Env) {
  try {
    const r=await fetch('https://tibo.cc/api/v1/resets?limit=10',{signal:AbortSignal.timeout(10000),headers:{Accept:'application/json'}});
    if (r.status!==200) return;
    const text=await r.text(); if(text.length>262144) return;
    const p=JSON.parse(text);
    await stub(env).fetch('https://raid/sync',{method:'POST',body:JSON.stringify(p)});
  } catch { console.warn('Reset feed unavailable; round unchanged'); }
}
async function body(request:Request) {
  if(Number(request.headers.get('Content-Length'))>2048) throw new Error('body_too_large');
  if(!request.body) throw new Error('invalid_body');
  const reader=request.body.getReader();let size=0;let text='';const decoder=new TextDecoder();
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>2048){await reader.cancel();throw new Error('body_too_large');}text+=decoder.decode(value,{stream:true});}
  return JSON.parse(text+decoder.decode());
}
export default {
  async fetch(request:Request,env:Env,ctx:ExecutionContext):Promise<Response> {
    const url=new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    if (url.pathname==='/api/state' && request.method==='GET') {
      const key=new Request(url.origin+'/api/state');const cache=caches.default;
      const cached=await cache.match(key); if(cached) return cached;
      let r=await stub(env).fetch('https://raid/state');
      if(r.status===503){await syncFeed(env);r=await stub(env).fetch('https://raid/state');}
      const response=new Response(r.body,{status:r.status,headers:{'Content-Type':'application/json','Cache-Control':r.ok?'public, max-age=2, s-maxage=2, stale-while-revalidate=5':'no-store'}});
      if(response.ok)ctx.waitUntil(cache.put(key,response.clone()));return response;
    }
    if(url.pathname==='/api/admin/reset' && request.method==='POST') {
      if(!env.ADMIN_RESET_SECRET || request.headers.get('Authorization')!==`Bearer ${env.ADMIN_RESET_SECRET}`)return json({error:'unauthorized'},401);
      try {const event=await body(request); const {verifiedEvents}=await import('./feed');if(!verifiedEvents({data:[event]}).length)return json({error:'unverified_event'},400);
        return stub(env).fetch('https://raid/sync',{method:'POST',body:JSON.stringify({data:[event]})});
      }catch{return json({error:'invalid_body'},400);}
    }
    if(url.pathname!=='/api/hit')return json({error:'not_found'},404);
    if(request.method!=='POST')return json({error:'method_not_allowed'},405,{Allow:'POST'});
    if(request.headers.get('Origin')!==url.origin || request.headers.get('Sec-Fetch-Site')==='cross-site')return json({error:'same_origin_required'},403);
    if(!env.VISITOR_HASH_SALT)return json({error:'service_unavailable'},503);
    try {
      const b=await body(request);
      if(!b || typeof b.roundId!=='string' || !/^[\w-]{1,128}$/.test(b.roundId) || !uuid.test(b.visitorId) || !uuid.test(b.batchId) || !Number.isInteger(b.hits) || b.hits<1 || b.hits>50)return json({error:'invalid_hit'},400);
      const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(env.VISITOR_HASH_SALT+b.visitorId));
      const visitorHash=Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('');
      const r=await stub(env).fetch('https://raid/hit',{method:'POST',body:JSON.stringify({roundId:b.roundId,visitorHash,batchId:b.batchId,hits:b.hits})});
      return new Response(r.body,{status:r.status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','Retry-After':r.headers.get('Retry-After')||'1'}});
    } catch(e){return json({error:e instanceof Error&&e.message==='body_too_large'?'body_too_large':'invalid_body'},e instanceof Error&&e.message==='body_too_large'?413:400);}
  },
  async scheduled(_controller:ScheduledController,env:Env,ctx:ExecutionContext){ctx.waitUntil(syncFeed(env));}
} satisfies ExportedHandler<Env>;
