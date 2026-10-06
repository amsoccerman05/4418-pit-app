export const FINANCE_ORIGIN='https://finance.frc4418.org';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function parsePoReference(value:string):string|null{
 const input=value.trim();if(uuid.test(input))return input.toLowerCase();
 try{const url=new URL(input);if(url.origin!==FINANCE_ORIGIN||url.username||url.password||url.search||url.pathname!=='/')return null;const id=url.hash.match(/^#po\/([0-9a-f-]+)$/i)?.[1];return id&&uuid.test(id)?id.toLowerCase():null;}catch{return null;}
}
export const poUrl=(id:string)=>uuid.test(id)?`${FINANCE_ORIGIN}/#po/${id.toLowerCase()}`:null;
export const PO_STATUSES={draft:'Draft',awaiting_approval:'Awaiting approval',changes_requested:'Changes requested',approved:'Approved',submitted_to_school:'Submitted to school',cancelled:'Cancelled'} as const;
export type PurchaseSummary={po_id:string;po_number:number;status:keyof typeof PO_STATUSES;requester_name:string};
export type PurchaseLink=PurchaseSummary&{linked_at:string};
export type PurchaseContext={issue_id:string;issue_updated_at:string;can_attach:boolean;links:PurchaseLink[]};
export type PurchaseCandidate=PurchaseSummary&{issue_id:string;issue_updated_at:string;can_attach:boolean};
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const validSummary=(value:unknown):boolean=>object(value)&&typeof value.po_id==='string'&&uuid.test(value.po_id)&&Number.isSafeInteger(value.po_number)&&Number(value.po_number)>0&&typeof value.status==='string'&&Object.hasOwn(PO_STATUSES,value.status)&&typeof value.requester_name==='string';
export function parsePurchaseContext(value:unknown,issueId:string):PurchaseContext|null{
 if(!object(value)||value.issue_id!==issueId||typeof value.issue_updated_at!=='string'||!Number.isFinite(Date.parse(value.issue_updated_at))||typeof value.can_attach!=='boolean'||!Array.isArray(value.links))return null;
 if(!value.links.every(link=>validSummary(link)&&object(link)&&typeof link.linked_at==='string'&&Number.isFinite(Date.parse(link.linked_at))))return null;
 if(new Set(value.links.map(link=>link.po_id)).size!==value.links.length)return null;
 return value as PurchaseContext;
}
export function parsePurchaseCandidate(value:unknown,poId:string,issueId:string):PurchaseCandidate|null{return object(value)&&validSummary(value)&&value.po_id===poId&&value.issue_id===issueId&&typeof value.issue_updated_at==='string'&&Number.isFinite(Date.parse(value.issue_updated_at))&&typeof value.can_attach==='boolean'?value as PurchaseCandidate:null;}
export function bridgeUnavailable(error:unknown){return object(error)&&['PGRST202','42883','42P01'].includes(String(error.code));}
