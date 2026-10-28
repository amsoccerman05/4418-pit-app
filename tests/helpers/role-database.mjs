// Disposable synthetic Pit-only fixture. Hub owns the shared role CHECK/positions
// migration; this harness models its literal profile/position contract, not its SQL.
import {readFileSync} from 'node:fs';
export const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
export const literal=x=>`'${String(x).replaceAll("'","''")}'`;
export const json=x=>`${literal(JSON.stringify(x))}::jsonb`;
export const actor=n=>`reset role;select set_config('request.jwt.claim.sub',${literal(n?id(n):'')},false);set role ${n?'authenticated':'anon'};`;
export const adapter='20261028160506_pit_admin_lead_role_adapter.sql';
export const migrations=['202609090001_pit_operations.sql','202610010001_competition_operations.sql','20261009042627_manual_practice_matches.sql','20261010013034_competition_scouting.sql','20261010142916_scouting_driver_station_assignments.sql','20261010172105_match13_shared_prediction_cache.sql'];
export const migration=name=>readFileSync(new URL(`../../supabase/migrations/${name}`,import.meta.url),'utf8');
export const bootstrap=`create role anon;create role authenticated;create role service_role;create schema auth;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;
create table public.profiles(id uuid primary key,display_name text,role text,active boolean);
create table public.areas(id uuid primary key,name text,active boolean);
create table public.team_positions(key text primary key,category text,active boolean);
create table public.team_member_positions(user_id uuid,position_key text,revoked_at timestamptz);
insert into public.profiles values ${[[1,'mentor',true],[2,'admin_lead',true],[3,'lead',true],[4,'student',true],[5,'readonly',true],[6,'admin_lead',false],[7,'admin',true],[8,'admin_lead',true],[9,'guest',true]].map(([n,r,a])=>`('${id(n)}','Synthetic ${r} ${n}','${r}',${a})`).join(',')};
insert into public.team_positions values('functional','Functional Leads',true),('unprivileged','Members',true);
insert into public.team_member_positions values('${id(2)}','functional',null),('${id(3)}','functional',null),('${id(4)}','functional',null),('${id(5)}','functional',null),('${id(8)}','unprivileged',null);`;
export const seed=`insert into public.pit_events(id,name,start_date,end_date,status,created_by) values('${id(100)}','Synthetic role event','2026-10-28','2026-10-30','active','${id(1)}');
insert into public.pit_batteries(id,battery_number,label,status) values('${id(101)}','B01','Synthetic battery','READY');
insert into public.pit_issues(id,event_id,title,subsystem,severity,description,reported_by) values('${id(102)}','${id(100)}','Synthetic issue','Drivetrain','LOW','Synthetic only','${id(1)}');
insert into public.pit_event_config(event_id,team_number,tba_event_key,updated_by) values('${id(100)}',4418,'2026test','${id(1)}');
insert into public.pit_checklist_templates(id,name,kind,items,updated_by) values('${id(103)}','Synthetic checklist','pre','[{"text":"Latch check","required":true,"blocking":true,"area_id":null}]','${id(1)}');
insert into public.pit_checklist_runs(id,event_id,template_id,template_version,name,kind,started_by) values('${id(104)}','${id(100)}','${id(103)}',1,'Synthetic checklist','pre','${id(1)}');
insert into public.pit_checklist_run_items(id,run_id,text,display_order,required,blocking) values('${id(105)}','${id(104)}','Latch check',0,true,true);`;
export const report=(n=200)=>({id:id(n),event_id:id(100),kind:'pit',team_number:4418,match_key:null,data:{schema_version:1,drive:'swerve',intake:'both',capacity:30,traversal:'trench',climb:'L2',auto_notes:'Two paths',notes:'Synthetic only'}});
export const assignment=()=>({event_id:id(100),kind:'pit',team_number:4418,match_key:null,assignee_id:id(1),notes:'Synthetic only',version:0});
export const snapshot=`select jsonb_build_object(${['pit_events','pit_issues','pit_issue_events','pit_batteries','pit_battery_events','pit_match_ops','pit_checklist_templates','pit_checklist_runs','pit_checklist_run_items','pit_manual_match_events','pit_scouting_observations','pit_scouting_assignments','pit_scouting_picklist','pit_scouting_management_events'].map(t=>`'${t}',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from public.${t} t)`).join(',')},'receipts',(select coalesce(jsonb_agg(to_jsonb(r) order by id),'[]') from pit_private.scouting_receipts r)) state`;
export async function install(query,{includeAdapter=true}={}){await query(bootstrap);for(const name of migrations)await query(migration(name));await query(seed);if(includeAdapter)await query(migration(adapter));}
