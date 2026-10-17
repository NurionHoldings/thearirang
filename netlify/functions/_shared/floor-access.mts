import {productionContext} from './deploy-context.mjs';
import {getStore,getDeployStore} from '@netlify/blobs';
import {randomBytes,scrypt as scryptCallback,timingSafeEqual,createHash} from 'node:crypto';
import {promisify} from 'node:util';
import {Problem} from './project.mjs';
const scrypt=promisify(scryptCallback);
export const FLOOR_ZONES:Record<string,string[]>={b1:['b1'],'1':['1'],'2':['2a','2b'],'3':['3'],'4':['4'],'5':['5']};
export function accessStore(){const o={name:'arirang-floor-access',consistency:'strong' as const};return productionContext()?getStore(o):getDeployStore(o)}
export const tokenHash=(s:string)=>createHash('sha256').update(s).digest('hex');
export function sessionToken(req:Request){return req.headers.get('cookie')?.match(/(?:^|;\s*)__Host-arirang_floor=([a-f0-9]{64})(?:;|$)/)?.[1]||''}
export const floorCookie=(token:string,maxAge=28800)=>`__Host-arirang_floor=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
export async function identityAdmin(req:Request){const jwt=req.headers.get('cookie')?.match(/(?:^|;\s*)nf_jwt=([^;]+)/)?.[1],origin=Netlify.env.get('URL');if(!jwt||!origin)return '';try{const r=await fetch(origin+'/.netlify/identity/user',{headers:{Authorization:'Bearer '+decodeURIComponent(jwt)},signal:AbortSignal.timeout(8000)});if(!r.ok)return '';const user=await r.json();return user.app_metadata?.roles?.includes('admin')?String(user.id):''}catch{return ''}}
export const FLOOR_ACCESS_ENV:Record<string,string>={b1:'ARIRANG_B1_ACCESS_PASSWORD','1':'ARIRANG_FLOOR1_ACCESS_PASSWORD','2':'ARIRANG_FLOOR2_ACCESS_PASSWORD','3':'HAEON_ACCESS_PASSWORD','4':'ARIRANG_FLOOR4_ACCESS_PASSWORD','5':'ARIRANG_FLOOR5_ACCESS_PASSWORD'};
async function environmentCredential(floor:string){
 const value=Netlify.env.get(FLOOR_ACCESS_ENV[floor]);
 if(!value)return null;
 if(value.length<9||value.length>128)return {active:false,source:'environment',version:'invalid',salt:'invalid',hash:'00'.repeat(64)};
 const salt='arirang-environment-v1:'+floor,hash=(await scrypt(value,salt,64) as Buffer).toString('hex');
 return {active:true,source:'environment',salt,hash,version:tokenHash(hash)};
}
export async function floorCredential(floor:string){
 if(!FLOOR_ZONES[floor])return null;
 const seed=await environmentCredential(floor),row=await accessStore().getWithMetadata('credentials/'+floor,{type:'json'});
 // A managed password overrides the current environment seed. Rotating the seed resets it.
 if(row&&(row.data.environmentVersion??'none')===(seed?.version||'none'))return {...row.data,source:'managed'};
 return seed?{...seed,mustChange:true}:null;
}
export async function floorSession(req:Request,allowEnrollment=false){const token=sessionToken(req);if(!token)return null;const store=accessStore(),row=await store.getWithMetadata('sessions/'+tokenHash(token),{type:'json'});if(!row||row.data.expires<=Date.now()||!FLOOR_ZONES[row.data.floor])return null;const config=await floorCredential(row.data.floor);if(!config?.active||config.version!==row.data.version||config.source!==row.data.source)return null;if(config.mustChange&&!allowEnrollment)return null;return {actor:'floor:'+row.data.floor,floor:row.data.floor,zones:FLOOR_ZONES[row.data.floor],mustChange:!!config.mustChange,version:config.version};}
export async function resetFloorPassword(floor:string,actor:string){
 if(!FLOOR_ZONES[floor])throw new Problem('층을 확인하세요.');
 const seed=await environmentCredential(floor);if(!seed?.active)throw new Problem('먼저 해당 층의 Netlify 초기 접속 비밀번호를 9~128자로 설정하고 재배포하세요.',409);
 const store=accessStore(),previous=await store.getWithMetadata('credentials/'+floor,{type:'json'});
 const saved=await store.setJSON('credentials/'+floor,{salt:seed.salt,hash:seed.hash,version:crypto.randomUUID(),environmentVersion:seed.version,mustChange:true,active:true,actor,updated:new Date().toISOString(),action:'reset'},previous?{onlyIfMatch:previous.etag}:{onlyIfNew:true});
 if(!saved.modified)throw new Problem('다른 관리자가 계정을 변경했습니다. 다시 시도하세요.',409);
}
export async function registerFloorPassword(req:Request,password:unknown){
 const session=await floorSession(req,true);if(!session)throw new Problem('초기 접속 비밀번호로 먼저 로그인하세요.',401);if(!session.mustChange)throw new Problem('총괄관리자의 초기화 후 새 비밀번호를 등록할 수 있습니다.',409);
 if(typeof password!=='string'||password.length<9||password.length>128)throw new Problem('새 비밀번호는 9~128자입니다.');
 const floor=session.floor,store=accessStore(),previous=await store.getWithMetadata('credentials/'+floor,{type:'json'}),credential=await floorCredential(floor),seed=await environmentCredential(floor);
 if(!credential||credential.version!==session.version)throw new Problem('초기화 상태가 변경되었습니다. 다시 로그인하세요.',409);
 const same=(await scrypt(password,credential!.salt,64) as Buffer).toString('hex')===credential!.hash;if(same)throw new Problem('초기 접속 비밀번호와 다른 비밀번호를 등록하세요.');
 const salt=randomBytes(16).toString('hex'),hash=(await scrypt(password,salt,64) as Buffer).toString('hex');
 const saved=await store.setJSON('credentials/'+floor,{salt,hash,version:crypto.randomUUID(),environmentVersion:seed?.version||'none',mustChange:false,active:true,actor:session.actor,updated:new Date().toISOString(),action:'self-register'},previous?{onlyIfMatch:previous.etag}:{onlyIfNew:true});
 if(!saved.modified)throw new Problem('계정이 동시에 변경되었습니다. 다시 초기 접속하세요.',409);return floor;
}
export async function passwordLogin(floor:string,password:unknown){if(!FLOOR_ZONES[floor]||typeof password!=='string'||password.length>128)throw new Problem('층과 비밀번호를 확인하세요.',401);const store=accessStore(),credential=await floorCredential(floor),salt=credential?.salt||'00000000000000000000000000000000';const computed=await scrypt(password,salt,64) as Buffer;const expected=Buffer.from(credential?.hash||'00'.repeat(64),'hex');if(!credential?.active||expected.length!==computed.length||!timingSafeEqual(expected,computed))throw new Problem('비밀번호가 일치하지 않거나 사용 준비 전입니다.',401);const token=randomBytes(32).toString('hex');await store.setJSON('sessions/'+tokenHash(token),{floor,source:credential.source,version:credential.version,expires:Date.now()+28800000},{onlyIfNew:true});return token;}
export function assertFloor(zones:string[]|null,id:string){if(zones&&!zones.includes(id))throw new Problem('담당 층의 자료만 이용할 수 있습니다.',403)}
