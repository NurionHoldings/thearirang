import type {Config} from '@netlify/functions';
import {getDatabase} from '@netlify/database';
import {getStore,getDeployStore} from '@netlify/blobs';
import {productionContext} from './_shared/deploy-context.mjs';
// @ts-expect-error Existing tested JavaScript account service.
import {makeMarketService} from './_market/service.mjs';
const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
export default async function handler(req:Request){try{
 const u=new URL(req.url),pool=getDatabase().pool;
 const token=req.headers.get('cookie')?.split(';').map(v=>v.trim()).find(v=>v.startsWith('__Host-arirang_market='))?.slice('__Host-arirang_market='.length)||'';
 const actor=await makeMarketService(pool,{env:(k:string)=>Netlify.env.get(k)}).session(token);
 const opts={name:'arirang-market-media',consistency:'strong' as const},blobs=productionContext()?getStore(opts):getDeployStore(opts);
 const key=/^\/market-media\/([a-f0-9-]{36}\.(jpg|png|webp))$/.exec(u.pathname)?.[1];
 if(req.method==='GET'&&key){
  const row=(await pool.query('SELECT * FROM market_media WHERE blob_key=$1',[key])).rows[0];if(!row)return new Response('사진 없음',{status:404,headers});
  const owner=actor&&(actor.role==='operator'||actor.role==='merchant'&&actor.storeId===row.store_id);
  if(!owner){const published=(await pool.query("SELECT s.id FROM market_stores s WHERE s.id=$1 AND s.status='active' AND s.open=true AND (s.image_url=$2 OR EXISTS(SELECT 1 FROM market_products p WHERE p.store_id=s.id AND p.image_url=$2 AND p.active=true AND p.deleted=false))",[row.store_id,'/market-media/'+key])).rows[0];if(!published)return new Response('사진 없음',{status:404,headers});}
  const file=await blobs.get(key,{type:'arrayBuffer'});return file?new Response(file,{headers:{...headers,'Content-Type':row.mime,'Content-Disposition':'inline'}}):new Response('사진 없음',{status:404,headers});
 }
 if(req.method!=='POST'||u.pathname!=='/market-media')return new Response('요청 없음',{status:404,headers});
 if(req.headers.get('origin')!==u.origin)return new Response('요청 출처 오류',{status:403,headers});
 if(!actor||!['operator','merchant'].includes(actor.role))return new Response('파트너 로그인 필요',{status:403,headers});
 if(Number(req.headers.get('content-length'))>2200000)return new Response('2MB 이하 사진을 선택하세요.',{status:413,headers});
 const bytes=await req.arrayBuffer();if(bytes.byteLength>2200000)return new Response('2MB 이하 사진을 선택하세요.',{status:413,headers});
 const form=await new Request(req.url,{method:'POST',headers:{'Content-Type':req.headers.get('content-type')||''},body:bytes}).formData();
 const file=form.get('file'),storeId=actor.role==='merchant'?actor.storeId:form.get('storeId');
 if(!(file instanceof File)||!file.size||file.size>2097152||form.get('publishConsent')!=='true')return new Response('공개 권한이 있는 JPG/PNG/WebP 사진(2MB 이하)을 선택하세요.',{status:400,headers});
 if(typeof storeId!=='string'||!/^[a-f0-9-]{36}$/.test(storeId))return new Response('업체 선택 필요',{status:400,headers});
 const store=(await pool.query('SELECT id FROM market_stores WHERE id=$1',[storeId])).rows[0];if(!store)return new Response('업체 없음',{status:404,headers});
 const data=await file.arrayBuffer(),b=new Uint8Array(data);
 const ext=b[0]===255&&b[1]===216&&b[2]===255?'jpg':b.slice(0,8).join(',')==='137,80,78,71,13,10,26,10'?'png':Buffer.from(b.slice(0,4)).toString()==='RIFF'&&Buffer.from(b.slice(8,12)).toString()==='WEBP'?'webp':null;
 if(!ext)return new Response('JPG/PNG/WebP 형식만 지원합니다.',{status:400,headers});
 const id=crypto.randomUUID(),blobKey=id+'.'+ext,mime={jpg:'image/jpeg',png:'image/png',webp:'image/webp'}[ext];
 await blobs.set(blobKey,data,{onlyIfNew:true,metadata:{mime,storeId}});
 await pool.query('INSERT INTO market_media(id,store_id,actor_id,blob_key,mime,byte_size) VALUES($1,$2,$3,$4,$5,$6)',[id,storeId,actor.id,blobKey,mime,file.size]);
 return Response.json({url:'/market-media/'+blobKey},{status:201,headers});
 }catch{return Response.json({error:'사진을 처리하지 못했습니다. 로그인·파일 형식을 확인하고 다시 시도하세요.'},{status:503,headers})}}
export const config:Config={path:['/market-media','/market-media/*'],rateLimit:{windowLimit:60,windowSize:60,aggregateBy:'ip',action:'rate_limit'}};
