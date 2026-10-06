const issueRoute=/^#issue\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
export function issueRouteId(hash:string){return hash.match(issueRoute)?.[1].toLowerCase()||null;}
export function isIssueRoute(hash:string){return hash.startsWith('#issue/');}

export function canDismissCompletedEditor(startEditor:unknown,currentEditor:unknown,startHash:string,currentHash:string){return startEditor===currentEditor&&startHash===currentHash;}
