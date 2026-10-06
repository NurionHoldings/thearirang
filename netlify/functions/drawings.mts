import {getStore,getDeployStore} from '@netlify/blobs';
import type {Config} from '@netlify/functions';
const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
const json=(v:unknown,status=200)=>new Response(JSON.stringify(v),{status,headers:{...headers,'Content-Type':'application/json'}});
const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]!));
export async function serve(req:Request,store:any,user:any){
 const p=new URL(req.url).pathname,admin=!!user?.app_metadata?.roles?.includes('admin');
 const email=String(user?.email||'').toLowerCase();
 const key='acl/'+Buffer.from(email).toString('hex');
 const grant=email?await store.get(key,{type:'json'}):null;
 const approved=!!user&&(admin||!!((user.confirmed_at||user.email_confirmed_at)&&grant?.active));
 if(req.method!=='GET'&&req.headers.get('origin')!==new URL(req.url).origin)return json({error:'요청 출처 오류'},403);
 if(p==='/drawings-api/session'){
 const manifest=approved?await store.get('current',{type:'json'}):null;
 return json({loggedIn:!!user,admin,approved,email:user?email:'',pages:manifest?.pages||0,ready:!!manifest});
 }
 if(p==='/drawings-api/grant'&&req.method==='POST'){
 if(!admin)return json({error:'관리자만 승인할 수 있습니다.'},403);
 const raw=await req.text();if(raw.length>1000)return json({error:'입력 오류'},400);
 const input=JSON.parse(raw),target=String(input.email||'').trim().toLowerCase();
 if(!/^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,30}$/.test(target)||typeof input.active!=='boolean')return json({error:'이메일 확인'},400);
 await store.setJSON('acl/'+Buffer.from(target).toString('hex'),{email:target,active:input.active,actor:user.id,at:new Date().toISOString()});return json({ok:true});
 }
 if(p==='/drawings-api/import'&&req.method==='POST'){
 if(!admin)return json({error:'관리자 전용'},403);
 if(Number(req.headers.get('content-length')||0)>5000000)return json({error:'등록 세트는 5MB 이하'},413);
 const body=await req.arrayBuffer();if(body.byteLength>5000000)return json({error:'등록 세트는 5MB 이하'},413);
 const form=await new Request(req.url,{method:'POST',headers:req.headers,body}).formData(),pdf=form.get('pdf');
 if(!(pdf instanceof File)||pdf.size>4000000)return json({error:'PDF는 4MB 이하'},400);
 const bytes=new Uint8Array(await pdf.arrayBuffer());if(Buffer.from(bytes.slice(0,5)).toString()!=='%PDF-')return json({error:'PDF 형식 오류'},400);
 const id=crypto.randomUUID();const pages:Uint8Array[]=[];
 for(let n=1;n<=9;n++){const f=form.get('page'+n);if(!(f instanceof File)||f.size>650000)return json({error:'열람 이미지 9장이 필요합니다.'},400);const b=new Uint8Array(await f.arrayBuffer());if(b[0]!==255||b[1]!==216||b[2]!==255)return json({error:'JPG 형식 오류'},400);pages.push(b)}
 await store.set(id+'/original.pdf',bytes.buffer);
 for(let n=0;n<9;n++)await store.set(id+'/page'+(n+1)+'.jpg',pages[n].buffer);
 await store.setJSON('current',{id,pages:9,actor:user.id,at:new Date().toISOString()});return json({ok:true});
 }
 if(!approved)return json({error:'승인된 계정으로 로그인하세요.'},user?403:401);
 const manifest=await store.get('current',{type:'json'});if(!manifest)return json({error:'원본 등록 전'},404);
 if(p==='/drawings-api/original.pdf'&&req.method==='GET'){
 if(!admin)return json({error:'원본 다운로드·출력은 관리자 전용입니다.'},403);
 const bytes=await store.get(manifest.id+'/original.pdf',{type:'arrayBuffer'});return new Response(bytes,{headers:{...headers,'Content-Type':'application/pdf','Content-Disposition':'attachment; filename="thearirang-original.pdf"'}});
 }
 const match=/^\/drawings-api\/page\/([1-9])$/.exec(p);
 if(match&&req.method==='GET'){
 const bytes=await store.get(manifest.id+'/page'+match[1]+'.jpg',{type:'arrayBuffer'});if(!bytes)return json({error:'페이지 없음'},404);
 const label=escape(email+' · 열람 전용 · '+new Date().toISOString().slice(0,16));
 const marks=Array.from({length:5},(_,i)=>`<text x="160" y="${150+i*180}" fill="#8a2435" fill-opacity=".4" font-size="23" transform="rotate(-12 650 ${150+i*180})">${label}</text>`).join('');
 return new Response(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1400 990"><image width="1400" height="990" preserveAspectRatio="xMidYMid meet" href="data:image/jpeg;base64,${Buffer.from(bytes).toString('base64')}"/>${marks}</svg>`,{headers:{...headers,'Content-Type':'image/svg+xml','Content-Security-Policy':"default-src 'none'; img-src data:; style-src 'none'; sandbox"}});
 }
 return json({error:'없음'},404);
}
export default async function handler(req:Request){try{
 let user=null;const jwt=req.headers.get('cookie')?.match(/(?:^|;\s*)nf_jwt=([^;]+)/)?.[1];
 const origin=Netlify.env.get('URL');if(jwt&&origin){const r=await fetch(origin+'/.netlify/identity/user',{headers:{Authorization:'Bearer '+decodeURIComponent(jwt)},signal:AbortSignal.timeout(8000)});if(r.ok)user=await r.json()}
 const options={name:'arirang-private-drawings',consistency:'strong' as const};
 const store=Netlify.env.get('CONTEXT')==='production'?getStore(options):getDeployStore(options);
 return await serve(req,store,user);
 }catch{return json({error:'요청을 처리하지 못했습니다.'},500)}}
export const config:Config={path:'/drawings-api/*'};
