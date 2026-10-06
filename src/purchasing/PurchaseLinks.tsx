import {useEffect,useRef,useState} from 'react';
import {ExternalLink,Link2,RefreshCw} from 'lucide-react';
import {FINANCE_ORIGIN,PO_STATUSES,bridgeUnavailable,parsePoReference,poUrl,type PurchaseContext,type PurchaseCandidate} from './model';
import {loadPurchaseLinks,previewPurchase,attachPurchase} from './service';
import './purchasing.css';
function Summary({po}:{po:PurchaseCandidate|PurchaseContext['links'][number]}){
 return <div className="repair-po-summary"><div><strong>PO #{po.po_number}</strong><span className="badge neutral">{PO_STATUSES[po.status]}</span></div><p>PO requester: {po.requester_name.trim()||'Team member'}</p><a href={poUrl(po.po_id)!} target="_blank" rel="noopener noreferrer">Open in Finance<ExternalLink size={14} aria-hidden="true"/></a></div>;
}
export function PurchaseLinks({issueId,issueUpdatedAt,editable,demo,busy:parentBusy}:{issueId:string;issueUpdatedAt:string;editable:boolean;demo:boolean;busy:boolean}){
 const [context,setContext]=useState<PurchaseContext|null>(null),[candidate,setCandidate]=useState<PurchaseCandidate|null>(null),[reference,setReference]=useState(''),[reason,setReason]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[unavailable,setUnavailable]=useState(false),[uncertain,setUncertain]=useState(false);
 const epoch=useRef(0),inflight=useRef(false),mounted=useRef(true);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;epoch.current++;};},[]);
 async function refresh(){
  if(demo||inflight.current)return;const version=++epoch.current;setBusy(true);setError('');setCandidate(null);
  try{const next=await loadPurchaseLinks(issueId);if(mounted.current&&version===epoch.current){setContext(next);setUnavailable(false);setUncertain(false);}}
  catch(e){if(mounted.current&&version===epoch.current){setContext(null);setUnavailable(bridgeUnavailable(e));setError(bridgeUnavailable(e)?'Purchasing links are not available in this workspace yet.':'Purchase links could not be loaded. Refresh before continuing.');}}
  finally{if(mounted.current&&version===epoch.current)setBusy(false);}
 }
 useEffect(()=>{setCandidate(null);setContext(null);setReference('');setReason('');setNotice('');setUncertain(false);void refresh();},[issueId,issueUpdatedAt,demo]);
 async function preview(){
  const id=parsePoReference(reference);if(!id||busy||parentBusy||inflight.current)return;inflight.current=true;setBusy(true);setError('');setCandidate(null);const version=epoch.current;
  try{const result=await previewPurchase(issueId,id);if(mounted.current&&version===epoch.current){if(Date.parse(result.issue_updated_at)!==Date.parse(issueUpdatedAt))setError('This repair changed. Refresh the repair workspace and review its current details before linking.');else setCandidate(result);}}
  catch{if(mounted.current&&version===epoch.current)setError('This purchase order is unavailable to your account. Check the Finance link or ask its requester.');}
  finally{inflight.current=false;if(mounted.current&&version===epoch.current)setBusy(false);}
 }
 async function attach(){
  if(!context||!candidate?.can_attach||!editable||!reason.trim()||busy||parentBusy||inflight.current||uncertain)return;
  inflight.current=true;setBusy(true);setError('');setNotice('');const version=epoch.current;
  try{const next=await attachPurchase({issue_id:issueId,po_id:candidate.po_id,expected_issue_updated_at:issueUpdatedAt,reason:reason.trim()});if(mounted.current&&version===epoch.current){setContext(next);setCandidate(null);setReference('');setReason('');setNotice('Purchase order linked. Repair status and purchase approvals are unchanged.');}}
  catch{if(mounted.current&&version===epoch.current){setUncertain(true);setCandidate(null);setError('The link was not confirmed. Refresh purchase links before trying again. The request may already have completed.');}}
  finally{inflight.current=false;if(mounted.current&&version===epoch.current)setBusy(false);}
 }
 return <section className="repair-purchasing" aria-label="Repair purchasing"><div className="repair-po-heading"><h3><Link2 size={18} aria-hidden="true"/>Purchasing</h3>{!demo&&<button type="button" disabled={busy||parentBusy} onClick={()=>void refresh()}><RefreshCw size={14} aria-hidden="true"/>Refresh links</button>}</div>
  <p className="form-help">Follow related purchase requests here. Submitted to school does not mean ordered, received, or installed. Repair status is managed separately.</p>
  {demo?<p className="form-help">Purchasing links are unavailable in the local demo. No Finance data is loaded.</p>:<>
   {busy&&<p role="status">{candidate?'Linking purchase order…':'Loading purchase links…'}</p>}{error&&<p className="error" role="alert">{error}</p>}{notice&&<p className="notice" role="status">{notice}</p>}
   {context&&<><div className="repair-po-list">{context.links.map(link=><Summary key={link.po_id} po={link}/>)}</div>{!context.links.length&&<p className="form-help">No purchase orders visible here.</p>}
    {editable&&context.can_attach&&!unavailable&&<form className="repair-po-form" onSubmit={event=>{event.preventDefault();void preview();}}><label>Existing Finance PO link or ID<input value={reference} disabled={busy||parentBusy||uncertain} onChange={event=>{setReference(event.target.value);setCandidate(null);setError('');}} placeholder="https://finance.frc4418.org/#po/…"/></label><button type="submit" disabled={busy||parentBusy||uncertain||!parsePoReference(reference)}>Review purchase order</button>
     {candidate&&<div className="repair-po-review"><Summary po={candidate}/>{candidate.can_attach?<><label>Why is this PO related to the repair?<textarea rows={2} maxLength={2000} required value={reason} disabled={busy||parentBusy} onChange={event=>setReason(event.target.value)}/></label><button type="button" className="primary" disabled={busy||parentBusy||uncertain||!reason.trim()} onClick={()=>void attach()}>Link this purchase order</button></>:<p className="form-help">Linking requires repair-management access and the PO requester or Finance administrator.</p>}</div>}
    </form>}
   </>}
   <a className="repair-po-workspace" href={`${FINANCE_ORIGIN}/#orders`} target="_blank" rel="noopener noreferrer">Open Finance workspace<ExternalLink size={14} aria-hidden="true"/></a>
  </>}
 </section>;
}
