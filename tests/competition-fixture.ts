import {expect,type Page} from '@playwright/test';
export async function setup(page:Page,manager=true){
 const context:any={can_manage:manager,config:{event_id:'event',team_number:4418,tba_event_key:'2026test',nexus_event_key:'demo1234',version:1},matches:[],templates:[{id:'template',name:'Student-built preflight',description:'',kind:'pre',active:true,version:1,items:[{text:'Latch check',required:true,blocking:true,area_id:null}]}],runs:[],items:[],links:[],areas:[]};
 const match={key:'2026test_qm17',label:'Q17',level:'qm',number:17,set:1,red:['4418','1619','1339'],blue:['2996','3648','4593'],alliance:'red',scheduled:1800000000000,predicted:null,actual:null,completed:false,redScore:null,blueScore:null,winner:''};
 const feed:any={eventId:'event',configured:true,configVersion:1,eventKey:'2026test',team:4418,eventName:'KCMT test fixture',matches:[match],tbaAt:Date.now(),tbaError:null,nexus:{asOf:Date.now(),nowQueuing:'Qualification 17',announcements:[],matches:[{label:'Qualification 17',status:'Now queuing',red:match.red,blue:match.blue,queue:Date.now()+600000,estimated:Date.now()+1200000,committed:null,replayOf:null}]},nexusAt:Date.now(),nexusError:null};
 const profile={id:'person',display_name:'Test Crew',role:manager?'mentor':'student',active:true};const data:any={profiles:[profile],pit_events:[{id:'event',name:'KCMT test fixture',status:'active',start_date:'2026-10-01',end_date:'2026-10-03',location:'Test only'}],pit_issues:[],pit_batteries:[{id:'battery',battery_number:'B01',status:'READY',active:true,label:'Test',notes:''}],pit_battery_events:[],pit_issue_events:[]};const calls:any[]=[];
 await page.route('**/src/client.ts',r=>r.fulfill({contentType:'application/javascript',body:`const session={user:{id:'person'},access_token:'fixture-token-person',expires_at:Math.floor(Date.now()/1000)+3600};
 const request=async(path,body,signal,headers)=>{const r=await fetch('/fixture/'+path,{method:'POST',body:JSON.stringify(body),signal,headers});return {data:await r.json(),error:null}};
 const query=(path,body)=>({signal:undefined,headers:{},select(){return this},order(){return this},range(){return this},setHeader(name,value){this.headers[name]=value;return this},abortSignal(signal){this.signal=signal;return this},then(resolve,reject){return request(path,body,this.signal,this.headers).then(resolve,reject)}});
 export const configured=true,configError='';export const supabase={auth:{onAuthStateChange(cb){queueMicrotask(()=>cb('SIGNED_IN',session));return {data:{subscription:{unsubscribe(){}}}}},async getSession(){return {data:{session},error:null}},async signOut(){return {error:null}}},from(table){return query('table/'+table,{})},rpc(name,args){return query('rpc/'+name,args)},functions:{invoke(name,args){return request('feed',args,args?.signal)}},channel(){return {on(){return this},subscribe(){return this}}},removeChannel(){}};`}));
 await page.route('**/fixture/**',async r=>{const path=new URL(r.request().url()).pathname.split('/fixture/')[1],p=r.request().postDataJSON();let result:any=null;
 if(path.startsWith('table/'))result=data[path.slice(6)]||[];
 else if(path==='feed')result=feed;
 else if(path==='rpc/pit_competition_context')result=context;
 else if(path==='rpc/pit_competition_manage'){
 calls.push(p);if(p.action==='match'){if(!p.p.match_id){context.matches.push({id:'ops',event_id:'event',match_key:match.key,battery_id:null,note:'',version:1});result='ops';}else Object.assign(context.matches[0],p.p,{version:2});}
 if(p.action==='run'){context.runs.push({id:'run',match_id:'ops',name:context.templates[0].name,kind:context.templates[0].kind,template_version:1,started_at:new Date().toISOString()});context.items.push({id:'item',run_id:'run',text:'Latch check',required:true,blocking:true,completed_at:null,completed_by:null,display_order:0,version:1});}
 if(p.action==='item')Object.assign(context.items[0],{completed_at:p.p.complete?new Date().toISOString():null,completed_by:'person',version:2});
 if(p.action==='template'){context.templates.push({...p.p,id:'new',version:1});}
 }
 await r.fulfill({json:result});});
 await page.goto('/');await expect(page.getByRole('heading',{name:'Competition dashboard'})).toBeVisible();await expect(page.getByText('Live timing unavailable — using TBA schedule',{exact:false})).toHaveCount(0);return{context,feed,data,calls};
}
export const nav=(page:Page,name:string)=>page.locator('.sidebar nav').getByRole('button',{name,exact:true}).click();
