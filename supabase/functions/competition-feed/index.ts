import {createClient} from 'npm:@supabase/supabase-js@2.116.0';
import {parseEventMatches,parseEventTeams,parseNexus,type EventMatch,type EventTeam,type Match} from './external.ts';
import {createCache} from './cache.ts';
import {createStandingsFeed} from './standings.ts';
const cached=createCache();
const getStandings=createStandingsFeed(cached);
// A malformed HTTP 200 must not overwrite the last validated roster or refresh
// its displayed timestamp. Both caches are bounded and keyed by event identity.
const teamSnapshots=new Map<string,{eventTeams:EventTeam[];teamsAt:number}>();
async function getEventTeams(event:string,key:string|undefined){
 const previous=teamSnapshots.get(event);
 const unavailable=(error:string)=>({eventTeams:previous?.eventTeams??[],teamsAt:previous?.teamsAt??null,teamsError:error});
 if(!/^[0-9]{4}[a-z0-9]{1,40}$/.test(event))return unavailable('Invalid competition configuration');
 try{
  const response=await cached(`https://www.thebluealliance.com/api/v3/event/${encodeURIComponent(event)}/teams/simple`,'X-TBA-Auth-Key',key,300000);
  if(response.error)return unavailable(response.error);
  const eventTeams=parseEventTeams(response.data);
  if(!Number.isSafeInteger(response.at)||response.at<=0)throw new Error('Invalid TBA team timestamp');
  const snapshot={eventTeams,teamsAt:response.at as number};
  teamSnapshots.set(event,snapshot);
  if(teamSnapshots.size>32)teamSnapshots.delete(teamSnapshots.keys().next().value!);
  return {...snapshot,teamsError:null};
 }catch{return unavailable('TBA team directory unavailable; last successful data may be stale');}
}
Deno.serve(async req=>{
 const origin=req.headers.get('origin');const allowed=origin==='https://pit.frc4418.org';
 const headers={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin',...(allowed?{'Access-Control-Allow-Origin':origin!,'Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS'}:{})};
 const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
 if(origin&&!allowed)return reply({error:'Origin not allowed'},403);
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(req.method!=='POST')return reply({error:'POST required'},405);
 const authorization=req.headers.get('authorization')||'';if(!authorization.startsWith('Bearer '))return reply({error:'Authentication required'},401);
 const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_ANON_KEY')!,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}});
 const {data:user,error:authError}=await db.auth.getUser();if(authError||!user.user)return reply({error:'Authentication required'},401);
 const {data:profile}=await db.from('profiles').select('active').eq('id',user.user.id).single();if(!profile?.active)return reply({error:'Active team account required'},403);
 const {data:event}=await db.from('pit_events').select('id').eq('status','active').maybeSingle();
 if(!event)return reply({eventId:null,configured:false});
 const {data:c,error}=await db.from('pit_event_config').select('*').eq('event_id',event.id).maybeSingle();if(error)return reply({error:'Competition configuration unavailable'},503);
 if(!c)return reply({eventId:event.id,configured:false});
 const base='https://www.thebluealliance.com/api/v3',tbaKey=Deno.env.get('TBA_API_KEY'),nexusKey=Deno.env.get('NEXUS_API_KEY');
 const [info,matches,live,standings,eventTeams]=await Promise.all([cached(`${base}/event/${encodeURIComponent(c.tba_event_key)}/simple`,'X-TBA-Auth-Key',tbaKey,300000),cached(`${base}/event/${encodeURIComponent(c.tba_event_key)}/matches/simple`,'X-TBA-Auth-Key',tbaKey,60000),c.nexus_event_key?cached(`https://frc.nexus/api/v1/event/${encodeURIComponent(c.nexus_event_key)}`,'Nexus-Api-Key',nexusKey,30000):Promise.resolve({data:null,at:null,error:'Nexus not configured'}),getStandings(c.tba_event_key,c.team_number,tbaKey),getEventTeams(c.tba_event_key,tbaKey)]);
 let scoutingMatches:EventMatch[]=[],nexus=null,tbaError=matches.error,nexusError=live.error;
 try{if(matches.data)scoutingMatches=parseEventMatches(matches.data,c.tba_event_key,c.team_number);}catch{tbaError='TBA response unavailable';}
 const parsed=scoutingMatches.filter((m):m is Match=>m.alliance!==null);
 try{if(live.data)nexus=parseNexus(live.data,c.nexus_event_key,c.team_number);}catch{nexusError='Nexus response unavailable';}
 return reply({eventId:event.id,configured:true,configVersion:c.version,team:c.team_number,eventKey:c.tba_event_key,eventName:typeof info.data?.name==='string'?info.data.name:null,matches:parsed,scoutingMatches,tbaAt:matches.at||null,tbaError,nexus,nexusAt:live.at||null,nexusError,...standings,...eventTeams});
});
