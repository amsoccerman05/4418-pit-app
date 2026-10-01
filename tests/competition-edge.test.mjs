import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
// Execute the actual handler with injected server dependencies; never contact production.
test('feed handler gates origin/auth/active profile and exposes only normalized public event data',async()=>{
 let handler,user={id:'member'},active=true,requests=0;
 const secret='test-server-secret';
 const source=readFileSync(new URL('../supabase/functions/competition-feed/index.ts',import.meta.url),'utf8');
 let code=source.replace(/import .*?;\n/g,'');
 code=ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
 const db={auth:{getUser:async()=>({data:{user},error:null})},from(table){const q={select(){return q},eq(){return q},single:async()=>({data:{active}}),maybeSingle:async()=>({data:table==='pit_events'?{id:'event'}:{team_number:4418,tba_event_key:'2026test',nexus_event_key:'test',version:1}})};return q;}};
 const {parseMatches,parseNexus}=await import('../supabase/functions/competition-feed/external.ts');
 new Function('Deno','createClient','createCache','parseMatches','parseNexus',code)({env:{get:()=>secret},serve:h=>handler=h},()=>db,()=>async(url,header,key)=>{requests++;assert.equal(key,secret);return {data:url.includes('/matches/')?[]:url.includes('frc.nexus')?{eventKey:'test',dataAsOfTime:Date.now(),matches:[],announcements:[]}:{name:'Test event'},at:Date.now(),error:null};},parseMatches,parseNexus);
 const req=(headers={})=>new Request('https://example.test/feed',{method:'POST',headers});
 assert.equal((await handler(req())).status,401);
 assert.equal((await handler(req({origin:'https://evil.test',authorization:'Bearer test'}))).status,403);
 user=null;assert.equal((await handler(req({authorization:'Bearer test'}))).status,401);
 user={id:'member'};active=false;assert.equal((await handler(req({authorization:'Bearer test'}))).status,403);assert.equal(requests,0);
 active=true;const response=await handler(req({origin:'https://pit.frc4418.org',authorization:'Bearer test'}));assert.equal(response.status,200);const body=await response.text();assert.ok(!body.includes(secret));assert.equal(JSON.parse(body).configured,true);assert.equal(requests,3);assert.equal(response.headers.get('access-control-allow-origin'),'https://pit.frc4418.org');
});
