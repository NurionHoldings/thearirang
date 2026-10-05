import {createHash,timingSafeEqual} from 'node:crypto';
import {aiStore,runAI} from './_shared/ai.mjs';
import {Problem} from './_shared/project.mjs';
export default async function handler(req:Request){
 let body:any;try{body=await req.json()}catch{return}
 if(!body||!['b1','1','2a','2b','3','4','5'].includes(body.zone)||typeof body.secret!=='string'||body.secret.length>100)return;
 const store=aiStore(),current=await store.getWithMetadata(body.zone,{type:'json'});const job=current?.data;
 if(!job||job.id!==body.id||job.status!=='queued')return;
 const provided=createHash('sha256').update(body.secret).digest();const expected=Buffer.from(job.secretHash,'hex');if(expected.length!==provided.length||!timingSafeEqual(provided,expected))return;
 const claimed=await store.setJSON(body.zone,{...job,status:'running'},{onlyIfMatch:current!.etag});if(!claimed.modified)return;
 let completion:any;
 try{const generated=await runAI(job,async result=>{const latest=await store.getWithMetadata(body.zone,{type:'json'});if(latest&&latest.data.id===job.id&&latest.data.status==='running')await store.setJSON(body.zone,{...latest.data,result},{onlyIfMatch:latest.etag})});completion={status:'completed',...generated,finished:new Date().toISOString()}}
 catch(error){completion={status:'failed',finished:new Date().toISOString(),error:error instanceof Problem?error.message:'AI 처리 중 연결 오류가 발생했습니다. 다시 실행하세요.'}}
 const latest=await store.getWithMetadata(body.zone,{type:'json'});if(latest&&latest.data.id===job.id&&latest.data.status==='running')await store.setJSON(body.zone,{...latest.data,...completion},{onlyIfMatch:latest.etag});
}
