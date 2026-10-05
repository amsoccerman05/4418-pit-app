import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {parseMatches,parseNexus} from '../supabase/functions/competition-feed/external.ts';
import {createStandingsFeed} from '../supabase/functions/competition-feed/standings.ts';

const secret='test-server-secret';
const status={qual:{num_teams:40,ranking:{team_key:'frc4418',rank:7,record:{wins:5,losses:2,ties:1}}},playoff:{record:{wins:4,losses:0,ties:0}},overall_status_str:'Do not expose upstream HTML'};
// Execute the actual handler with injected server dependencies; never contact production.
function fixture(){
 let handler;
 const state={user:{id:'member'},active:true,event:{id:'event'},config:{team_number:4418,tba_event_key:'2026test',nexus_event_key:'test',version:1},configError:null,status,standingsError:null,at:1800000000000,requests:[]};
 const source=readFileSync(new URL('../supabase/functions/competition-feed/index.ts',import.meta.url),'utf8');
 const code=ts.transpileModule(source.replace(/import .*?;\n/g,''),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
 const db={auth:{getUser:async()=>({data:{user:state.user},error:null})},from(table){const q={select(){return q},eq(){return q},single:async()=>({data:{active:state.active}}),maybeSingle:async()=>({data:table==='pit_events'?state.event:state.config,error:table==='pit_event_config'?state.configError:null})};return q;}};
 const cache=async(url,header,key,ttl)=>{
  state.requests.push({url,header,key,ttl});assert.equal(key,secret);
  return {data:url.endsWith('/status')?state.status:url.includes('/matches/')?[]:url.includes('frc.nexus')?{eventKey:'test',dataAsOfTime:state.at,matches:[],announcements:[]}:{name:'Test event'},at:state.at,error:url.endsWith('/status')?state.standingsError:null};
 };
 new Function('Deno','createClient','createCache','parseMatches','parseNexus','createStandingsFeed',code)({env:{get:()=>secret},serve:h=>handler=h},()=>db,()=>cache,parseMatches,parseNexus,createStandingsFeed);
 return {state,request:(headers={authorization:'Bearer test'},method='POST')=>handler(new Request('https://example.test/feed',{method,headers}))};
}

test('feed handler gates origin/auth/active profile and exposes only normalized public event data',async()=>{
 const {state,request}=fixture();
 assert.equal((await request({})).status,401);
 assert.equal((await request({origin:'https://evil.test',authorization:'Bearer test'})).status,403);
 assert.equal((await request({},'GET')).status,405);
 assert.equal((await request({origin:'https://pit.frc4418.org'},'OPTIONS')).status,204);
 state.user=null;assert.equal((await request()).status,401);
 state.user={id:'member'};state.active=false;assert.equal((await request()).status,403);assert.equal(state.requests.length,0);
 state.active=true;const response=await request({origin:'https://pit.frc4418.org',authorization:'Bearer test'});
 assert.equal(response.status,200);const body=await response.text();assert.ok(!body.includes(secret));assert.ok(!body.includes('upstream HTML'));assert.ok(!body.includes('playoff'));assert.ok(!body.includes('team_key'));
 const feed=JSON.parse(body);assert.equal(feed.configured,true);assert.equal(state.requests.length,4);assert.equal(response.headers.get('access-control-allow-origin'),'https://pit.frc4418.org');
 assert.deepEqual(feed.standings,{scope:'qualification',rank:7,numTeams:40,record:{wins:5,losses:2,ties:1}});
 assert.equal(feed.standingsAt,state.at);assert.equal(feed.standingsError,null);assert.equal(feed.standingsStale,false);
 const standingsRequest=state.requests.find(r=>r.url.endsWith('/status'));
 assert.equal(standingsRequest.url,'https://www.thebluealliance.com/api/v3/team/frc4418/event/2026test/status');assert.equal(standingsRequest.header,'X-TBA-Auth-Key');assert.equal(standingsRequest.ttl,60000);
 assert.equal(response.headers.get('cache-control'),'no-store');
});

test('unconfigured events and configuration errors perform no upstream reads',async()=>{
 const {state,request}=fixture();
 state.event=null;assert.deepEqual(await (await request()).json(),{eventId:null,configured:false});
 state.event={id:'event'};state.config=null;assert.deepEqual(await (await request()).json(),{eventId:'event',configured:false});
 state.configError={message:'private database error'};const response=await request();assert.equal(response.status,503);assert.deepEqual(await response.json(),{error:'Competition configuration unavailable'});assert.equal(state.requests.length,0);
});

test('feed standings outage or malformed data retains only validated qualification data with its original time',async()=>{
 const {state,request}=fixture();
 const first=await (await request()).json();
 state.at+=60001;state.standingsError='External service unavailable; last successful data may be stale';state.status=null;
 let feed=await (await request()).json();assert.deepEqual(feed.standings,first.standings);assert.equal(feed.standingsAt,first.standingsAt);assert.equal(feed.standingsStale,true);assert.ok(feed.standingsError);assert.equal(feed.tbaError,null);assert.deepEqual(feed.matches,[]);
 state.standingsError=null;state.status={qual:{ranking:{team_key:'frc4418',rank:'7',record:{wins:5,losses:2,ties:1}}}};
 feed=await (await request()).json();assert.deepEqual(feed.standings,first.standings);assert.equal(feed.standingsAt,first.standingsAt);assert.equal(feed.standingsStale,true);assert.ok(feed.standingsError);
 state.status={qual:null,playoff:{record:{wins:4,losses:0,ties:0}}};
 feed=await (await request()).json();assert.equal(feed.standings,null);assert.equal(feed.standingsAt,state.at);assert.equal(feed.standingsStale,false);assert.equal(feed.standingsError,null);
});

test('unpublished, initially unavailable and changed-event standings never display invented zeros or another event snapshot',async()=>{
 const {state,request}=fixture();
 state.status=null;let feed=await (await request()).json();assert.equal(feed.standings,null);assert.equal(feed.standingsError,null);
 state.status=status;feed=await (await request()).json();assert.equal(feed.standings.rank,7);
 state.config={...state.config,tba_event_key:'2026other',version:2};state.standingsError='API key not configured';state.status=null;
 feed=await (await request()).json();assert.equal(feed.standings,null);assert.equal(feed.standingsAt,null);assert.equal(feed.standingsStale,false);assert.equal(feed.standingsError,'API key not configured');
});
