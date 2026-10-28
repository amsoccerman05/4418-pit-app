import {expect,type Page,type TestInfo} from '@playwright/test';
import {existsSync,statSync} from 'node:fs';import path from 'node:path';
import {setupOffline} from './offline-fixture';
export type Role='admin_lead'|'lead'|'student'|'readonly';
/** Existing dev/source harness, synthetic only; NOT released-artifact evidence. */
export async function setupRole(page:Page,role:Role,{canManage=false,status='FLAGGED'}:{canManage?:boolean;status?:string}={}){
 if(process.env.HANDOFF_LIVE)throw Error('Live mode is forbidden for synthetic role tests');
 const violations:string[]=[];
 const now=Date.parse('2026-10-28T12:00:00Z');
 await page.clock.setFixedTime(new Date(now));
 const f=await setupOffline(page,{now,role,canManage,beforeOpen:async({data,context})=>{
  data.pit_batteries[0].status=status;context.manual_matches_enabled=true;
  const reads=new Set(['profiles','pit_events','pit_issues','pit_batteries','pit_battery_events','pit_issue_events'].map(t=>'table/'+t));
  const writes=new Set(['rpc/pit_transition_battery','rpc/pit_update_issue','rpc/pit_report_issue','rpc/pit_competition_manage','rpc/pit_scouting_submit','rpc/pit_scouting_manage']);
  await page.route('**/*',async route=>{
   const u=new URL(route.request().url()),p=decodeURIComponent(u.pathname);
   const fail=async()=>{violations.push(route.request().url());await route.abort();};
   if(u.origin!=='http://127.0.0.1:4419')return fail();
   if(p.startsWith('/offline-fixture/')){
    const api=p.slice('/offline-fixture/'.length);
    if(api==='rpc/finance_repair_context')return route.fulfill({json:{data:{issue_id:'issue',issue_updated_at:data.pit_issues[0].updated_at,can_attach:false,links:[]},error:null}});
    if(api==='rpc/pit_scouting_context')return route.fulfill({json:{data:{can_scout:data.profiles[0].role!=='readonly',can_manage:context.can_manage,observations:[],assignments:[],picklist:[]},error:null}});
    if(reads.has(api)||api==='rpc/pit_competition_context'||api==='feed')return route.fallback();
    if(writes.has(api)){
     if(data.profiles[0].role==='readonly'||!data.profiles[0].active)return route.fulfill({json:{data:null,error:{code:'42501',message:'Synthetic view-only account'}}});
     return route.fallback();
    }
    return fail();
   }
   if(route.request().method()!=='GET')return fail();
   if(['/','/index.html','/@vite/client','/@react-refresh'].includes(p))return route.fallback();
   const candidate=path.resolve(process.cwd(),p.startsWith('/branding/')?'public'+p:'.'+p);
   if(!candidate.startsWith(process.cwd()+path.sep)||!/^\/(src|node_modules\/\.vite|node_modules\/vite|supabase\/functions|branding)\//.test(p))return fail();
   if(existsSync(candidate)&&statSync(candidate).isFile())return route.fallback();
   return fail();
  });
  await page.routeWebSocket('**',socket=>{
   const u=new URL(socket.url());
   if(u.hostname==='127.0.0.1'&&u.port==='4419'&&u.pathname==='/'){socket.send(JSON.stringify({type:'connected'}));socket.onMessage(()=>{});return;}
   violations.push(socket.url());socket.close();
  });
 }});
 expect(f.data.profiles[0].role).toBe(role);
 await expect(page.locator('.sidebar .account small')).toHaveText(role==='admin_lead'?'Admin Lead':role==='readonly'?'Read only':role);
 return {...f,violations,assertIsolated:()=>expect(violations,'No unknown outbound HTTP/WebSocket traffic').toEqual([])};
}
export async function captureRole(page:Page,info:TestInfo,name:string){
 await page.screenshot({path:info.outputPath(`${info.project.name}-${name}.png`),fullPage:true,animations:'disabled'});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
}
