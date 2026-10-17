import type {Config} from '@netlify/functions';
import {accessStore,identityAdmin,floorSession,FLOOR_ZONES,FLOOR_ACCESS_ENV,passwordLogin,resetFloorPassword,registerFloorPassword,floorCookie,sessionToken,tokenHash} from './_shared/floor-access.mjs';
import {Problem} from './_shared/project.mjs';
const json=(v:unknown,status=200,cookie?:string)=>new Response(JSON.stringify(v),{status,headers:{'Content-Type':'application/json','Cache-Control':'private, no-store',...(cookie?{'Set-Cookie':cookie}:{})}});
export default async function handler(req:Request){try{const path=new URL(req.url).pathname;if(req.method!=='GET'&&req.headers.get('origin')!==new URL(req.url).origin)throw new Problem('요청 출처 오류',403);
if(path==='/floor-auth/session'&&req.method==='GET'){const owner=await identityAdmin(req),session=await floorSession(req,true);return json({owner:!!owner,floor:session?.floor||null,mustChange:session?.mustChange||false,zones:owner?Object.values(FLOOR_ZONES).flat():session?.zones||[],environmentManaged:owner?Object.keys(FLOOR_ACCESS_ENV).filter(f=>!!Netlify.env.get(FLOOR_ACCESS_ENV[f])):[]});}
if(req.method!=='POST')throw new Problem('요청 오류',404);const raw=await req.text();if(raw.length>2000)throw new Problem('입력 길이 오류',413);const input=JSON.parse(raw);
if(path==='/floor-auth/login'){const token=await passwordLogin(input.floor,input.password);return json({ok:true,floor:input.floor},200,floorCookie(token));}
if(path==='/floor-auth/logout'){const token=sessionToken(req);if(token)await accessStore().delete('sessions/'+tokenHash(token));return json({ok:true},200,floorCookie('',0));}
if(path==='/floor-auth/configure')throw new Problem('비밀번호 직접 지정은 지원하지 않습니다. 총괄관리자는 초기화만 가능합니다.',403);
if(path==='/floor-auth/reset'){const actor=await identityAdmin(req);if(!actor)throw new Problem('총괄관리자만 초기화할 수 있습니다.',403);if(input.password!==undefined)throw new Problem('초기화 시 비밀번호를 지정할 수 없습니다.');await resetFloorPassword(input.floor,actor);return json({ok:true,requiresRegistration:true});}
if(path==='/floor-auth/register'){if(await identityAdmin(req))throw new Problem('총괄 계정에서는 층 관리자 비밀번호를 등록할 수 없습니다.',403);if(input.password!==input.confirmation)throw new Problem('비밀번호 확인이 일치하지 않습니다.');const floor=await registerFloorPassword(req,input.password),token=await passwordLogin(floor,input.password);return json({ok:true,floor},200,floorCookie(token));}
throw new Problem('요청 오류',404);
}catch(e){return json({error:e instanceof Problem?e.message:'요청 형식을 확인하세요.'},e instanceof Problem?e.status:400)}}
export const config:Config={path:'/floor-auth/*',rateLimit:{windowLimit:20,windowSize:60,aggregateBy:['ip','domain'],action:'rate_limit'}};
