import {useCallback,useEffect,useRef,useState} from 'react';
import {supabase} from '../client';
import type {Profile} from '../model';
export {liveFor,nextMatch,operationalReadiness} from '../../supabase/functions/competition-feed/external';
export type {Match,LiveMatch} from '../../supabase/functions/competition-feed/external';
import type {Match,parseNexus} from '../../supabase/functions/competition-feed/external';
export type TemplateItem={text:string;required:boolean;blocking:boolean;area_id:string|null};
export type Template={id:string;name:string;description:string;kind:'pre'|'post'|'general';active:boolean;version:number;items:TemplateItem[]};
export type Ops={id:string;event_id:string;match_key:string;battery_id:string|null;note:string;version:number};
export type Run={id:string;match_id:string|null;name:string;kind:string;template_version:number;started_at:string;started_by:string};
export type Item=TemplateItem&{id:string;run_id:string;display_order:number;completed_at:string|null;completed_by:string|null;version:number};
export type Context={can_manage:boolean;config:{event_id:string;team_number:number;tba_event_key:string;nexus_event_key:string|null;version:number}|null;matches:Ops[];templates:Template[];runs:Run[];items:Item[];links:{issue_id:string;match_id:string}[];areas:{id:string;name:string}[]};
export type Feed={eventId:string|null;configured:boolean;configVersion?:number;team?:number;eventKey?:string;eventName?:string|null;matches:Match[];tbaAt:number|null;tbaError:string|null;nexus:ReturnType<typeof parseNexus>|null;nexusAt:number|null;nexusError:string|null};
export async function command(action:string,p:Record<string,unknown>){const {data,error}=await supabase!.rpc('pit_competition_manage',{action,p});if(error)throw error;return data as string;}
export function useCompetition(profile:Profile|null,eventId:string|undefined,demo:boolean,externalVisible:boolean){
 const [context,setContext]=useState<Context|null>(null),[feed,setFeed]=useState<Feed|null>(null),[error,setError]=useState(''),[feedError,setFeedError]=useState(''),[busy,setBusy]=useState(false),[tick,setTick]=useState(Date.now());
 const identity=profile?.id,epoch=useRef(0),inflight=useRef(false),last=useRef(0);
 const refresh=useCallback(async(force=false)=>{
  if(!identity||demo||!supabase||inflight.current)return;
  inflight.current=true;const generation=epoch.current;
  try{const {data,error}=await supabase.rpc('pit_competition_context',{event_id:eventId||null});if(error)throw error;if(generation===epoch.current){setContext(data);setError('');}
   if(externalVisible&&eventId&&(force||Date.now()-last.current>=30000)){
    last.current=Date.now();const {data:external,error:e}=await supabase.functions.invoke('competition-feed',{body:{}});
    if(generation===epoch.current){if(e)setFeedError('Live feed unavailable. Showing last loaded data.');else if(external.eventId===eventId){setFeed(previous=>external.tbaError&&previous&&previous.eventKey===external.eventKey&&previous.configVersion===external.configVersion?{...external,matches:external.matches?.length?external.matches:previous.matches,tbaAt:external.tbaAt||previous.tbaAt}:external);setFeedError('');}}
   }
  }catch(e){if(generation===epoch.current)setError((e as Error).message||'Competition data unavailable');}finally{inflight.current=false;}
 },[identity,eventId,demo,externalVisible]);
 useEffect(()=>{epoch.current++;setContext(null);setFeed(null);setFeedError('');last.current=0;},[identity,eventId,demo]);
 useEffect(()=>{void refresh();const timer=setInterval(()=>{setTick(Date.now());if(!document.hidden)void refresh();},30000);const visible=()=>{if(!document.hidden)void refresh();};document.addEventListener('visibilitychange',visible);return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',visible);};},[refresh]);
 const run=async(action:string,p:Record<string,unknown>)=>{if(busy)throw new Error('Please wait');setBusy(true);try{const id=await command(action,p);await refresh();return id;}catch(e){setError((e as Error).message||'Save failed');throw e;}finally{setBusy(false);}};
 const liveAvailable=!!feed?.nexus&&!feed.nexusError&&!feedError&&tick-feed.nexus.asOf<120000&&tick-(feed.nexusAt||0)<120000;
 return {context,feed,error,feedError,busy,refresh,run,liveAvailable};
}
export type Competition=ReturnType<typeof useCompetition>;
