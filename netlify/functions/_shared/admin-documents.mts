import {randomUUID} from 'node:crypto';
const headers={'Cache-Control':'private, no-store','Netlify-CDN-Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow, noarchive','X-Content-Type-Options':'nosniff','Vary':'Cookie'};
export type Principal={actor:string,scope:string,label:string};
const text=(v:unknown,max:number)=>{if(typeof v!=='string'||v.length>max||v.includes('\u0000'))throw Error('invalid');return v;};
export function validateDocument(input:any){
 if(!input||typeof input!=='object')throw Error('invalid');
 const title=text(input.title,200),recipient=text(input.recipient,200),sender=text(input.sender,200),date=text(input.date,10),content=text(input.content,60000);
 if(date&&(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date))throw Error('invalid');
 if(!['10','11','12','13'].includes(input.fontSize)||!['yes','no'].includes(input.background))throw Error('invalid');
 return {title,recipient,sender,date,content,fontSize:input.fontSize,background:input.background};
}
type Dependencies={authorize:(req:Request)=>Promise<Principal|null>,store:()=>any};
export function createDocumentHandler({authorize,store}:Dependencies){return async(req:Request)=>{
 const json=(v:unknown,status=200,extra={})=>Response.json(v,{status,headers:{...headers,...extra}});
 try{
 const user=await authorize(req);if(!user)return json({error:'관리자 로그인이 필요합니다.'},401);
 const url=new URL(req.url);if(!/^\/admin-documents(?:\/|$)/.test(url.pathname))return json({error:'문서를 찾을 수 없습니다.'},404);const tail=url.pathname.slice('/admin-documents'.length),id=tail.slice(1),root=tail===''||tail==='/';
 if(tail==='/session'&&req.method==='GET')return json({allowed:true,label:user.label});
 if(!root&&!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id))return json({error:'문서를 찾을 수 없습니다.'},404);
 const writes=['POST','PUT'].includes(req.method);if(writes&&req.headers.get('origin')!==url.origin)return json({error:'요청 출처를 확인하세요.'},403);
 if(!['GET','POST','PUT'].includes(req.method)||(root&&req.method==='PUT')||(!root&&req.method==='POST'))return json({error:'지원하지 않는 요청입니다.'},405);
 const files=store(),prefix=user.scope+'/',key=prefix+id;
 if(root&&req.method==='GET'){
  const {blobs}=await files.list({prefix});const rows=[];
  for(let i=0;i<blobs.length;i+=20){const batch=await Promise.all(blobs.slice(i,i+20).map(async(b:any)=>{const m=await files.getMetadata(b.key);return m?{id:b.key.slice(prefix.length),title:m.metadata.title||'제목 없는 문서',updated:m.metadata.updated}:null;}));rows.push(...batch.filter(Boolean));}
  rows.sort((a:any,b:any)=>String(b.updated).localeCompare(String(a.updated)));return json({label:user.label,documents:rows});
 }
 if(req.method==='GET'){
  const item=await files.getWithMetadata(key,{type:'json'});if(!item)return json({error:'문서를 찾을 수 없습니다.'},404);
  return json({id,document:item.data.document,updated:item.data.updated,etag:item.etag});
 }
 const reader=req.body?.getReader();if(!reader)return json({error:'문서 내용이 없습니다.'},400);const parts:Uint8Array[]=[];let size=0;
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>400000){await reader.cancel();return json({error:'문서가 너무 큽니다. 본문은 6만 자 이내로 작성해 주세요.'},413);}parts.push(value);}
 let document;try{document=validateDocument(JSON.parse(Buffer.concat(parts).toString('utf8')));}catch{return json({error:'입력 형식과 본문 길이를 확인해 주세요.'},400);}
 const current=root?null:await files.getMetadata(key);if(!root&&!current)return json({error:'문서를 찾을 수 없습니다.'},404);
 if(current&&req.headers.get('if-match')!==current.etag)return json({error:'다른 창에서 수정한 문서입니다. 작성 파일을 내려받아 보관한 뒤 다시 열거나 새 문서로 저장해 주세요.'},409);
 const docId=root?randomUUID():id,updated=new Date().toISOString(),result=await files.setJSON(prefix+docId,{document,updated,actor:user.actor},{metadata:{title:document.title,updated},...(current?{onlyIfMatch:current.etag}:{onlyIfNew:true})});
 if(!result.modified)return json({error:'다른 관리자가 먼저 저장했습니다. 새 문서로 저장하거나 다시 열어 주세요.'},409);
 return json({id:docId,document,updated,etag:result.etag},root?201:200);
 }catch{return json({error:'문서를 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.'},500);}
};}
