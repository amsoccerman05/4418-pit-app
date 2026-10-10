import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {parseEventMatches,parseEventTeams,parseMatches,parseNexus} from '../supabase/functions/competition-feed/external.ts';
import {createStandingsFeed} from '../supabase/functions/competition-feed/standings.ts';
import {createDisplayFeed} from '../supabase/functions/competition-feed/display-feed.ts';

const secret='test-server-secret';
const status={qual:{num_teams:40,ranking:{team_key:'frc4418',rank:7,record:{wins:5,losses:2,ties:1}}},playoff:{record:{wins:4,losses:0,ties:0}},overall_status_str:'Do not expose upstream HTML'};
const rawMatch=(number,red,blue)=>({key:`2026test_qm${number}`,event_key:'2026test',comp_level:'qm',set_number:1,match_number:number,time:1800000000,predicted_time:null,actual_time:null,winning_alliance:'',alliances:{red:{team_keys:red.map(n=>`frc${n}`),score:-1},blue:{team_keys:blue.map(n=>`frc${n}`),score:-1}}});
// Execute the actual handler with injected server dependencies; never contact production.
function fixture(){
 let handler;
 const state={user:{id:'member'},authError:null,active:true,event:{id:'event'},config:{team_number:4418,tba_event_key:'2026test',nexus_event_key:'test',version:1},configError:null,status,standingsError:null,matches:[],matchError:null,matchAt:1800000000000,teams:[],teamsError:null,teamsAt:1800000010000,at:1800000000000,requests:[]};
 const source=readFileSync(new URL('../supabase/functions/competition-feed/index.ts',import.meta.url),'utf8');
 const code=ts.transpileModule(source.replace(/import .*?;\n/g,''),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
 const db={auth:{getUser:async()=>({data:{user:state.user},error:state.authError})},from(table){const q={select(){return q},eq(){return q},single:async()=>({data:{active:state.active}}),maybeSingle:async()=>({data:table==='pit_events'?state.event:state.config,error:table==='pit_event_config'?state.configError:null})};return q;}};
 const cache=async(url,header,key,ttl)=>{
  state.requests.push({url,header,key,ttl});
  if(url.startsWith('https://api.statbotics.io/')) {assert.equal(key,undefined);assert.equal(header,null);return {data:[],at:state.at,error:null};}
  assert.equal(key,secret);
  if(url.endsWith('/map'))return {data:null,at:state.at,error:null,notFound:true};
  if(url.endsWith('/pits'))return {data:{},at:state.at,error:null};
  return {data:url.endsWith('/status')?state.status:url.includes('/matches/')?state.matches:url.includes('/teams/')?state.teams:url.includes('frc.nexus')?{eventKey:'test',dataAsOfTime:state.nexusAsOf??state.at,matches:[],announcements:[],partsRequests:[]}:{key:state.config.tba_event_key,name:'Test event',webcasts:[]},at:url.includes('/matches/')?state.matchAt:url.includes('/teams/')?state.teamsAt:state.at,error:url.endsWith('/status')?state.standingsError:url.includes('/matches/')?state.matchError:url.includes('/teams/')?state.teamsError:null};
 };
 new Function('Deno','createClient','createCache','parseEventMatches','parseEventTeams','parseNexus','createStandingsFeed','createDisplayFeed',code)({env:{get:()=>secret},serve:h=>handler=h},()=>db,()=>cache,parseEventMatches,parseEventTeams,parseNexus,createStandingsFeed,createDisplayFeed);
 return {state,request:(headers={authorization:'Bearer test'},method='POST')=>handler(new Request('https://example.test/feed',{method,headers}))};
}

test('feed handler gates origin/auth/active profile and exposes only normalized public event data',async()=>{
 const {state,request}=fixture();
 assert.equal((await request({})).status,401);
 assert.equal((await request({origin:'https://evil.test',authorization:'Bearer test'})).status,403);
 assert.equal((await request({},'GET')).status,405);
 assert.equal((await request({origin:'https://pit.frc4418.org'},'OPTIONS')).status,204);
 state.user=null;assert.equal((await request()).status,401);
 state.user={id:'member'};state.authError={message:'Invalid token'};assert.equal((await request()).status,401);state.authError=null;state.active=false;assert.equal((await request()).status,403);assert.equal(state.requests.length,0);
 state.active=true;const response=await request({origin:'https://pit.frc4418.org',authorization:'Bearer test'});
 assert.equal(response.status,200);const body=await response.text();assert.ok(!body.includes(secret));assert.ok(!body.includes('upstream HTML'));assert.ok(!body.includes('playoff'));assert.ok(!body.includes('team_key'));
 const feed=JSON.parse(body);assert.equal(feed.configured,true);assert.equal(state.requests.length,8);assert.equal(response.headers.get('access-control-allow-origin'),'https://pit.frc4418.org');
 assert.deepEqual(feed.standings,{scope:'qualification',rank:7,numTeams:40,record:{wins:5,losses:2,ties:1}});
 assert.equal(feed.standingsAt,state.at);assert.equal(feed.standingsError,null);assert.equal(feed.standingsStale,false);
 const standingsRequest=state.requests.find(r=>r.url.endsWith('/status'));
 assert.equal(standingsRequest.url,'https://www.thebluealliance.com/api/v3/team/frc4418/event/2026test/status');assert.equal(standingsRequest.header,'X-TBA-Auth-Key');assert.equal(standingsRequest.ttl,60000);
 assert.equal(response.headers.get('cache-control'),'no-store');
});

test('one event schedule request provides all scouting matches and the unchanged team-only operations feed',async()=>{
 const {state,request}=fixture();
 state.matches=[rawMatch(1,[1,2,3],[4,5,6]),rawMatch(2,[4418,7,8],[9,10,11]),rawMatch(3,[12,13,14],[15,4418,16])];
 const feed=await (await request()).json();
 assert.equal(feed.scoutingMatches.length,3);assert.equal(feed.matches.length,2);
 assert.deepEqual(feed.scoutingMatches.map(m=>m.alliance),[null,'red','blue']);
 assert.deepEqual(feed.matches,parseMatches(state.matches,'2026test',4418));
 assert.deepEqual(feed.scoutingMatches[0].red,['1','2','3']);assert.deepEqual(feed.scoutingMatches[0].blue,['4','5','6']);
 assert.equal(feed.tbaAt,state.matchAt);assert.equal(feed.tbaError,null);
 const schedules=state.requests.filter(r=>r.url.includes('/matches/'));
 assert.deepEqual(schedules,[{url:'https://www.thebluealliance.com/api/v3/event/2026test/matches/simple',header:'X-TBA-Auth-Key',key:secret,ttl:60000}]);
 assert.equal(state.requests.length,8);assert.equal(feed.nexus.matches.length,0);assert.equal(feed.standings.rank,7);
});

test('event directory uses the existing server credential and is available before schedules or reports',async()=>{
 const {state,request}=fixture();
 state.teams=[{key:'frc4418',team_number:4418,nickname:'IMPULSE',name:'Sponsor name'},{key:'frc1619',team_number:1619,nickname:'Up-A-Creek Robotics'},{key:'frc999',team_number:999,name:'Full name',website:secret},null,{key:'frc1',team_number:2}];
 const feed=await (await request()).json();
 assert.deepEqual(feed.eventTeams,[{key:'frc999',number:999,name:'Full name'},{key:'frc1619',number:1619,name:'Up-A-Creek Robotics'},{key:'frc4418',number:4418,name:'IMPULSE'}]);
 assert.deepEqual(feed.matches,[]);assert.deepEqual(feed.scoutingMatches,[]);assert.equal(feed.teamsAt,state.teamsAt);assert.equal(feed.teamsError,null);assert.equal(feed.tbaAt,state.matchAt);assert.notEqual(feed.teamsAt,feed.tbaAt);
 assert.ok(!JSON.stringify(feed).includes(secret));
 assert.deepEqual(state.requests.filter(r=>r.url.includes('/teams/')),[{url:'https://www.thebluealliance.com/api/v3/event/2026test/teams/simple',header:'X-TBA-Auth-Key',key:secret,ttl:300000}]);
 state.matchError='Match service unavailable';state.matches=null;state.matchAt=null;
 const scheduleDown=await (await request()).json();assert.deepEqual(scheduleDown.eventTeams,feed.eventTeams);assert.equal(scheduleDown.teamsError,null);assert.equal(scheduleDown.tbaError,state.matchError);
});

test('directory outages and malformed envelopes preserve only the same event validated snapshot',async()=>{
 const {state,request}=fixture();
 state.teams=[{key:'frc4418',team_number:4418,nickname:'IMPULSE'}];
 state.matches=[rawMatch(1,[4418,2,3],[4,5,6])];
 const first=await (await request()).json();
 state.teamsAt+=300001;state.teamsError='External service unavailable; last successful data may be stale';state.teams=null;
 let feed=await (await request()).json();assert.deepEqual(feed.eventTeams,first.eventTeams);assert.equal(feed.teamsAt,first.teamsAt);assert.equal(feed.teamsError,state.teamsError);assert.equal(feed.tbaError,null);assert.deepEqual(feed.matches,first.matches);assert.equal(feed.standings.rank,7);
 state.teamsError=null;state.teams={teams:[]};
 feed=await (await request()).json();assert.deepEqual(feed.eventTeams,first.eventTeams);assert.equal(feed.teamsAt,first.teamsAt);assert.match(feed.teamsError,/team directory unavailable/);
 state.teams=null;
 feed=await (await request()).json();assert.deepEqual(feed.eventTeams,first.eventTeams);assert.equal(feed.teamsAt,first.teamsAt);assert.ok(feed.teamsError);
 state.teams=[null,{key:'frc4418b',team_number:4418}];
 feed=await (await request()).json();assert.deepEqual(feed.eventTeams,first.eventTeams);assert.equal(feed.teamsAt,first.teamsAt);assert.ok(feed.teamsError);
 state.config={...state.config,tba_event_key:'2026other',version:2};state.teamsError='API key not configured';
 feed=await (await request()).json();assert.deepEqual(feed.eventTeams,[]);assert.equal(feed.teamsAt,null);assert.equal(feed.teamsError,'API key not configured');
 state.teamsError=null;state.teams=[];
 feed=await (await request()).json();assert.deepEqual(feed.eventTeams,[]);assert.equal(feed.teamsAt,state.teamsAt);assert.equal(feed.teamsError,null);
 state.config={...state.config,tba_event_key:'2026test',version:3};state.teamsError='External service unavailable';
 feed=await (await request()).json();assert.deepEqual(feed.eventTeams,first.eventTeams);assert.equal(feed.teamsAt,first.teamsAt);
 state.teamsError=null;state.teams=[];
 feed=await (await request()).json();assert.deepEqual(feed.eventTeams,[]);assert.equal(feed.teamsAt,state.teamsAt);assert.equal(feed.teamsError,null);
});

test('initially missing or malformed directory never fabricates freshness or affects other feeds',async()=>{
 const {state,request}=fixture();
 state.teamsError='API key not configured';state.teams=null;state.teamsAt=null;
 let feed=await (await request()).json();assert.deepEqual(feed.eventTeams,[]);assert.equal(feed.teamsAt,null);assert.equal(feed.teamsError,'API key not configured');assert.equal(feed.tbaError,null);assert.equal(feed.standings.rank,7);
 state.teamsError=null;state.teams={error:'Internal upstream detail'};state.teamsAt=state.at;
 feed=await (await request()).json();assert.deepEqual(feed.eventTeams,[]);assert.equal(feed.teamsAt,null);assert.match(feed.teamsError,/team directory unavailable/);assert.ok(!JSON.stringify(feed).includes('Internal upstream detail'));
 state.teams=[];state.teamsAt=null;
 feed=await (await request()).json();assert.deepEqual(feed.eventTeams,[]);assert.equal(feed.teamsAt,null);assert.ok(feed.teamsError);
});

test('schedule outage metadata and invalid or cross-event responses apply consistently to both schedules',async()=>{
 const {state,request}=fixture();
 state.matches=[rawMatch(1,[1,2,3],[4,5,6]),rawMatch(2,[4418,7,8],[9,10,11])];
 const first=await (await request()).json();
 state.at+=60001;state.matchError='External service unavailable; last successful data may be stale';
 let feed=await (await request()).json();assert.deepEqual(feed.matches,first.matches);assert.deepEqual(feed.scoutingMatches,first.scoutingMatches);assert.equal(feed.tbaAt,first.tbaAt);assert.equal(feed.tbaError,state.matchError);
 state.matches=null;state.matchAt=null;state.matchError='API key not configured';
 feed=await (await request()).json();assert.deepEqual(feed.matches,[]);assert.deepEqual(feed.scoutingMatches,[]);assert.equal(feed.tbaAt,null);assert.equal(feed.tbaError,'API key not configured');
 state.matches={matches:[]};state.matchError=null;
 feed=await (await request()).json();assert.deepEqual(feed.matches,[]);assert.deepEqual(feed.scoutingMatches,[]);assert.equal(feed.tbaError,'TBA response unavailable');
 state.matches=[rawMatch(2,[4418,7,8],[9,10,11]),{...rawMatch(3,[1,2,3],[4,5,6]),event_key:'2026other'},null];
 feed=await (await request()).json();assert.equal(feed.matches.length,1);assert.equal(feed.scoutingMatches.length,1);assert.equal(feed.tbaError,null);
 state.config={...state.config,tba_event_key:'2026other',version:2};
 feed=await (await request()).json();assert.deepEqual(feed.matches,[]);assert.deepEqual(feed.scoutingMatches,[]);assert.equal(feed.tbaError,null);
 state.matches=[];
 feed=await (await request()).json();assert.deepEqual(feed.matches,[]);assert.deepEqual(feed.scoutingMatches,[]);assert.equal(feed.tbaError,null);
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

test('queue normalization rejects regressing or future source times and recovers with a current snapshot',async()=>{
 const {state,request}=fixture();const first=await (await request()).json();state.at+=30000;state.nexusAsOf=first.nexus.asOf-30000;
 let feed=await (await request()).json();assert.deepEqual(feed.nexus,first.nexus);assert.equal(feed.nexusAt,first.nexusAt);assert.ok(feed.nexusError);
 state.nexusAsOf=state.at+60001;feed=await (await request()).json();assert.deepEqual(feed.nexus,first.nexus);assert.ok(feed.nexusError);
 state.nexusAsOf=state.at;feed=await (await request()).json();assert.equal(feed.nexus.asOf,state.at);assert.equal(feed.nexusError,null);
});
