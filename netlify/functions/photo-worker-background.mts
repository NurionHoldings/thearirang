import {hash,mutateRequests,dispatchNext,expired} from './_shared/requests.mjs';
import {runAI} from './_shared/ai.mjs';
import {Problem,zoneIDs} from './_shared/project.mjs';
export default async function handler(req:Request){
 let body:any;try{body=await req.json()}catch{return}
 if(!body||!(zoneIDs() as readonly string[]).includes(body.zone)||typeof body.secret!=='string'||body.secret.length>100)return;
 let job:any;
 await mutateRequests(body.zone,rows=>{job=undefined;const r=rows.find(r=>r.id===body.id);if(!r||r.route!=='automatic'||r.status!=='dispatched'||r.secretHash!==hash(body.secret)||expired(r))return;r.status='running';job=structuredClone(r)});
 if(!job)return;
 let completion:any;
 try{const generated=await runAI({...job,mode:'all'});completion={status:'completed',image:generated.image,finished:new Date().toISOString()}}
 catch(e){completion={status:'failed',error:e instanceof Problem?e.message:'AI 연결이 중단되었습니다. 재시도하세요.',finished:new Date().toISOString()}}
 await mutateRequests(body.zone,rows=>{const r=rows.find(r=>r.id===job.id);if(r?.status==='running'&&r.secretHash===hash(body.secret)&&!expired(r))Object.assign(r,{...completion,secretHash:undefined,leaseUntil:undefined})});
 await dispatchNext(body.zone,new URL(req.url).origin);
}
