import {getStore,getDeployStore} from '@netlify/blobs';
import {initial,validateZone,decodeFile,text,date,Problem} from './_shared/project.mjs';
import {aiStore,publicJob,queueAI,aiReady} from './_shared/ai.mjs';
import type {Config} from '@netlify/functions';
async function withAI(project:ReturnType<typeof initial>){const jobs=aiStore();await Promise.all(Object.entries(project.zones).map(async([id,zone])=>{const job=await jobs.getWithMetadata(id,{type:'json'});(zone as any).ai=publicJob(job?.data,zone)}));return project}
const json=(v:unknown,status=200)=>new Response(JSON.stringify(v),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
export default async function handler(req:Request){
 try{
 const path=new URL(req.url).pathname;
 // Validate with Identity's user endpoint; never trust a decoded JWT or user-editable metadata.
 const jwt=req.headers.get('cookie')?.match(/(?:^|;\s*)nf_jwt=([^;]+)/)?.[1];
 let actor='';
 if(jwt){const origin=Netlify.env.get('URL');if(origin){const r=await fetch(origin+'/.netlify/identity/user',{headers:{Authorization:'Bearer '+decodeURIComponent(jwt)}});if(r.ok){const user=await r.json();if(user.app_metadata?.roles?.includes('admin'))actor=user.id}}}
 const admin=!!actor;
 if(path==='/api/session')return json({admin,csrf:'',identity:true,aiReady:aiReady()});
 if(path==='/api/project'&&!admin)return json(initial());
 if(!admin)throw new Problem('관리자 계정으로 로그인하세요.',401);
 if(req.method!=='GET'&&req.headers.get('origin')!==new URL(req.url).origin)throw new Problem('요청 출처를 확인하세요.',403);
 const preview=Netlify.env.get('CONTEXT')!=='production';
 const store=preview?getDeployStore({name:'arirang-project',consistency:'strong'}):getStore({name:'arirang-project',consistency:'strong'});
 const files=preview?getDeployStore({name:'arirang-files',consistency:'strong'}):getStore({name:'arirang-files',consistency:'strong'});
 if(path.startsWith('/uploads/')){const name=path.slice(9);if(!/^[\w-]+\.(jpg|png|webp|pdf)$/.test(name))throw new Problem('파일 없음',404);const file=await files.getWithMetadata(name,{type:'arrayBuffer'});if(!file)throw new Problem('파일 없음',404);return new Response(file.data,{headers:{'Content-Type':String(file.metadata.mime),'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}})}
 let current=await store.getWithMetadata('project',{type:'json'});
 if(!current){await store.setJSON('project',initial(),{onlyIfNew:true});current=await store.getWithMetadata('project',{type:'json'})}
 if(!current)throw new Problem('저장소 초기화 실패',503);
 const project=current.data as ReturnType<typeof initial>;
 if(path==='/api/project'&&req.method==='GET')return json(await withAI(project));
 const aiMatch=/^\/api\/(ai|ai-status)\/(b1|1|2a|2b|3|4|5)$/.exec(path);
 if(aiMatch){const [,action,id]=aiMatch;if(action==='ai-status'&&req.method==='GET'){const job=await aiStore().getWithMetadata(id,{type:'json'});return json(publicJob(job?.data,project.zones[id]))}if(action==='ai'&&req.method==='POST'){const raw=await req.text();if(raw.length>1000)throw new Problem('AI 요청 형식 오류');const input=JSON.parse(raw);if(input.version!==project.version)throw new Problem('다른 관리자가 수정했습니다. 새로고침 후 다시 실행하세요.',409);return json(await queueAI(id,project.zones[id],input.mode,new URL(req.url).origin,actor),202)}throw new Problem('잘못된 요청',404)}
 const match=/^\/api\/(zone|photo|quote)\/(b1|1|2a|2b|3|4|5)$/.exec(path);
 if(!match||req.method!==(match[1]==='zone'?'PUT':'POST'))throw new Problem('잘못된 요청',404);
 if(Number(req.headers.get('content-length')||0)>4500000)throw new Problem('파일은 3MB 이하여야 합니다.',413);
 const raw=await req.text();if(raw.length>4500000)throw new Problem('파일은 3MB 이하여야 합니다.',413);
 const input=JSON.parse(raw);if(input.version!==project.version)throw new Problem('다른 관리자가 수정했습니다. 새로고침 후 다시 저장하세요.',409);
 const [,action,id]=match;const zone=project.zones[id];let uploaded='';
 if(action==='zone')Object.assign(zone,validateZone(input));
 else{
 const quote=action==='quote',f=decodeFile(quote?input.content:input.image,quote);uploaded=crypto.randomUUID()+'.'+f.ext;
 const entry=quote?{name:text(input.name,150,'파일명',true),url:'/uploads/'+uploaded}: {date:date(input.date),note:text(input.note,1000,'작업 내용',true),kind:text(input.kind,10,'사진 구분'),viewpoint:text(input.viewpoint,100,'촬영 위치',true),url:'/uploads/'+uploaded};
 if(!quote&&(!['before','during','after'].includes(input.kind)||!input.date))throw new Problem('사진 구분·날짜를 확인하세요.');
 await files.set(uploaded,f.bytes.buffer.slice(f.bytes.byteOffset,f.bytes.byteOffset+f.bytes.byteLength),{metadata:{mime:f.mime}});(quote?zone.quotes:zone.records).push(entry);
 }
 project.version++;project.audit=[...(project.audit||[]),{at:new Date().toISOString(),actor,zone:id,action}].slice(-500);
 const result=await store.setJSON('project',project,{onlyIfMatch:current.etag});
 if(!result.modified){if(uploaded)await files.delete(uploaded);throw new Problem('다른 관리자가 수정했습니다. 새로고침 후 다시 저장하세요.',409)}
 return json(await withAI(project));
 }catch(e){if(e instanceof Problem)return json({error:e.message},e.status);console.error('Arirang API failure',e instanceof Error?e.name:'unknown');return json({error:'저장 요청을 처리하지 못했습니다. 연결과 입력을 확인하세요.'},500)}
}
export const config:Config={path:['/api/*','/uploads/*']};
