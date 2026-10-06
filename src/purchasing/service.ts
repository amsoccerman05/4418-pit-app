import {supabase} from '../client';
import {parsePurchaseContext,parsePurchaseCandidate} from './model';
export async function loadPurchaseLinks(issueId:string){
 if(!supabase)throw new Error('Purchasing connection unavailable');
 const {data,error}=await supabase.rpc('finance_repair_context',{p_issue_id:issueId});if(error)throw error;
 const context=parsePurchaseContext(data,issueId);if(!context)throw new Error('Unexpected purchasing response');return context;
}
export async function previewPurchase(issueId:string,poId:string){
 if(!supabase)throw new Error('Purchasing connection unavailable');
 const {data,error}=await supabase.rpc('finance_repair_po_candidate',{p_issue_id:issueId,p_po_id:poId});if(error)throw error;
 const candidate=parsePurchaseCandidate(data,poId,issueId);if(!candidate)throw new Error('Unexpected purchase order response');return candidate;
}
export async function attachPurchase(payload:{issue_id:string;po_id:string;expected_issue_updated_at:string;reason:string}){
 if(!supabase)throw new Error('Purchasing connection unavailable');
 const {data,error}=await supabase.rpc('finance_attach_repair_po',{p_issue_id:payload.issue_id,p_po_id:payload.po_id,p_expected_issue_updated_at:payload.expected_issue_updated_at,p_reason:payload.reason});if(error)throw error;
 const context=parsePurchaseContext(data,payload.issue_id);if(!context||!context.links.some(link=>link.po_id===payload.po_id))throw new Error('Unconfirmed purchase link');return context;
}
