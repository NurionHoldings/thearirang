import type {Config} from '@netlify/functions';
import {accessStore,identityAdmin,floorSession,FLOOR_ZONES,FLOOR_ACCESS_ENV,passwordLogin,setFloorPassword,floorCookie,sessionToken,tokenHash} from './_shared/floor-access.mjs';
import {Problem} from './_shared/project.mjs';
const json=(v:unknown,status=200,cookie?:string)=>new Response(JSON.stringify(v),{status,headers:{'Content-Type':'application/json','Cache-Control':'private, no-store',...(cookie?{'Set-Cookie':cookie}:{})}});
export default async function handler(req:Request){try{const path=new URL(req.url).pathname;if(req.method!=='GET'&&req.headers.get('origin')!==new URL(req.url).origin)throw new Problem('요청 출처 오류',403);
if(path==='/floor-auth/session'&&req.method==='GET'){const owner=await identityAdmin(req),session=await floorSession(req);return json({owner:!!owner,floor:session?.floor||null,zones:owner?Object.values(FLOOR_ZONES).flat():session?.zones||[],environmentManaged:owner?Object.keys(FLOOR_ACCESS_ENV).filter(f=>!!Netlify.env.get(FLOOR_ACCESS_ENV[f])):[]});}
if(req.method!=='POST')throw new Problem('요청 오류',404);const raw=await req.text();if(raw.length>2000)throw new Problem('입력 길이 오류',413);const input=JSON.parse(raw);
if(path==='/floor-auth/login'){const token=await passwordLogin(input.floor,input.password);return json({ok:true,floor:input.floor},200,floorCookie(token));}
if(path==='/floor-auth/logout'){const token=sessionToken(req);if(token)await accessStore().delete('sessions/'+tokenHash(token));return json({ok:true},200,floorCookie('',0));}
if(path==='/floor-auth/configure'){const actor=await identityAdmin(req);if(!actor)throw new Problem('전체 관리자만 비밀번호를 설정할 수 있습니다.',403);await setFloorPassword(input.floor,input.password,actor);return json({ok:true});}
throw new Problem('요청 오류',404);
}catch(e){return json({error:e instanceof Problem?e.message:'요청 형식을 확인하세요.'},e instanceof Problem?e.status:400)}}
export const config:Config={path:'/floor-auth/*',rateLimit:{windowLimit:20,windowSize:60,aggregateBy:['ip','domain'],action:'rate_limit'}};
