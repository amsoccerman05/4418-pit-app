// Small per-instance cache; failures never replace last successful data.
export function createCache(fetcher:typeof fetch=fetch,clock=Date.now){
 const cache=new Map<string,{data:any;etag:string|null;at:number;until:number;error:string|null;notFound?:boolean}>(),pending=new Map<string,Promise<any>>();
 return async function get(url:string,header:string|null,key:string|undefined,ttl:number,options:{notFoundIsEmpty?:boolean}={}){
  if(header&&!key)return {data:null,at:null,error:'API key not configured'};
  const old=cache.get(url);if(old&&old.until>clock())return old;
  if(pending.has(url))return pending.get(url);
  const task=(async()=>{try{
   const headers:Record<string,string>=header&&key?{[header]:key}:{};if(old?.etag)headers['If-None-Match']=old.etag;
   const r=await fetcher(url,{headers,signal:AbortSignal.timeout(8000),redirect:'error'});
   const absent=r.status===404&&options.notFoundIsEmpty;
   if(r.status!==304&&!r.ok&&!absent)throw new Error('Upstream unavailable');
   if(r.status===304&&!old)throw new Error('Missing cached response');
   const maxAge=Number(r.headers.get('cache-control')?.match(/max-age=(\d+)/)?.[1]||0)*1000;
   const v={notFound:!!absent||(r.status===304&&!!old?.notFound),data:absent?null:r.status===304?old!.data:await r.json(),etag:absent?null:r.headers.get('etag')||(r.status===304?old?.etag:null)||null,at:clock(),until:clock()+Math.max(ttl,Math.min(maxAge,300000)),error:null};
   cache.set(url,v);return v;
  }catch{const v={data:old?.data??null,etag:old?.etag??null,at:old?.at??0,until:clock()+ttl,error:'External service unavailable; last successful data may be stale'};cache.set(url,v);return v;}
  finally{pending.delete(url);if(cache.size>32)cache.delete(cache.keys().next().value!);}})();
  pending.set(url,task);return task;
 };
}
