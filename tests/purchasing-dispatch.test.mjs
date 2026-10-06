import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,existsSync} from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

// The production suite broker and installed Supabase transport execute here.
// Only the DOM/message bus, session replies, and final fetch are synthetic.
// No HTTP request, account action, or production configuration is used.
const require=createRequire(import.meta.url),root=path.resolve(import.meta.dirname,'..');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const issue='11111111-1111-4111-8111-111111111111',po='22222222-2222-4222-8222-222222222222',time='2026-10-05T10:00:00Z';
const payload={issue_id:issue,po_id:po,expected_issue_updated_at:time,reason:'Synthetic regression'};
const context={issue_id:issue,issue_updated_at:time,can_attach:true,links:[{po_id:po,po_number:17,status:'draft',requester_name:'Fixture requester',linked_at:time}]};
const session=id=>({access_token:`synthetic-token-${id}`,user:{id}});

function loadSource(file,overrides={},cache=new Map()){
 file=path.resolve(root,file);if(cache.has(file))return cache.get(file);
 const exports={};cache.set(file,exports);
 const js=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 new Function('require','exports',js)(id=>{
  if(id in overrides)return overrides[id]();
  if(!id.startsWith('.'))return require(id);
  let next=path.resolve(path.dirname(file),id);
  if(!path.extname(next))next+=existsSync(next+'.ts')?'.ts':'.tsx';
  return loadSource(next,overrides,cache);
 },exports);
 return exports;
}

async function fixture(){
 const originals=new Map(['window','document','location','history','fetch'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 const listeners=new Map(),held=[],attempts=[],sent=[];
 let hold=false,brokerSession=session('actor-A'),fetchResponse=()=>Response.json(context),currentActor='actor-A',account=new AbortController();
 const frame={contentWindow:{postMessage(message){
  assert.equal(message.method,'getSession','Only synthetic session reads are permitted');
  if(hold)held.push(message);else queueMicrotask(()=>reply(message,brokerSession));
 }}};
 const emit=(kind,value)=>{for(const fn of [...listeners.get(kind)||[]])fn(value);};
 const reply=(message,next=brokerSession)=>emit('message',{origin:'https://team.frc4418.org',source:frame.contentWindow,data:{protocol:'4418-suite-auth-v1',id:message.id,result:{data:{session:next},error:null}}});
 globalThis.location={origin:'https://pit.frc4418.org',pathname:'/',search:'',hash:`#issue/${issue}`};
 globalThis.window={opener:null,addEventListener(kind,fn){if(!listeners.has(kind))listeners.set(kind,new Set());listeners.get(kind).add(fn);},removeEventListener(kind,fn){listeners.get(kind)?.delete(fn);}};
 globalThis.document={referrer:'',createElement(){return frame;},body:{append(item){item.onload();}},addEventListener(){}};
 globalThis.history={replaceState(){}};
 globalThis.fetch=async(url,init)=>{
  assert.equal(new URL(url).hostname,'purchasing-fixture.invalid');
  const request={url:String(url),authorization:new Headers(init.headers).get('Authorization'),signal:init.signal,method:init.method,args:JSON.parse(init.body)};
  attempts.push(request);
  if(init.signal?.aborted)throw new DOMException('Synthetic fetch aborted','AbortError');
  sent.push(request);return fetchResponse(request);
 };
 const {createSuiteClient}=loadSource('src/suite-auth.ts');
 const supabase=createSuiteClient('https://purchasing-fixture.invalid','fixture-public-key');
 await supabase.auth.getSession();
 // Match App's synchronous account invalidation, independently of React commit.
 const subscription=supabase.auth.onAuthStateChange((_event,next)=>{
  const nextId=next?.user.id||null;
  if(currentActor!==nextId){account.abort();account=new AbortController();currentActor=nextId;}
 });
 await tick();
 const service=loadSource('src/purchasing/service.ts',{'../client':()=>({supabase})});
 return {
  service,supabase,attempts,sent,
  scope(){const actorId=currentActor,signal=account.signal,hash=location.hash;return {actorId,signal,isCurrent:()=>currentActor===actorId&&location.hash===hash};},
  hold(){hold=true;},
  async waitHeld(){await tick();assert.equal(held.length,1);},
  release(next=brokerSession){assert.equal(held.length,1);reply(held.shift(),next);},
  switchAccount(id){brokerSession=id?session(id):null;emit('message',{origin:'https://team.frc4418.org',source:frame.contentWindow,data:{protocol:'4418-suite-auth-v1',event:id?'SIGNED_IN':'SIGNED_OUT',session:brokerSession}});},
  setBroker(id){brokerSession=session(id);},
  navigate(hash){location.hash=hash;emit('hashchange',{});},
  respond(fn){fetchResponse=fn;},
  listeners(kind){return listeners.get(kind)?.size||0;},
  close(){subscription.data.subscription.unsubscribe();for(const message of held.splice(0))reply(message,null);for(const [key,descriptor]of originals){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}}
 };
}

async function atSecondLookup(f,scope=f.scope()){
 f.hold();const pending=f.service.attachPurchase(payload,scope);
 // Observe rejections immediately, even when the test waits before asserting.
 void pending.catch(()=>{});
 await f.waitHeld();f.release(session('actor-A'));await f.waitHeld();
 assert.equal(f.sent.length,0);return {pending,scope};
}

test('installed SDK preserves a per-call actor token through its second broker lookup',async()=>{
 const f=await fixture();try{
  const {pending}=await atSecondLookup(f);f.release(session('actor-B'));
  assert.deepEqual(await pending,context);assert.equal(f.sent.length,1);
  assert.equal(f.sent[0].authorization,'Bearer synthetic-token-actor-A');
  assert.equal(f.sent[0].method,'POST');assert.equal(new URL(f.sent[0].url).pathname,'/rest/v1/rpc/finance_attach_repair_po');
  assert.deepEqual(f.sent[0].args,{p_issue_id:issue,p_po_id:po,p_expected_issue_updated_at:time,p_reason:'Synthetic regression'});
 }finally{f.close();}
});

test('account replacement, sign-out, and same-actor return cancel a second-wait write',async()=>{
 for(const next of ['actor-B',null,'round-trip']){
  const f=await fixture();try{
   const {pending}=await atSecondLookup(f);f.switchAccount(next==='round-trip'?'actor-B':next);if(next==='round-trip')f.switchAccount('actor-A');f.release();
   await assert.rejects(pending,error=>/abort/i.test(error.message));assert.equal(f.sent.length,0);assert.equal(f.attempts.length,1);assert.equal(f.attempts[0].signal.aborted,true);
  }finally{f.close();}
 }
});

test('unmount cancellation during the second broker wait reaches the installed SDK fetch',async()=>{
 const f=await fixture();try{
  const controller=new AbortController(),scope={...f.scope(),signal:controller.signal};
  const {pending}=await atSecondLookup(f,scope);controller.abort();f.release();
  await assert.rejects(pending,error=>/abort/i.test(error.message));assert.equal(f.sent.length,0);assert.equal(f.attempts[0].signal.aborted,true);
 }finally{f.close();}
});

test('a first-lookup account mismatch never constructs a transport request',async()=>{
 const f=await fixture();try{
  f.hold();const pending=f.service.attachPurchase(payload,f.scope());void pending.catch(()=>{});await f.waitHeld();f.release(session('actor-B'));
  await assert.rejects(pending,/account changed/);assert.equal(f.attempts.length,0);
 }finally{f.close();}
});

test('leaving and reopening the repair during the second broker wait cancels the old write',async()=>{
 const f=await fixture();try{
  const before=f.listeners('hashchange'),{pending}=await atSecondLookup(f);
  f.navigate('#issues');f.navigate(`#issue/${issue}`);f.release();
  await assert.rejects(pending,error=>/abort|changed/i.test(error.message));assert.equal(f.sent.length,0);assert.equal(f.listeners('hashchange'),before);
 }finally{f.close();}
});

test('purchasing headers stay request-local and POST failures are never retried',async()=>{
 const f=await fixture();try{
  await f.service.attachPurchase(payload,f.scope());f.switchAccount('actor-B');
  await f.supabase.rpc('synthetic_unrelated_rpc',{});
  assert.deepEqual(f.sent.map(item=>item.authorization),['Bearer synthetic-token-actor-A','Bearer synthetic-token-actor-B']);
  f.respond(()=>{throw new TypeError('Synthetic connection failure');});
  await assert.rejects(f.service.attachPurchase(payload,f.scope()),error=>/Synthetic connection failure/.test(error.message));
  assert.equal(f.sent.length,3,'The non-idempotent write must not retry');
 }finally{f.close();}
});

// Execute the real component's hook callbacks in a deterministic lifecycle.
// This checks cleanup/replay and stale state writes; it is not React DOM/layout
// coverage and does not claim to reproduce the browser's event scheduling.
function componentHarness(service,scope){
 const slots=[],effects=[],changes=[];let cursor=0,tree,active=true;
 const react={
  useRef(value){const index=cursor++;return slots[index]??={current:value};},
  useState(value){const index=cursor++;if(!(index in slots))slots[index]=typeof value==='function'?value():value;return [slots[index],next=>{changes.push({active,index});slots[index]=typeof next==='function'?next(slots[index]):next;}];},
  useEffect(setup,deps){const index=cursor++,old=effects[index];if(!old||deps?.some((value,i)=>!Object.is(value,old.deps?.[i])))effects[index]={setup,deps,cleanup:old?.cleanup,pending:true};},
 };
 const jsx=(type,props,key)=>({type,props,key});
 const {PurchaseLinks}=loadSource('src/purchasing/PurchaseLinks.tsx',{
  react:()=>react,'react/jsx-runtime':()=>({jsx,jsxs:jsx}),
  'lucide-react':()=>new Proxy({},{get:()=>()=>null}),'./purchasing.css':()=>({}),'./service':()=>service,
 });
 const props={issueId:issue,issueUpdatedAt:time,editable:true,demo:false,busy:false,scope};
 const render=()=>{cursor=0;tree=PurchaseLinks(props);return tree;};
 const flush=()=>{for(const effect of effects){if(effect?.pending){effect.cleanup?.();effect.cleanup=effect.setup();effect.pending=false;}}};
 const cleanup=()=>{active=false;for(const effect of effects)effect?.cleanup?.();};
 const walk=(node,predicate)=>{if(!node||typeof node!=='object')return null;if(predicate(node))return node;for(const child of [node.props?.children].flat(Infinity)){const found=walk(child,predicate);if(found)return found;}return null;};
 render();
 return {render,flush,changes,slots,find(predicate){const found=walk(tree,predicate);assert.ok(found,'Expected element exists');return found;},
  replay(){cleanup();active=true;for(const effect of effects)if(effect)effect.cleanup=effect.setup();},unmount:cleanup};
}
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};

test('PurchaseLinks effect replay replaces its aborted controller and ignores an older refresh',async()=>{
 const requests=[],parent=new AbortController(),scope={actorId:'actor-A',signal:parent.signal,isCurrent:()=>true};
 const h=componentHarness({loadPurchaseLinks(_issue,requestScope){const result=deferred();requests.push({scope:requestScope,...result});return result.promise;}},scope);
 h.flush();assert.equal(requests.length,1);assert.equal(requests[0].scope.signal.aborted,false);
 h.replay();assert.equal(requests.length,2);assert.equal(requests[0].scope.signal.aborted,true);assert.equal(requests[1].scope.signal.aborted,false);
 const latest={...context,links:[]};requests[1].resolve(latest);await tick();assert.equal(h.slots[0],latest);
 requests[0].resolve(context);await tick();assert.equal(h.slots[0],latest,'The old refresh cannot overwrite the replayed refresh');
 parent.abort();assert.equal(requests[1].scope.signal.aborted,true);h.unmount();
});

test('PurchaseLinks unmount aborts a pending attach and ignores its late successful response',async()=>{
 const pending=deferred(),parent=new AbortController();let attachedScope;
 const h=componentHarness({
  loadPurchaseLinks:async()=>({...context,links:[]}),
  previewPurchase:async()=>({...context.links[0],issue_id:issue,issue_updated_at:time,can_attach:true}),
  attachPurchase(_payload,scope){attachedScope=scope;return pending.promise;},
 },{actorId:'actor-A',signal:parent.signal,isCurrent:()=>true});
 h.flush();await tick();h.render();
 h.find(node=>node.type==='input').props.onChange({target:{value:po}});h.render();
 h.find(node=>node.type==='form').props.onSubmit({preventDefault(){}});await tick();h.render();
 h.find(node=>node.type==='textarea').props.onChange({target:{value:'Synthetic reason'}});h.render();
 h.find(node=>node.type==='button'&&node.props.children==='Link this purchase order').props.onClick();
 assert.ok(attachedScope);assert.equal(attachedScope.signal.aborted,false);h.unmount();assert.equal(attachedScope.signal.aborted,true);
 const writes=h.changes.length;pending.resolve(context);await tick();assert.equal(h.changes.length,writes,'No state setter runs after unmount');
});

test('the App account-controller effect resets after replay and aborts on final cleanup',()=>{
 // Extract, rather than duplicate, the actual two declarations being checked.
 const source=ts.createSourceFile('main.tsx',readFileSync(path.join(root,'src/main.tsx'),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const app=source.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='App');
 const declaration=app.body.statements.find(node=>ts.isVariableStatement(node)&&node.declarationList.declarations.some(item=>item.name.getText(source)==='appLive'));
 assert.ok(declaration);const index=app.body.statements.indexOf(declaration),effect=app.body.statements[index+1];
 const code=ts.transpileModule(declaration.getText(source)+'\n'+effect.getText(source)+'\nreturn {appLive,accountRequests};',{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 let setup;const refs=new Function('useRef','useEffect',code)(value=>({current:value}),fn=>{setup=fn;});
 let cleanup=setup();const original=refs.accountRequests.current;cleanup();assert.equal(refs.appLive.current,false);assert.equal(original.signal.aborted,true);
 cleanup=setup();assert.equal(refs.appLive.current,true);assert.notEqual(refs.accountRequests.current,original);assert.equal(refs.accountRequests.current.signal.aborted,false);
 cleanup();assert.equal(refs.appLive.current,false);assert.equal(refs.accountRequests.current.signal.aborted,true);
});
