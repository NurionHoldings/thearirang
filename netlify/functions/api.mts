import {documentSession} from './_shared/document-access.mjs';
import {ownSubmissions,submitDocument} from './_shared/document-submissions.mjs';
import {identityAdmin,floorSession,assertFloor} from './_shared/floor-access.mjs';
import {validateCAD} from './_shared/cad.mjs';
import {diaryStore,decodeDiary,publicDiary,prepareDiary,dispatchDiary} from './_shared/diary.mjs';
import {getStore,getDeployStore} from '@netlify/blobs';
import {initial,publicProject,reviewDiary,validateZone,decodeFile,text,date,Problem} from './_shared/project.mjs';
import {aiStore,publicJob,queueAI,aiReady} from './_shared/ai.mjs';
import {listImageRequests,createImageRequests} from './_shared/image-requests.mjs';
import type {Config} from '@netlify/functions';
async function withAI(project:ReturnType<typeof initial>){const jobs=aiStore();await Promise.all(Object.entries(project.zones).map(async([id,zone])=>{const job=await jobs.getWithMetadata(id,{type:'json'});(zone as any).ai=publicJob(job?.data,zone);for(const diary of zone.diaries||[]){const saved=await diaryStore().getWithMetadata(diary.id,{type:'json'});if(saved)Object.assign(diary,publicDiary(saved.data))}}));return project}
const json=(v:unknown,status=200)=>new Response(JSON.stringify(v),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
export default async function handler(req:Request){
 try{
 const path=new URL(req.url).pathname;
 const uploadRoute=/^\/api\/document-upload\/(b1|1|2a|2b|3|4|5)$/.exec(path),documentPortal=!!uploadRoute||path==='/api/document-submissions';
 const uploader=documentPortal?await documentSession(req):null;
 const owner=documentPortal?'':await identityAdmin(req),floor=documentPortal||owner?null:await floorSession(req);
 const actor=owner||floor?.actor||'',allowed=floor?.zones||null,admin=!!actor;
 const view=async(project:any)=>{if(!admin)return publicProject(project);if(!allowed)return withAI(project);const scoped={...project,zones:Object.fromEntries(Object.entries(project.zones).filter(([id])=>allowed.includes(id))),audit:(project.audit||[]).filter((a:any)=>allowed.includes(a.zone))};return {...publicProject(project),...await withAI(scoped),zones:{...publicProject(project).zones,...scoped.zones}}};
 if(path==='/api/session')return json({admin:!!owner,floorAdmin:!!floor,zones:allowed,csrf:'',identity:true,aiReady:aiReady()});
 const publicRead=path==='/api/project'&&req.method==='GET';
 if(!admin&&!publicRead&&!uploader)throw new Problem('관리자 계정으로 로그인하세요.',401);
 if(req.method!=='GET'&&req.headers.get('origin')!==new URL(req.url).origin)throw new Problem('요청 출처를 확인하세요.',403);
 const preview=Netlify.env.get('CONTEXT')!=='production';
 const store=preview?getDeployStore({name:'arirang-project',consistency:'strong'}):getStore({name:'arirang-project',consistency:'strong'});
 const files=preview?getDeployStore({name:'arirang-files',consistency:'strong'}):getStore({name:'arirang-files',consistency:'strong'});
 let current=await store.getWithMetadata('project',{type:'json'});
 if(!current){await store.setJSON('project',initial(),{onlyIfNew:true});current=await store.getWithMetadata('project',{type:'json'})}
 if(!current)throw new Problem('저장소 초기화 실패',503);
 const project=current.data as ReturnType<typeof initial>;
 if(documentPortal){
 if(!uploader)throw new Problem('자료등록 전용 비밀번호로 로그인하세요.',401);
 if(path==='/api/document-submissions'&&req.method==='GET')return json(ownSubmissions(project));
 if(!uploadRoute||req.method!=='POST')throw new Problem('자료등록 전용 요청을 확인하세요.',405);
 const raw=await req.text();if(raw.length>4500000)throw new Problem('파일은 3MB 이하여야 합니다.',413);
 return json(await submitDocument(project,current,store,files,uploadRoute[1],JSON.parse(raw)),201);
 }
 // Enforce scope on the server for every floor-scoped operation, including private files.
 if(allowed){
 const direct=/^\/api\/(?:cad|zone|photo|quote|contract|diary|diary-review|image-result|image-requests|ai|ai-status)\/(b1|1|2a|2b|3|4|5)(?:\/|$)/.exec(path);if(direct)assertFloor(allowed,direct[1]);
 const retryID=/^\/api\/diary-retry\/(.+)$/.exec(path)?.[1];if(retryID){const zone=Object.entries(project.zones).find(([,z])=>z.diaries?.some(d=>d.id===retryID))?.[0];if(!zone)throw new Problem('일지 없음',404);assertFloor(allowed,zone);}
 if(path.startsWith('/uploads/')){let permitted=false;for(const id of allowed){const z:any=project.zones[id];if(!z)continue;const references=[...(z.records||[]),...(z.quotes||[]),...(z.contracts||[]),...((z as any).designs||[]),...(z.diaries||[])];if(references.some(r=>r.url===path))permitted=true;const job=await aiStore().getWithMetadata(id,{type:'json'});if(job?.data.image?.url===path)permitted=true;const related=await listImageRequests(id,z);if(related.some((r:any)=>r.image?.url===path))permitted=true;}if(!permitted)throw new Problem('담당 층의 파일만 이용할 수 있습니다.',403);}
 }
 if(path.startsWith('/uploads/')){const name=path.slice(9);if(!/^[\w-]+\.(jpg|png|webp|pdf|txt)$/.test(name))throw new Problem('파일 없음',404);const file=await files.getWithMetadata(name,{type:'arrayBuffer'});if(!file)throw new Problem('파일 없음',404);return new Response(file.data,{headers:{'Content-Type':String(file.metadata.mime),'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','X-Frame-Options':'SAMEORIGIN','Content-Security-Policy':"frame-ancestors 'self'"}})}
 if(path==='/api/project'&&req.method==='GET')return json(await view(project));
 const cadMatch=/^\/api\/cad\/(b1|1|2a|2b|3|4|5)$/.exec(path);
 if(cadMatch){const id=cadMatch[1];if(req.method==='GET')return json({version:project.version,cad:(project.zones[id] as any).cad||null});if(req.method!=='PUT')throw new Problem('잘못된 요청',404);const raw=await req.text();if(raw.length>500000)throw new Problem('도면은 500개 요소 이내로 작성하세요.',413);const input=JSON.parse(raw);if(input.version!==project.version)throw new Problem('다른 관리자가 수정했습니다. 도면을 내려받아 보관한 뒤 다시 불러오세요.',409);(project.zones[id] as any).cad=validateCAD(input.cad);project.version++;project.audit=[...(project.audit||[]),{at:new Date().toISOString(),actor,zone:id,action:'cad-save'}].slice(-500);const saved=await store.setJSON('project',project,{onlyIfMatch:current.etag});if(!saved.modified)throw new Problem('다른 관리자가 수정했습니다. 도면을 보관한 뒤 다시 불러오세요.',409);return json({version:project.version,cad:(project.zones[id] as any).cad});}
 const reviewMatch=/^\/api\/diary-review\/(b1|1|2a|2b|3|4|5)\/(diary-[a-f0-9-]{36})$/.exec(path);
 if(reviewMatch&&req.method==='POST'){const raw=await req.text();if(raw.length>650000)throw new Problem('검토 문서는 10만 자 이내로 작성하세요.',413);const input=JSON.parse(raw);if(input.version!==project.version)throw new Problem('다른 관리자가 수정했습니다. 새로고침 후 다시 저장하세요.',409);const [,zoneID,diaryID]=reviewMatch;reviewDiary(project.zones[zoneID],diaryID,input,actor);project.version++;project.audit=[...(project.audit||[]),{at:new Date().toISOString(),actor,zone:zoneID,action:'diary-review'}].slice(-500);const saved=await store.setJSON('project',project,{onlyIfMatch:current.etag});if(!saved.modified)throw new Problem('다른 관리자가 수정했습니다. 새로고침 후 다시 저장하세요.',409);return json(await view(project));}
 const retry=/^\/api\/diary-retry\/(diary-[a-f0-9-]{36})$/.exec(path);
 if(retry&&req.method==='POST'){const id=retry[1];if(!Object.values(project.zones).some(z=>z.diaries?.some(d=>d.id===id)))throw new Problem('일지 없음',404);const row=await diaryStore().getWithMetadata(id,{type:'json'});if(!row)throw new Problem('일지 없음',404);if(['queued','running'].includes(row.data.status))throw new Problem('변환 진행 중입니다.',409);if(!aiReady())throw new Problem('이미지·PDF 자동 변환 서비스를 준비 중입니다. 원본은 저장되어 있습니다.',503);const secret=await prepareDiary(id,row.data.zone,row.data.url,row.data.name);await dispatchDiary(id,secret,new URL(req.url).origin);return json(await view(project));}
 const resultMatch=/^\/api\/image-result\/(b1|1|2a|2b|3|4|5)\/(image-[a-f0-9]{64})$/.exec(path);
 if(resultMatch&&req.method==='POST'){const [,id,key]=resultMatch;const raw=await req.text();if(raw.length>4500000)throw new Problem('예상도 파일은 3MB 이하여야 합니다.');const input=JSON.parse(raw);const jobs=aiStore(),job=await jobs.getWithMetadata(key,{type:'json'});if(!job||job.data.zone!==id||!project.zones[id].records.some(r=>r.url===job.data.snapshot.records[0]?.url))throw new Problem('원본 사진 생성 요청을 찾지 못했습니다.',404);if(['queued','running'].includes(publicJob(job.data)?.status||''))throw new Problem('생성 중인 요청은 완료 후 교체하세요.',409);const f=decodeFile(input.image),name='manual-'+crypto.randomUUID()+'.'+f.ext;await files.set(name,f.bytes.buffer.slice(f.bytes.byteOffset,f.bytes.byteOffset+f.bytes.byteLength),{metadata:{mime:f.mime,kind:'ai-concept'}});const changed=await jobs.setJSON(key,{...job.data,status:'completed',error:undefined,finished:new Date().toISOString(),image:{url:'/uploads/'+name,reference:job.data.snapshot.records[0].url,label:'공사 후 예상도 · 관리자 등록',created:new Date().toISOString(),model:'manual-return'}},{onlyIfMatch:job.etag});if(!changed.modified){await files.delete(name);throw new Problem('다른 관리자가 결과를 등록했습니다. 새로고침하세요.',409)}return json(await listImageRequests(id,project.zones[id]))}
 const imageMatch=/^\/api\/image-requests\/(b1|1|2a|2b|3|4|5)$/.exec(path);
 if(imageMatch){const id=imageMatch[1];if(req.method==='GET')return json(await listImageRequests(id,project.zones[id]));if(req.method==='POST'){const raw=await req.text();if(raw.length>5000)throw new Problem('생성 요청 형식 오류');const input=JSON.parse(raw);if(input.version!==project.version)throw new Problem('다른 관리자가 수정했습니다. 새로고침 후 다시 요청하세요.',409);return json(await createImageRequests(id,project.zones[id],actor,new URL(req.url).origin,input.urls,input.process!==false),202)}throw new Problem('잘못된 요청',404)}
 const aiMatch=/^\/api\/(ai|ai-status)\/(b1|1|2a|2b|3|4|5)$/.exec(path);
 if(aiMatch){const [,action,id]=aiMatch;if(action==='ai-status'&&req.method==='GET'){const job=await aiStore().getWithMetadata(id,{type:'json'});return json(publicJob(job?.data,project.zones[id]))}if(action==='ai'&&req.method==='POST'){const raw=await req.text();if(raw.length>1000)throw new Problem('AI 요청 형식 오류');const input=JSON.parse(raw);if(input.version!==project.version)throw new Problem('다른 관리자가 수정했습니다. 새로고침 후 다시 실행하세요.',409);return json(await queueAI(id,project.zones[id],input.mode,new URL(req.url).origin,actor,input.quoteURLs),202)}throw new Problem('잘못된 요청',404)}
 const match=/^\/api\/(zone|photo|quote|contract|diary)\/(b1|1|2a|2b|3|4|5)$/.exec(path);
 if(!match||req.method!==(match[1]==='zone'?'PUT':'POST'))throw new Problem('잘못된 요청',404);
 if(Number(req.headers.get('content-length')||0)>4500000)throw new Problem('파일은 3MB 이하여야 합니다.',413);
 const raw=await req.text();if(raw.length>4500000)throw new Problem('파일은 3MB 이하여야 합니다.',413);
 const input=JSON.parse(raw);if(input.version!==project.version)throw new Problem('다른 관리자가 수정했습니다. 새로고침 후 다시 저장하세요.',409);
 const [,action,id]=match;const zone=project.zones[id];let uploaded='',diaryID='',diarySecret='';
 if(action==='zone')Object.assign(zone,validateZone(input));
 else if(action==='diary'){const f=decodeDiary(input.content);uploaded=crypto.randomUUID()+'.'+f.ext;const name=text(input.name,150,'파일명',true),workDate=date(input.date??''),vendor=text(input.vendor??'',100,'일지 업체'),trade=text(input.trade??'',60,'일지 공종');await files.set(uploaded,f.bytes.buffer.slice(f.bytes.byteOffset,f.bytes.byteOffset+f.bytes.byteLength),{metadata:{mime:f.mime}});diaryID='diary-'+crypto.randomUUID();diarySecret=await prepareDiary(diaryID,id,'/uploads/'+uploaded,name,f.text);(zone.diaries??=[]).push({id:diaryID,name,date:workDate,vendor,trade,url:'/uploads/'+uploaded,mime:f.mime,created:new Date().toISOString()});}
 else{
 const quote=action==='quote',contract=action==='contract',document=quote||contract,f=decodeFile(document?input.content:input.image,document);uploaded=crypto.randomUUID()+'.'+f.ext;
 const entry=document?{name:text(input.name,150,'파일명',true),vendor:text(input.vendor??'',100,'견적 업체명'),trade:text(input.trade??'',60,'견적 공종'),url:'/uploads/'+uploaded}: {date:date(input.date),note:text(input.note,1000,'작업 내용',true),kind:text(input.kind,10,'사진 구분'),viewpoint:text(input.viewpoint,100,'촬영 위치',true),url:'/uploads/'+uploaded};
 if(!document&&(!['before','during','after'].includes(input.kind)||!input.date))throw new Problem('사진 구분·날짜를 확인하세요.');
 await files.set(uploaded,f.bytes.buffer.slice(f.bytes.byteOffset,f.bytes.byteOffset+f.bytes.byteLength),{metadata:{mime:f.mime}});(contract?(zone.contracts??=[]):quote?zone.quotes:zone.records).push(entry);
 }
 project.version++;project.audit=[...(project.audit||[]),{at:new Date().toISOString(),actor,zone:id,action}].slice(-500);
 const result=await store.setJSON('project',project,{onlyIfMatch:current.etag});
 if(!result.modified){if(uploaded)await files.delete(uploaded);if(diaryID)await diaryStore().delete(diaryID);throw new Problem('다른 관리자가 수정했습니다. 새로고침 후 다시 저장하세요.',409)}
 if(diaryID)await dispatchDiary(diaryID,diarySecret,new URL(req.url).origin);
 return json(await view(project));
 }catch(e){if(e instanceof Problem)return json({error:e.message},e.status);console.error('Arirang API failure',e instanceof Error?e.name:'unknown');return json({error:'저장 요청을 처리하지 못했습니다. 연결과 입력을 확인하세요.'},500)}
}
export const config:Config={path:['/api/*','/uploads/*']};

