import {createHash} from 'node:crypto';
import {decodeFile,text,Problem,type Project} from './project.mjs';
const kinds={design:'designs',quote:'quotes',contract:'contracts'} as const;
export function ownSubmissions(project:Project){const items:any[]=[];for(const [zone,z]of Object.entries(project.zones))for(const [kind,key]of Object.entries(kinds))for(const item of (z as any)[key]||[])if(item.submittedBy==='document-uploader')items.push({id:item.id,zone,kind,name:item.name,category:item.category||'',vendor:item.vendor||'',trade:item.trade||'',created:item.created});return {version:project.version,items:items.sort((a,b)=>String(b.created).localeCompare(String(a.created))).slice(0,200)}}
export async function submitDocument(project:Project,current:any,store:any,files:any,zone:string,input:any){
 if(!Object.hasOwn(project.zones,zone)||typeof input.kind!=='string'||!Object.hasOwn(kinds,input.kind))throw new Problem('층과 자료 종류를 확인하세요.');
 if(input.version!==project.version)throw new Problem('다른 관리자가 자료를 등록했습니다. 목록을 새로 불러온 후 다시 등록하세요.',409);
 const key=kinds[input.kind as keyof typeof kinds],target=project.zones[zone] as any;
 if((target[key]||[]).length>=1000)throw new Problem('자료 보관 한도입니다. 총괄관리자에게 문의하세요.',409);
 const name=text(input.name,150,'파일명',true),vendor=text(input.vendor??'',100,'업체명'),trade=text(input.trade??'',60,'공종'),category=text(input.category??'',80,'자료 세부 종류'),f=decodeFile(input.content,true),file=crypto.randomUUID()+'.'+f.ext;
 const contentHash=createHash('sha256').update(f.bytes).digest('hex');
 for(const [existingZone,z]of Object.entries(project.zones))for(const [kind,field]of Object.entries(kinds))for(const document of (z as any)[field]||[]){if(document.submittedBy!=='document-uploader')continue;let hash=document.contentHash;if(!hash&&document.name===name&&/^\/uploads\/[a-f0-9-]{36}\.(pdf|jpg|png|webp)$/.test(document.url||'')){const prior=await files.getWithMetadata(document.url.slice(9),{type:'arrayBuffer'});if(prior)hash=createHash('sha256').update(Buffer.from(prior.data)).digest('hex')}if(hash===contentHash)throw new Problem('중복 등록 알림: 동일한 파일이 '+existingZone+' 구역에 이미 등록되어 있습니다. 기존 파일명: '+String(document.name).slice(0,150)+' · 종류: '+kind,409)}
 const entry={id:crypto.randomUUID(),contentHash,name,vendor,trade,category,url:'/uploads/'+file,mime:f.mime,created:new Date().toISOString(),submittedBy:'document-uploader'};
 await files.set(file,f.bytes.buffer.slice(f.bytes.byteOffset,f.bytes.byteOffset+f.bytes.byteLength),{metadata:{mime:f.mime,kind:input.kind,zone,submittedBy:'document-uploader'}});
 (target[key]??=[]).push(entry);project.version++;project.audit=[...(project.audit||[]),{at:entry.created,actor:'document-uploader',zone,action:'document-upload-'+input.kind}].slice(-500);
 try{const saved=await store.setJSON('project',project,{onlyIfMatch:current.etag});if(!saved.modified)throw new Problem('동시 등록입니다. 목록을 새로 불러오고 다시 등록하세요.',409)}catch(e){await files.delete(file);throw e}
 return {ok:true,receipt:{id:entry.id,name,zone,kind:input.kind,created:entry.created},...ownSubmissions(project)};
}
