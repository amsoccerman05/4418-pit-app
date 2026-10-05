import {createCache} from './cache.ts';

// Verified against TBA OpenAPI 3.27.0 (2026-10-05):
// https://www.thebluealliance.com/swagger/api_v3.json
// Only qual.ranking is used. Playoff/alliance records are a different scope.
export type QualificationStandings={
 scope:'qualification';
 rank:number|null;
 numTeams:number|null;
 record:{wins:number;losses:number;ties:number}|null;
};
export type StandingsFeed={
 standings:QualificationStandings|null;
 standingsAt:number|null;
 standingsError:string|null;
 standingsStale:boolean;
};
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const integer=(value:unknown,minimum:number):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=minimum;
const invalid=()=>new Error('Invalid TBA qualification standings response');

export function parseStandings(raw:unknown,team:number):QualificationStandings|null{
 if(raw===null)return null; // TBA documents null for future/unavailable events.
 if(!object(raw))throw invalid();
 const qual=raw.qual;
 if(qual===undefined||qual===null)return null;
 if(!object(qual))throw invalid();
 const ranking=qual.ranking;
 if(ranking===undefined||ranking===null)return null;
 if(!object(ranking)||ranking.team_key!==`frc${team}`)throw invalid();
 const rank=ranking.rank??null,numTeams=qual.num_teams??null;
 if(rank!==null&&!integer(rank,1))throw invalid();
 if(numTeams!==null&&!integer(numTeams,0))throw invalid();
 if(rank!==null&&numTeams!==null&&rank>numTeams)throw invalid();
 let record:QualificationStandings['record']=null;
 if(ranking.record!==undefined&&ranking.record!==null){
  const r=ranking.record;
  if(!object(r)||!integer(r.wins,0)||!integer(r.losses,0)||!integer(r.ties,0))throw invalid();
  record={wins:r.wins,losses:r.losses,ties:r.ties};
 }
 // A team count alone is not a published team standing. Never derive a record
 // from match winners: surrogates, DQs and playoffs have different semantics.
 return rank===null&&record===null?null:{scope:'qualification',rank,numTeams,record};
}

// Keep the last *validated* snapshot separately: an HTTP 200 containing malformed
// JSON data must not replace useful standings or acquire a fresh displayed time.
// The existing cache handles ETags, timeouts and shared in-flight requests.
export function createStandingsFeed(cached:ReturnType<typeof createCache>=createCache()){
 const snapshots=new Map<string,{standings:QualificationStandings|null;at:number}>();
 return async function getStandings(event:string,team:number,key:string|undefined):Promise<StandingsFeed>{
  if(!/^[0-9]{4}[a-z0-9]{1,40}$/.test(event)||!integer(team,1)||team>99999)
   return {standings:null,standingsAt:null,standingsError:'Invalid competition configuration',standingsStale:false};
  const url=`https://www.thebluealliance.com/api/v3/team/frc${team}/event/${encodeURIComponent(event)}/status`;
  const previous=snapshots.get(url);
  const unavailable=(error:string):StandingsFeed=>({standings:previous?.standings??null,standingsAt:previous?.at??null,standingsError:error,standingsStale:!!previous?.standings});
  try{
   const response=await cached(url,'X-TBA-Auth-Key',key,60000);
   if(response.error)return unavailable(response.error);
   const standings=parseStandings(response.data,team);
   if(!integer(response.at,1))throw invalid();
   snapshots.set(url,{standings,at:response.at});
   if(snapshots.size>32)snapshots.delete(snapshots.keys().next().value!);
   return {standings,standingsAt:response.at,standingsError:null,standingsStale:false};
  }catch{
   return unavailable('TBA qualification standings unavailable; last successful data may be stale');
  }
 };
}
