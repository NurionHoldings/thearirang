import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {makeFinanceService,fees} from '../../netlify/functions/_market/finance.mjs';
import {MarketError} from '../../netlify/functions/_market/domain.mjs';
import {marketHandler} from '../../netlify/functions/market.mjs';
const operator={id:'operator',role:'operator'};
async function setup(){const db=new PGlite();for(const f of readdirSync('netlify/database/migrations').sort())await db.exec(readFileSync('netlify/database/migrations/'+f,'utf8'));let tail=Promise.resolve();const pool={query:(q,p)=>db.query(q,p),async connect(){const before=tail;let release;tail=new Promise(r=>release=r);await before;return {query:(q,p)=>db.query(q,p),release}}};
 const region=(await db.query('SELECT id FROM market_regions LIMIT 1')).rows[0].id,storeId=randomUUID(),otherId=randomUUID();
 for(const id of [storeId,otherId])await db.query("INSERT INTO market_stores(id,name,region_id,service_regions,address,status,delivery_fee,minimum_order) VALUES($1,$2,$3,'[]','테스트 주소','pending',0,0)",[id,id===storeId?'테스트 업체':'타 업체',region]);
 const merchant={id:randomUUID(),role:'merchant',storeId,name:'서명 테스트'},other={id:randomUUID(),role:'merchant',storeId:otherId};const finance=makeFinanceService(pool);
 const now=new Date(),from=new Date(now.getTime()-86400000).toISOString().slice(0,10),until=new Date(now.getTime()+86400000*30).toISOString().slice(0,10);
 const input={storeId,legalName:'테스트상호',representative:'홍길동',businessNumber:'000-00-00000',operatorSigner:'운영담당',from,until,platformBps:500,pgBps:300,vatBps:1000,cycleDays:7,special:'테스트 특약',accept:true};
 async function issue(v=input){const p=await finance.issue(operator,{...v,preview:true});return finance.issue(operator,{...v,previewHash:p.document_hash})}
 async function signed(){const c=await issue(),r=await finance.read(merchant,c.id);await finance.sign(merchant,c.id,{hash:r.document_hash,readToken:r.readToken,signer:'홍길동',consent:true,authority:true});return c}
 const record=(c,v={})=>finance.record(operator,{storeId,kind:'capture',contractId:c.id,occurredAt:new Date().toISOString(),amount:100000,actualPgFee:3000,reference:randomUUID(),evidence:'PG 명세서 1',...v});
 return {db,pool,finance,merchant,other,storeId,otherId,input,issue,signed,record};}
test('contract preview, tenant isolation, read receipt, signer consent, canonical hash and immutable signed original',async()=>{const s=await setup();try{
 await assert.rejects(s.finance.list(null),/로그인/);await assert.rejects(s.finance.issue(s.merchant,s.input),/권한/);await assert.rejects(s.finance.issue(operator,s.input),/미리보기/);
 const c=await s.issue();assert.equal((await s.finance.list(s.other)).contracts.length,0);await assert.rejects(s.finance.read(s.other,c.id),/다른 업체/);
 const r=await s.finance.read(s.merchant,c.id);await assert.rejects(s.finance.sign(s.merchant,c.id,{hash:'bad',readToken:r.readToken,consent:true,authority:true,signer:'홍길동'}),/원본/);
 await assert.rejects(s.finance.sign(s.merchant,c.id,{hash:r.document_hash,readToken:r.readToken,consent:false,authority:true,signer:'홍길동'}),/동의/);
 const done=await s.finance.sign(s.merchant,c.id,{hash:r.document_hash,readToken:r.readToken,consent:true,authority:true,signer:'홍길동'});assert.equal(done.status,'signed');
 await assert.rejects(s.finance.sign(s.merchant,c.id,{hash:r.document_hash,readToken:r.readToken,consent:true,authority:true,signer:'홍길동'}),/발행 계약/);
 await assert.rejects(s.db.query("UPDATE market_contracts SET document='{}' WHERE id=$1",[c.id]),/immutable/);
 await assert.rejects(s.finance.withdraw(operator,c.id),/미서명/);
 const next=await s.issue();const rr=await s.finance.read(s.merchant,next.id);await assert.rejects(s.finance.sign(s.merchant,next.id,{hash:rr.document_hash,readToken:rr.readToken,consent:true,authority:true,signer:'홍길동'}),/기간이 겹칩니다/);
 const audit=(await s.finance.list(s.merchant)).audit;assert(audit.some(a=>a.action==='contract.sign'));await assert.rejects(s.db.query('DELETE FROM market_finance_audit'),/append only/);
 }finally{await s.db.close()}});
test('fee rounding, refund cumulative reversal, evidence uniqueness, unsigned and cross-tenant rejection',async()=>{const s=await setup();try{
 assert.deepEqual(fees(100000,{platformBps:500,pgBps:300,vatBps:1000}),{gross:100000,platform:5000,pg:3000,vat:800,net:91200});
 const unsigned=await s.issue();await assert.rejects(s.record(unsigned),/서명 계약/);const c=await s.signed();
 const v={reference:'PG:test001'},p=await s.record(c,v);await assert.rejects(s.record(c,v),e=>e.code==='23505');await assert.rejects(s.record(c,{storeId:s.otherId}),/서명 계약/);
 const refunds=[];for(const amount of [33333,33333,33334])refunds.push(await s.record(c,{kind:'refund',parentId:p.id,amount,actualPgFee:0,varianceReason:'PG 미반환 조건 확인'}));
 for(const k of ['gross','platform','pg','vat','net'])assert.equal(refunds.reduce((n,r)=>n+r.amounts[k],p.amounts[k]),0,k);
 await assert.rejects(s.record(c,{kind:'refund',parentId:p.id,amount:1,actualPgFee:0}),/초과/);await assert.rejects(s.db.query("UPDATE market_finance_events SET amount=1 WHERE id=$1",[p.id]),/append only/);
 }finally{await s.db.close()}});
test('settlement review → approval → payout request → transfer evidence, version control and no duplicate allocation',async()=>{const s=await setup();try{
 const c=await s.signed();await s.record(c);const d=await s.finance.draft(operator,{storeId:s.storeId,cutoff:new Date().toISOString()});
 await assert.rejects(s.finance.draft(operator,{storeId:s.storeId,cutoff:new Date().toISOString()}),/진행 중/);
 await assert.rejects(s.finance.action(s.merchant,d.id,{action:'approve',version:1}),/권한/);await assert.rejects(s.finance.context(s.other,d.id),/다른 업체/);
 await assert.rejects(s.finance.action(operator,d.id,{action:'approve',version:1,confirm:true}),/검증 통과/);
 const review=await s.finance.action(operator,d.id,{action:'review',version:1});assert.equal(review.review.passed,true);
 await assert.rejects(s.finance.action(operator,d.id,{action:'approve',version:1,confirm:true}),/변경/);
 await s.finance.action(operator,d.id,{action:'approve',version:2,confirm:true});
 await s.finance.action(operator,d.id,{action:'request',version:3,confirm:true,bank:'테스트은행',account:'000000',holder:'테스트',dueDate:s.input.until,memo:'정산 지급요청'});
 let r=(await s.finance.list(operator)).settlements[0];assert.equal(r.status,'requested');assert.equal(r.payout.amount,91200);assert(!r.paid_at);
 await assert.rejects(s.finance.action(operator,d.id,{action:'paid',version:4,confirm:false,transferReference:'x'}),/증빙 확인/);
 await s.finance.action(operator,d.id,{action:'paid',version:4,confirm:true,transferReference:'BANK:00001'});r=(await s.finance.list(operator)).settlements[0];assert.equal(r.status,'paid');assert(r.paid_at);
 await assert.rejects(s.finance.draft(operator,{storeId:s.storeId,cutoff:new Date().toISOString()}),/미정산 거래가 없습니다/);
 await assert.rejects(s.db.query("UPDATE market_settlements SET snapshot='{}' WHERE id=$1",[d.id]),/immutable/);
 }finally{await s.db.close()}});
test('PG mismatch blocks approval; new refunds revoke approval and invalidate requested payout until recalled/rebuilt',async()=>{const s=await setup();try{
 const c=await s.signed(),p=await s.record(c,{actualPgFee:2999});const d=await s.finance.draft(operator,{storeId:s.storeId,cutoff:new Date().toISOString()});
 const check=await s.finance.action(operator,d.id,{action:'review',version:1});assert.equal(check.review.passed,false);assert(check.review.issues.some(x=>x.includes('차이 사유')));await s.finance.action(operator,d.id,{action:'void',version:2});
 // Append-only correction requires supporting evidence; original event remains untouched.
 await s.finance.reconcile(operator,p.id,{actualPgFee:3000,reason:'원 명세서 전사 오류 정정',evidence:'PG 명세서 원본 1'});
 assert.equal(Number((await s.db.query('SELECT actual_pg_fee FROM market_finance_events WHERE id=$1',[p.id])).rows[0].actual_pg_fee),2999);
 assert.equal(Number((await s.finance.list(operator)).events.find(e=>e.id===p.id).actual_pg_fee),3000);
 const c2=await s.record(c,{actualPgFee:3000});
 const other=await s.finance.draft(operator,{storeId:s.storeId,cutoff:new Date().toISOString()});const checked=await s.finance.action(operator,other.id,{action:'review',version:1});assert.equal(checked.review.passed,true);await s.finance.action(operator,other.id,{action:'approve',version:2,confirm:true});await assert.rejects(s.finance.reconcile(operator,p.id,{actualPgFee:3000,reason:'추가',evidence:'추가증빙'}),/초안을 해제/);
 }finally{await s.db.close()}});
test('refund after approval/request requires recall and rebuild, paid refund carries to next batch',async()=>{const s=await setup();try{
 const c=await s.signed(),p=await s.record(c);const d=await s.finance.draft(operator,{storeId:s.storeId,cutoff:new Date().toISOString()});await s.finance.action(operator,d.id,{action:'review',version:1});await s.finance.action(operator,d.id,{action:'approve',version:2,confirm:true});
 await s.record(c,{kind:'refund',parentId:p.id,amount:1000,actualPgFee:-30});let r=(await s.finance.list(operator)).settlements[0];assert.equal(r.status,'draft');assert.equal(r.version,4);await assert.rejects(s.finance.action(operator,d.id,{action:'approve',version:4,confirm:true}),/검증 통과/);await s.finance.action(operator,d.id,{action:'void',version:4});
 const d2=await s.finance.draft(operator,{storeId:s.storeId,cutoff:new Date().toISOString()});assert.equal(d2.snapshot.totals.gross,99000);await s.finance.action(operator,d2.id,{action:'review',version:1});await s.finance.action(operator,d2.id,{action:'approve',version:2,confirm:true});await s.finance.action(operator,d2.id,{action:'request',version:3,confirm:true,bank:'은행',account:'123',holder:'업체',dueDate:s.input.until,memo:'지급'});
 await s.record(c,{kind:'refund',parentId:p.id,amount:1000,actualPgFee:-30});await assert.rejects(s.finance.action(operator,d2.id,{action:'paid',version:4,confirm:true,transferReference:'bank'}),/추가 환불/);await s.finance.action(operator,d2.id,{action:'recall',version:4});await s.finance.action(operator,d2.id,{action:'void',version:5});
 const d3=await s.finance.draft(operator,{storeId:s.storeId,cutoff:new Date().toISOString()});assert.equal(d3.snapshot.totals.gross,98000);
 }finally{await s.db.close()}});
test('HTTP requires staff session and exact origin; signature requires server password verification',async()=>{const s=await setup();try{const c=await s.issue(),read=await s.finance.read(s.merchant,c.id);let current=s.merchant,calls=0;
 const handler=marketHandler(()=>({finance:s.finance,session:async()=>current,financeAccount:async()=>({username:'merchant'}),login:async v=>{calls++;if(v.password!=='correct')throw new MarketError('비밀번호를 확인하세요.',401);return {actor:current,token:'temp'}},logout:async()=>{}}),()=>undefined,async()=>null);
 const request=(path,body,origin='https://test.local')=>handler(new Request('https://test.local/market-api'+path,{method:body?'POST':'GET',headers:{origin,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}));
 assert.equal((await request('/finance')).status,200);assert.equal((await request('/finance/contracts',{...s.input,role:'operator'})).status,403);assert.equal((await request('/finance/contracts/'+c.id+'/read',{},'https://evil.local')).status,403);
 const body={hash:read.document_hash,readToken:read.readToken,consent:true,authority:true,signer:'대표',password:'bad'};assert.equal((await request('/finance/contracts/'+c.id+'/sign',body)).status,401);assert.equal(calls,1);assert.equal((await request('/finance/contracts/'+c.id+'/sign',{...body,password:'correct'})).status,200);
 current=null;assert.equal((await request('/finance')).status,403);
 }finally{await s.db.close()}});
test('clerical reversal preserves evidence, balances wrong entries and never masquerades as a customer refund',async()=>{const s=await setup();try{const c=await s.signed(),p=await s.record(c,{amount:100001,actualPgFee:3000});await assert.rejects(s.finance.reverse(s.merchant,p.id,{reason:'오류',evidence:'명세'}),/권한/);const reversal=await s.finance.reverse(operator,p.id,{reason:'상품액 전사 오류',evidence:'PG 원본 2'});assert.equal(reversal.amounts.gross,-100001);await assert.rejects(s.finance.reverse(operator,p.id,{reason:'재반제',evidence:'명세'}),/이미 반제/);await assert.rejects(s.record(c,{kind:'refund',parentId:p.id,amount:1000,actualPgFee:-30}),/반제한 원 결제/);await s.record(c,{reference:'PG:test:정정1'});const d=await s.finance.draft(operator,{storeId:s.storeId,cutoff:new Date().toISOString()});assert.equal(d.snapshot.totals.gross,100000);assert.equal(d.snapshot.totals.net,91200);const checked=await s.finance.action(operator,d.id,{action:'review',version:1});assert.equal(checked.review.passed,true);assert.equal((await s.finance.list(operator)).events.length,3);}finally{await s.db.close()}});
