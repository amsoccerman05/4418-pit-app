import {supabase} from '../client';
import {parsePurchaseContext,parsePurchaseCandidate} from './model';
export type PurchasingScope={actorId:string;isCurrent:()=>boolean;signal:AbortSignal};
function checkScope(scope:PurchasingScope){if(scope.signal.aborted||!scope.isCurrent())throw new Error('Purchasing view changed');}
async function scopedRpc(name:string,args:Record<string,unknown>,scope:PurchasingScope){
 const viewRequest=new AbortController(),signal=AbortSignal.any([scope.signal,viewRequest.signal]);
 const requestScope={...scope,signal};
 const leave=()=>{if(!scope.isCurrent())viewRequest.abort();};
 if(typeof window!=='undefined')window.addEventListener('hashchange',leave);
 try{
  checkScope(requestScope);if(!supabase)throw new Error('Purchasing connection unavailable');
  const {data,error}=await supabase.auth.getSession();
  checkScope(requestScope);
  if(error||!data.session?.access_token||data.session.user.id!==scope.actorId)throw new Error('Purchasing account changed');
  // Pin the reviewed actor through the SDK's second broker wait. A route that
  // was abandoned stays cancelled even if the same repair is reopened.
  return await supabase.rpc(name,args).setHeader('Authorization',`Bearer ${data.session.access_token}`).abortSignal(signal);
 }finally{if(typeof window!=='undefined')window.removeEventListener('hashchange',leave);}
}
export async function loadPurchaseLinks(issueId:string,scope:PurchasingScope){
 const {data,error}=await scopedRpc('finance_repair_context',{p_issue_id:issueId},scope);if(error)throw error;
 const context=parsePurchaseContext(data,issueId);if(!context)throw new Error('Unexpected purchasing response');return context;
}
export async function previewPurchase(issueId:string,poId:string,scope:PurchasingScope){
 const {data,error}=await scopedRpc('finance_repair_po_candidate',{p_issue_id:issueId,p_po_id:poId},scope);if(error)throw error;
 const candidate=parsePurchaseCandidate(data,poId,issueId);if(!candidate)throw new Error('Unexpected purchase order response');return candidate;
}
export async function attachPurchase(payload:{issue_id:string;po_id:string;expected_issue_updated_at:string;reason:string},scope:PurchasingScope){
 const {data,error}=await scopedRpc('finance_attach_repair_po',{p_issue_id:payload.issue_id,p_po_id:payload.po_id,p_expected_issue_updated_at:payload.expected_issue_updated_at,p_reason:payload.reason},scope);if(error)throw error;
 const context=parsePurchaseContext(data,payload.issue_id);if(!context||!context.links.some(link=>link.po_id===payload.po_id))throw new Error('Unconfirmed purchase link');return context;
}
