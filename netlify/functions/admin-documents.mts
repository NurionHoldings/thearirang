import type {Config} from '@netlify/functions';
import {getStore,getDeployStore} from '@netlify/blobs';
import {identityAdmin,floorSession} from './_shared/floor-access.mjs';
import {productionContext} from './_shared/deploy-context.mjs';
import {createDocumentHandler} from './_shared/admin-documents.mjs';
export default createDocumentHandler({
 authorize:async req=>{const owner=await identityAdmin(req);if(owner)return {actor:owner,scope:'owner',label:'총괄관리자 문서함'};const floor=await floorSession(req);return floor?{actor:floor.actor,scope:'floor-'+floor.floor,label:(floor.floor==='b1'?'지하':floor.floor+'층')+' 관리자 문서함'}:null;},
 store:()=>{const options={name:'arirang-admin-documents',consistency:'strong' as const};return productionContext()?getStore(options):getDeployStore(options);}
});
export const config:Config={path:['/admin-documents','/admin-documents/*'],rateLimit:{windowLimit:90,windowSize:60,aggregateBy:['ip','domain'],action:'rate_limit'}};
