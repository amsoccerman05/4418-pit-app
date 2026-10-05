import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseStandings,createStandingsFeed} from '../supabase/functions/competition-feed/standings.ts';
import {createCache} from '../supabase/functions/competition-feed/cache.ts';

const status=(ranking={},qual={})=>({qual:{num_teams:40,ranking:{team_key:'frc4418',rank:7,record:{wins:5,losses:2,ties:1},...ranking},...qual},playoff:{record:{wins:4,losses:0,ties:0},current_level_record:{wins:2,losses:0,ties:0}},alliance:{number:1}});

test('standings use official team qualification ranking and record, never playoff or alliance fields',()=>{
 assert.deepEqual(parseStandings(status(),4418),{scope:'qualification',rank:7,numTeams:40,record:{wins:5,losses:2,ties:1}});
 assert.equal(parseStandings({...status(),qual:null},4418),null);
 assert.equal(parseStandings({...status(),qual:{ranking:null}},4418),null);
 assert.equal(parseStandings({playoff:status().playoff,alliance:status().alliance},4418),null);
});

test('missing rank and record remain independently null; only explicit zero records become 0–0–0',()=>{
 assert.equal(parseStandings(null,4418),null);assert.equal(parseStandings({},4418),null);
 assert.equal(parseStandings(status({rank:null,record:null}),4418),null);
 assert.equal(parseStandings(status({rank:undefined,record:undefined}),4418),null);
 assert.deepEqual(parseStandings(status({rank:null}),4418),{scope:'qualification',rank:null,numTeams:40,record:{wins:5,losses:2,ties:1}});
 assert.deepEqual(parseStandings(status({record:null},{num_teams:undefined}),4418),{scope:'qualification',rank:7,numTeams:null,record:null});
 assert.deepEqual(parseStandings(status({rank:null,record:{wins:0,losses:0,ties:0}},{num_teams:0}),4418),{scope:'qualification',rank:null,numTeams:0,record:{wins:0,losses:0,ties:0}});
});

test('standings reject malformed shapes, foreign teams and invalid numeric fields instead of coercing',()=>{
 for(const raw of [undefined,false,0,'standings',[],{qual:[]},{qual:'qual'},{qual:{ranking:[]}},{qual:{ranking:'rank'}}])assert.throws(()=>parseStandings(raw,4418),/Invalid TBA/);
 for(const team_key of ['frc1',4418,null,undefined])assert.throws(()=>parseStandings(status({team_key}),4418),/Invalid TBA/);
 for(const rank of [0,-1,1.5,'7',true,NaN,Infinity,Number.MAX_SAFE_INTEGER+1,41])assert.throws(()=>parseStandings(status({rank}),4418),/Invalid TBA/);
 for(const num_teams of [-1,0,1.5,'40',true,NaN,Infinity])assert.throws(()=>parseStandings(status({}, {num_teams}),4418),/Invalid TBA/);
 for(const record of [[],{},'5-2-1',{wins:5,losses:2},{wins:null,losses:2,ties:1},{wins:5,losses:'2',ties:1},{wins:5,losses:2,ties:-1},{wins:5,losses:2,ties:0.5},{wins:Infinity,losses:2,ties:1}])assert.throws(()=>parseStandings(status({record}),4418),/Invalid TBA/);
});

test('standings strip unrelated upstream content without trusting aggregate match counters',()=>{
 const data=status({matches_played:100,qual_average:99,extra:'never expose',record:{wins:5,losses:2,ties:1,extra:'never expose'}});
 data.overall_status_str='<a>Never expose upstream markup</a>';
 assert.deepEqual(parseStandings(data,4418),{scope:'qualification',rank:7,numTeams:40,record:{wins:5,losses:2,ties:1}});
});

test('standings cache shares requests, honors bounded max-age and ETags, and authenticates only on the fixed server host',async()=>{
 let now=1000000,calls=0;
 const get=createStandingsFeed(createCache(async(url,options)=>{
  calls++;assert.equal(url,'https://www.thebluealliance.com/api/v3/team/frc4418/event/2026test/status');assert.equal(options.headers['X-TBA-Auth-Key'],'server-only');assert.equal(options.redirect,'error');assert.ok(options.signal);
  if(calls===2){assert.equal(options.headers['If-None-Match'],'v1');return new Response(null,{status:304});}
  return new Response(JSON.stringify(status()),{headers:{etag:'v1','cache-control':'max-age=9999'}});
 },()=>now));
 const [first,second]=await Promise.all([get('2026test',4418,'server-only'),get('2026test',4418,'server-only')]);assert.equal(calls,1);assert.deepEqual(first,second);
 now+=299999;assert.deepEqual(await get('2026test',4418,'server-only'),first);assert.equal(calls,1);
 now+=2;const revalidated=await get('2026test',4418,'server-only');assert.equal(calls,2);assert.equal(revalidated.standingsAt,now);assert.equal(revalidated.standingsStale,false);assert.deepEqual(revalidated.standings,first.standings);
});

test('network, HTTP, malformed JSON and malformed schema failures preserve the validated snapshot and timestamp',async()=>{
 let now=1000000,mode='good',calls=0;
 const get=createStandingsFeed(createCache(async()=>{
  calls++;
  if(mode==='network')throw new Error('offline with private details');
  if(mode==='http')return new Response('private failure',{status:503});
  if(mode==='json')return new Response('{bad json');
  if(mode==='schema')return new Response(JSON.stringify(status({rank:-1})),{headers:{etag:'bad'}});
  if(mode==='notmodified')return new Response(null,{status:304});
  return new Response(JSON.stringify(status()));
 },()=>now));
 const first=await get('2026test',4418,'server-only');
 for(mode of ['network','http','json','schema','notmodified']){
  now+=60001;const stale=await get('2026test',4418,'server-only');assert.deepEqual(stale.standings,first.standings,mode);assert.equal(stale.standingsAt,first.standingsAt,mode);assert.equal(stale.standingsStale,true,mode);assert.ok(stale.standingsError,mode);assert.ok(!stale.standingsError.includes('private'));
 }
 assert.equal(calls,6);
 mode='good';now+=60001;const recovered=await get('2026test',4418,'server-only');assert.equal(recovered.standingsAt,now);assert.equal(recovered.standingsStale,false);assert.equal(recovered.standingsError,null);
});

test('successful unpublished response clears old standings; a later failure cannot resurrect them',async()=>{
 let now=1000000,mode='good';
 const get=createStandingsFeed(createCache(async()=>{if(mode==='failed')throw new Error('offline');return new Response(JSON.stringify(mode==='good'?status():null));},()=>now));
 assert.equal((await get('2026test',4418,'server-only')).standings.rank,7);
 mode='unpublished';now+=60001;const cleared=await get('2026test',4418,'server-only');assert.deepEqual(cleared,{standings:null,standingsAt:now,standingsError:null,standingsStale:false});
 mode='failed';now+=60001;const unavailable=await get('2026test',4418,'server-only');assert.equal(unavailable.standings,null);assert.equal(unavailable.standingsAt,cleared.standingsAt);assert.equal(unavailable.standingsStale,false);assert.ok(unavailable.standingsError);
});

test('missing credentials, invalid configuration and initial failure are honest unavailable states with no cross-event/team fallback',async()=>{
 let calls=0,fail=false;
 const get=createStandingsFeed(createCache(async()=>{calls++;if(fail)throw new Error('offline');return new Response(JSON.stringify(status()));},()=>1000000));
 let result=await get('2026test',4418,undefined);assert.deepEqual(result,{standings:null,standingsAt:null,standingsError:'API key not configured',standingsStale:false});assert.equal(calls,0);
 for(const [event,team] of [['../other',4418],['2026test',0],['2026test',4418.5],['2026test','4418'],['2026test',100000]]){result=await get(event,team,'server-only');assert.equal(result.standings,null);assert.equal(result.standingsAt,null);assert.ok(result.standingsError);}
 assert.equal(calls,0);assert.equal((await get('2026test',4418,'server-only')).standings.rank,7);
 fail=true;
 for(const [event,team] of [['2026other',4418],['2026test',4419]]){result=await get(event,team,'server-only');assert.equal(result.standings,null);assert.equal(result.standingsAt,null);assert.equal(result.standingsStale,false);assert.ok(result.standingsError);}
});

test('malformed initial standings do not acquire a successful timestamp',async()=>{
 const get=createStandingsFeed(createCache(async()=>new Response(JSON.stringify(status({rank:'7'}))),()=>1000000));
 const result=await get('2026test',4418,'server-only');assert.equal(result.standings,null);assert.equal(result.standingsAt,null);assert.equal(result.standingsStale,false);assert.ok(result.standingsError);
});
