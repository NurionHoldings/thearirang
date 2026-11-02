const MAX_BYTES=3*1024*1024,KEY='floor1/current.pdf';
const headers={'Cache-Control':'private, no-store','Netlify-CDN-Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex, nofollow, noarchive','Vary':'Cookie'};
type Dependencies={authorize:(req:Request)=>Promise<string>,store:()=>any,seed?:()=>Promise<Uint8Array|null>,seedRevision?:string};
export function createProposalHandler({authorize,store,seed,seedRevision='initial-v1'}:Dependencies){return async(req:Request)=>{
 const json=(value:unknown,status=200,extra:Record<string,string>={})=>Response.json(value,{status,headers:{...headers,...extra}});
 try{
  const actor=await authorize(req);if(!actor)return json({error:'총괄관리자 또는 1층 관리자 로그인이 필요합니다.'},403);
  const path=new URL(req.url).pathname,download=path==='/private-opening-proposal/download';
  if(path!=='/private-opening-proposal'&&!download)return json({error:'요청한 자료가 없습니다.'},404);
  if(!['GET','HEAD','PUT'].includes(req.method)||(download&&req.method==='PUT'))return json({error:'지원하지 않는 요청입니다.'},405,{'Allow':download?'GET, HEAD':'GET, HEAD, PUT'});
  const blobs=store();
  if(req.method==='PUT'){
   if(req.headers.get('origin')!==new URL(req.url).origin)return json({error:'요청 출처를 확인하세요.'},403);
   if(req.headers.get('content-type')?.split(';')[0]!=='application/pdf')return json({error:'PDF 파일만 등록할 수 있습니다.'},415);
   const length=req.headers.get('content-length');if(length&&Number(length)>MAX_BYTES)return json({error:'파일은 3MB 이하여야 합니다.'},413);
   // Bound the streamed input even when Content-Length is omitted or incorrect.
   const reader=req.body?.getReader();if(!reader)return json({error:'PDF 파일이 없습니다.'},400);
   const chunks:Uint8Array[]=[];let size=0;
   while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_BYTES){await reader.cancel();return json({error:'파일은 3MB 이하여야 합니다.'},413);}chunks.push(value);}
   const bytes=Buffer.concat(chunks);if(bytes.length<8||bytes.subarray(0,5).toString()!=='%PDF-')return json({error:'올바른 PDF 파일을 선택하세요.'},400);
   const current=await blobs.getMetadata(KEY),expected=req.headers.get('if-match');
   if(current&&expected!==current.etag)return json({error:'문서가 변경되었습니다. 새로고침 후 다시 등록하세요.'},409);
   if(!current&&expected)return json({error:'문서 상태가 변경되었습니다. 새로고침해 주세요.'},409);
   const updated=new Date().toISOString();const result=await blobs.set(KEY,bytes,{metadata:{updated,actor,size:bytes.length},...(current?{onlyIfMatch:current.etag}:{onlyIfNew:true})});
   if(!result.modified)return json({error:'다른 관리자가 등록했습니다. 새로고침 후 확인하세요.'},409);
   return json({available:true,updated,size:bytes.length,etag:result.etag},201);
  }
  // Refresh only the original generated seed; preserve administrator-uploaded PDFs.
  if(seed){const existing=await blobs.getMetadata(KEY);const outdated=existing?.metadata.actor==='encrypted-initial-proposal'&&existing.metadata.seedRevision!==seedRevision;
   if(!existing||outdated){const initial=await seed();if(initial)await blobs.set(KEY,initial,{...(existing?{onlyIfMatch:existing.etag}:{onlyIfNew:true}),metadata:{updated:new Date().toISOString(),actor:'encrypted-initial-proposal',seedRevision,size:initial.byteLength}});}
  }
  const current=download?await blobs.getWithMetadata(KEY,{type:'arrayBuffer'}):await blobs.getMetadata(KEY);
  if(!current)return download?json({error:'아직 등록된 제안서가 없습니다.'},404):json({available:false});
  if(!download)return req.method==='HEAD'?new Response(null,{headers}):json({available:true,updated:current.metadata.updated,size:current.metadata.size,etag:current.etag});
  const filename='1층_반값마트_개점준비_제안서.pdf';
  return new Response(req.method==='HEAD'?null:current.data,{headers:{...headers,'Content-Type':'application/pdf','Content-Disposition':`attachment; filename="floor1-opening-proposal.pdf"; filename*=UTF-8''${encodeURIComponent(filename)}`,'Content-Security-Policy':"sandbox; default-src 'none'; frame-ancestors 'none'"}});
 }catch{return json({error:'문서를 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.'},500);}
};}
