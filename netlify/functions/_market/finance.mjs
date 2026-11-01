import {randomBytes} from 'node:crypto';
import {MarketError,uuid,digest,text,integer,identifier,optional} from './domain.mjs';
const one=async(c,q,p=[])=>(await c.query(q,p)).rows[0];
const fail=(m,s=400)=>{throw new MarketError(m,s)};
const canonical=v=>v instanceof Date?v.toISOString():Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const hash=v=>digest(JSON.stringify(canonical(v)));
const actor=a=>{if(!a||!['operator','merchant'].includes(a.role))fail('입점업체 또는 플랫폼 운영자로 로그인하세요.',403);return a};
const operator=a=>{actor(a);if(a.role!=='operator')fail('플랫폼 운영자 권한이 필요합니다.',403)};
const access=(a,id)=>{actor(a);if(a.role==='merchant'&&a.storeId!==id)fail('다른 업체 자료에는 접근할 수 없습니다.',403)};
const date=v=>{if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v+'T00:00:00Z'))||new Date(v+'T00:00:00Z').toISOString().slice(0,10)!==v)fail('날짜를 확인하세요.');return v};
const stamp=v=>{if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(v)||!Number.isFinite(Date.parse(v)))fail('시간대가 포함된 일시가 필요합니다.');return new Date(v).toISOString()};
const numeric=(v,min,max)=>{if(typeof v!=='number'&&(typeof v!=='string'||!/^[-]?\d+$/.test(v)))fail('숫자를 명시적으로 입력하세요.');return integer(Number(v),min,max)};
const round=(amount,bps)=>Number((BigInt(amount)*BigInt(bps)+5000n)/10000n);
export function fees(amount,t){
 integer(amount,0,100000000);
 const platform=round(amount,t.platformBps),pg=round(amount,t.pgBps),vat=round(platform+pg,t.vatBps);
 return {gross:amount,platform,pg,vat,net:amount-platform-pg-vat};
}
export function terms(v){
 const t={platformBps:numeric(v.platformBps,0,5000),pgBps:numeric(v.pgBps,0,3000),vatBps:numeric(v.vatBps,0,1000),cycleDays:numeric(v.cycleDays,1,90)};
 if(fees(100000000,t).net<0)fail('공제액이 매출을 초과합니다.');return t;
}
export function makeFinanceService(pool,{clock=()=>new Date()}={}){
 const tx=async fn=>{const c=await pool.connect();try{await c.query('BEGIN');const result=await fn(c);await c.query('COMMIT');return result}catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}};
 const audit=(c,a,s,action,id,details={})=>c.query('INSERT INTO market_finance_audit(id,store_id,actor_id,action,resource_id,details) VALUES($1,$2,$3,$4,$5,$6)',[uuid(),s,a.id,action,id,JSON.stringify(details)]);
 const resolved=async(c,rows)=>{for(const r of rows){const correction=await one(c,'SELECT * FROM market_finance_reconciliations WHERE event_id=$1 ORDER BY version DESC LIMIT 1',[r.id]);if(correction){r.original_actual_pg_fee=r.actual_pg_fee;r.original_variance_reason=r.variance_reason;r.actual_pg_fee=correction.actual_pg_fee;r.variance_reason=correction.reason;r.reconciliation=correction;}}return rows};
 const lockStore=async(c,id)=>{const s=await one(c,'SELECT * FROM market_stores WHERE id=$1 FOR UPDATE',[identifier(id)]);if(!s)fail('입점업체가 없습니다.',404);return s};
 async function list(a){actor(a);const where=a.role==='operator'?'': ' WHERE store_id=$1',p=a.role==='operator'?[]:[a.storeId];return {
 contracts:(await pool.query('SELECT * FROM market_contracts'+where+' ORDER BY issued_at DESC LIMIT 200',p)).rows,
 settlements:(await pool.query('SELECT * FROM market_settlements'+where+' ORDER BY created_at DESC LIMIT 200',p)).rows,
 events:await resolved(pool,(await pool.query('SELECT * FROM market_finance_events'+where+' ORDER BY created_at DESC LIMIT 300',p)).rows),
 audit:(await pool.query('SELECT * FROM market_finance_audit'+where+' ORDER BY created_at DESC LIMIT 200',p)).rows,
 stores:(await pool.query('SELECT id,name FROM market_stores'+(a.role==='operator'?'':' WHERE id=$1')+' ORDER BY name',p)).rows};}
 async function issue(a,v){operator(a);if(v.accept!==true)fail('운영자 발행·전자계약 동의가 필요합니다.');return tx(async c=>{
 const s=await lockStore(c,v.storeId),t=terms(v),from=date(v.from),until=date(v.until);
 if(until<from)fail('계약 종료일이 시작일보다 빠릅니다.');
 const version=Number((await one(c,'SELECT coalesce(max(version),0)+1 AS n FROM market_contracts WHERE store_id=$1',[s.id])).n);
 const document={title:'아리랑마켓 플랫폼 이용계약서',version,operator:{name:'(주)청천에스오엔지',address:'서울특별시 종로구 새문안로 15-1, 2층(평동)',phone:'010-5945-5925',signer:text(v.operatorSigner,60)},merchant:{storeId:s.id,name:s.name,legalName:text(v.legalName,100),representative:text(v.representative,60),businessNumber:text(v.businessNumber,30),address:s.address},from,until,terms:t,clauses:[
 '목적·역할: 플랫폼은 입점업체의 지역 상품 정보·주문 중개와 운영자료를 제공하고, 입점업체는 상품 표시·품질·재고·고객 응대 및 관련 의무를 이행합니다.',
 '결제·배송: 카드결제와 외부 배달대행을 사용합니다. 실제 서비스 개시는 결제·배달 사업자 연동 및 별도 운영조건 확정 후 가능합니다. 플랫폼이 직접 라이더를 고용하거나 금융기관의 지급을 보증하는 약정이 아닙니다.',
 `수수료: 배송비를 제외한 카드 상품 결제액을 기준으로 플랫폼 이용료 ${t.platformBps/100}%, 결제 서비스 수수료 ${t.pgBps/100}%를 공제합니다. 두 수수료 합계에 부가세 ${t.vatBps/100}%를 별도 가산합니다. 각 항목은 결제건별 원 단위 반올림하며, 결제수수료는 이 계약의 약정 요율입니다. PG 실비와의 차액은 대조표에 표시하고 사유를 기록합니다.`,
 '취소·환불: 원 결제와 연결하여 누적 환불액 비율로 약정 수수료·부가세를 반환하며 전액 환불 시 원 공제액을 전부 되돌립니다. 이미 정산한 거래의 환불은 이후 정산에 음수로 반영합니다. 원 결제와 무관한 임의 가감은 허용하지 않습니다.',
 `정산: 증빙을 대조한 매출·환불을 ${t.cycleDays}일 주기로 검토합니다. 원장 금액에서 이용료·결제수수료·부가세를 공제한 금액이 정산 예정액입니다. 관리자 검증·승인 후 지급요청을 생성하며, 실제 이체 완료는 금융거래 증빙으로 별도 확인합니다. 배송비·배달대행료는 본 정산에서 제외하고 별도 대조합니다.`,
 '자료·개인정보: 당사자는 업무상 필요한 자료만 처리하며 목적 외 사용과 무단 제공을 금합니다. 개인정보 처리·제공의 상세 범위는 별도 고지·동의와 실제 서비스 설정을 따릅니다. 계약 원본과 서명·발행·열람·정산 이력은 권한이 있는 당사자가 출력·저장할 수 있습니다.',
 '변경·종료·분쟁: 서명 원본은 수정하지 않습니다. 요율·기간 등 변경은 새 계약 발행과 양측 재동의로 처리합니다. 미정산 금액·환불 및 법령상 의무는 계약 종료 후에도 남습니다. 분쟁은 당사자 협의를 우선하고 합의되지 않으면 관계 법령의 관할에 따릅니다.',
 '전자서명 합의: 당사자는 계정 로그인, 문서 열람 확인, 서명자 성명 및 권한 확인, 비밀번호 재확인과 전자계약 동의로 계약을 체결하는 방식에 동의합니다. 운영자는 발행 시 서명·동의하고, 업체 서명 완료 시 계약이 성립합니다. 본 방식은 공동인증서 또는 공인전자문서센터 보관 서비스가 아닙니다.',
 text(v.special,6000)
 ]};
 const id=uuid(),h=hash(document);if(v.preview===true)return {id:null,version,document,document_hash:h,status:'issued',issued_at:clock().toISOString(),preview:true};if(v.previewHash!==h)fail('계약서 전문 미리보기를 확인한 뒤 발행하세요.',409);await c.query("INSERT INTO market_contracts(id,store_id,version,document,document_hash,issued_by,status) VALUES($1,$2,$3,$4,$5,$6,'issued')",[id,s.id,version,JSON.stringify(document),h,a.id]);await audit(c,a,s.id,'contract.issue',id,{hash:h,operatorSigner:document.operator.signer});return {id,document,document_hash:h};});}
 async function read(a,id){actor(a);return tx(async c=>{const r=await one(c,'SELECT * FROM market_contracts WHERE id=$1',[identifier(id)]);if(!r)fail('계약서가 없습니다.',404);access(a,r.store_id);const token=randomBytes(32).toString('hex');await c.query("INSERT INTO market_contract_reads(token_hash,contract_id,actor_id,document_hash,expires_at) VALUES($1,$2,$3,$4,now()+interval '30 minutes')",[digest(token),r.id,a.id,r.document_hash]);await audit(c,a,r.store_id,'contract.read',id,{hash:r.document_hash});return {...r,readToken:token}});}
 async function sign(a,id,v){actor(a);if(a.role!=='merchant')fail('업체 계정에서 서명하세요.',403);if(v.consent!==true||v.authority!==true)fail('전문 확인·전자계약 및 대표/위임 권한 동의가 필요합니다.');return tx(async c=>{
 await lockStore(c,a.storeId);const r=await one(c,'SELECT * FROM market_contracts WHERE id=$1 FOR UPDATE',[identifier(id)]);if(!r)fail('계약서가 없습니다.',404);access(a,r.store_id);if(r.status!=='issued')fail('서명 가능한 발행 계약이 아닙니다.',409);if(clock().toISOString()>new Date(new Date(r.document.until+'T00:00:00+09:00').getTime()+86400000).toISOString())fail('계약 기간이 종료됐습니다. 새 계약서를 요청하세요.',409);
 if(v.hash!==r.document_hash||hash(r.document)!==r.document_hash)fail('계약서 원본을 다시 확인하세요.',409);
 const receipt=await one(c,'SELECT * FROM market_contract_reads WHERE token_hash=$1 AND contract_id=$2 AND actor_id=$3 AND used_at IS NULL AND expires_at>now() FOR UPDATE',[digest(text(v.readToken,128)),r.id,a.id]);if(!receipt||receipt.document_hash!==r.document_hash)fail('계약서를 열람하고 다시 서명하세요.',409);
 const existing=(await c.query("SELECT document FROM market_contracts WHERE store_id=$1 AND status='signed'",[r.store_id])).rows;if(existing.some(x=>x.document.from<=r.document.until&&x.document.until>=r.document.from))fail('이미 서명한 계약과 기간이 겹칩니다. 기존 기간 이후로 새 계약을 발행하세요.',409);
 const signer=text(v.signer,60),signature={name:signer,accountId:a.id,accountName:a.name,documentHash:r.document_hash,consent:true,authority:true,method:'authenticated-account + password-reconfirmation + typed-name',signedAt:clock().toISOString()};
 await c.query("UPDATE market_contracts SET status='signed',signed_at=$2,signature=$3 WHERE id=$1",[r.id,signature.signedAt,JSON.stringify(signature)]);await c.query('UPDATE market_contract_reads SET used_at=now() WHERE token_hash=$1',[receipt.token_hash]);await audit(c,a,r.store_id,'contract.sign',id,signature);return {id,status:'signed',signature};});}
 async function withdraw(a,id){operator(a);return tx(async c=>{const r=await one(c,"UPDATE market_contracts SET status='withdrawn' WHERE id=$1 AND status='issued' RETURNING *",[identifier(id)]);if(!r)fail('미서명 발행 계약만 철회할 수 있습니다.',409);await audit(c,a,r.store_id,'contract.withdraw',id);return {ok:true}});}
 async function record(a,v){operator(a);return tx(async c=>{
 const s=await lockStore(c,v.storeId),kind=v.kind;if(!['capture','refund'].includes(kind))fail('매출/환불 구분을 확인하세요.');
 const when=stamp(v.occurredAt);if(Date.parse(when)>clock().getTime())fail('미래 거래는 등록할 수 없습니다.');
 const amount=numeric(v.amount,1,100000000),actual=numeric(v.actualPgFee,-100000000,100000000);let contract,parent=null,amounts;
 if(kind==='capture'){
 contract=await one(c,"SELECT * FROM market_contracts WHERE id=$1 AND store_id=$2 AND status='signed'",[identifier(v.contractId),s.id]);if(!contract)fail('해당 업체의 서명 계약이 필요합니다.');
 if(when<new Date(contract.document.from+'T00:00:00+09:00').toISOString()||when>=new Date(new Date(contract.document.until+'T00:00:00+09:00').getTime()+86400000).toISOString()||Date.parse(when)<Date.parse(contract.signed_at))fail('서명 이후 계약 유효기간 내 매출만 등록할 수 있습니다.');
 if(actual<0)fail('매출 PG 실비는 0원 이상입니다.');amounts=fees(amount,contract.document.terms);
 }else{
 parent=await one(c,"SELECT * FROM market_finance_events WHERE id=$1 AND store_id=$2 AND kind='capture' FOR UPDATE",[identifier(v.parentId),s.id]);if(!parent)fail('같은 업체의 원 결제를 선택하세요.');if(await one(c,"SELECT id FROM market_finance_events WHERE parent_id=$1 AND kind='reversal'",[parent.id]))fail('전사 오류로 반제한 원 결제입니다.',409);if(Date.parse(when)<Date.parse(parent.occurred_at))fail('환불일이 원 결제보다 빠릅니다.');contract=await one(c,'SELECT * FROM market_contracts WHERE id=$1',[parent.contract_id]);
 const refunded=Number((await one(c,"SELECT coalesce(sum(e.amount),0) n FROM market_finance_events e WHERE e.parent_id=$1 AND e.kind='refund' AND NOT EXISTS (SELECT 1 FROM market_finance_events r WHERE r.parent_id=e.id AND r.kind='reversal')",[parent.id])).n),total=Number(parent.amount);if(refunded+amount>total)fail('원 결제액을 초과한 환불입니다.',409);if(actual>0)fail('환불 PG 수수료 반환은 0 또는 음수로 입력하세요.');
 amounts={gross:-amount};for(const k of ['platform','pg','vat'])amounts[k]=-(Number((BigInt(parent.amounts[k])*BigInt(refunded+amount)+BigInt(Math.floor(total/2)))/BigInt(total))-Number((BigInt(parent.amounts[k])*BigInt(refunded)+BigInt(Math.floor(total/2)))/BigInt(total)));amounts.net=amounts.gross-amounts.platform-amounts.pg-amounts.vat;
 }
 const id=uuid(),reference=text(v.reference,150),evidence=text(v.evidence,500),reason=optional(v.varianceReason,1000);
 await c.query('INSERT INTO market_finance_events(id,store_id,contract_id,kind,parent_id,external_reference,evidence_reference,occurred_at,amount,actual_pg_fee,variance_reason,amounts,actor_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',[id,s.id,contract.id,kind,parent?.id||null,reference,evidence,when,amount,actual,reason,JSON.stringify(amounts),a.id]);
 // Refunds invalidate an unpaid approval. They must be included in a rebuilt batch before request/payment.
 if(kind==='refund')await c.query("UPDATE market_settlements SET status='draft',review=NULL,approved_by=NULL,approved_at=NULL,version=version+1 WHERE store_id=$1 AND status='approved'",[s.id]);
 await audit(c,a,s.id,'ledger.'+kind,id,{reference,evidence});return {id,amounts,variance:actual-amounts.pg};});}
 async function reverse(a,id,v){operator(a);return tx(async c=>{
 const hint=await one(c,'SELECT * FROM market_finance_events WHERE id=$1',[identifier(id)]);if(!hint)fail('거래가 없습니다.',404);await lockStore(c,hint.store_id);
 if(hint.kind==='reversal')fail('반제 전표를 다시 반제할 수 없습니다.');
 if(await one(c,'SELECT event_id FROM market_settlement_items WHERE event_id=$1',[id]))fail('정산 초안을 해제한 뒤 전사 오류를 반제하세요. 지급 완료 거래의 원장은 반제할 수 없습니다.',409);
 if(await one(c,"SELECT id FROM market_finance_events WHERE parent_id=$1 AND kind='reversal'",[id]))fail('이미 반제한 전표입니다.',409);
 if(hint.kind==='capture'&&await one(c,"SELECT e.id FROM market_finance_events e WHERE e.parent_id=$1 AND e.kind='refund' AND NOT EXISTS (SELECT 1 FROM market_finance_events r WHERE r.parent_id=e.id AND r.kind='reversal')",[id]))fail('연결된 환불 전표부터 확인·반제하세요.',409);
 const reason=text(v.reason,1000),evidence=text(v.evidence,500);await resolved(c,[hint]);const entry=uuid(),amounts=Object.fromEntries(Object.entries(hint.amounts).map(([k,n])=>[k,-n]));
 await c.query("INSERT INTO market_finance_events(id,store_id,contract_id,kind,parent_id,external_reference,evidence_reference,occurred_at,amount,actual_pg_fee,variance_reason,amounts,actor_id) VALUES($1,$2,$3,'reversal',$4,$5,$6,$7,$8,$9,$10,$11,$12)",[entry,hint.store_id,hint.contract_id,id,'CORRECTION:'+id,evidence,clock().toISOString(),hint.amount,-Number(hint.actual_pg_fee),reason,JSON.stringify(amounts),a.id]);
 await audit(c,a,hint.store_id,'ledger.reverse',id,{reversalId:entry,reason,evidence,notice:'전사 오류 정정용 반제이며 실제 고객 환불이 아님'});return {id:entry,amounts};});}
 async function reconcile(a,id,v){operator(a);return tx(async c=>{
 const hint=await one(c,'SELECT * FROM market_finance_events WHERE id=$1',[identifier(id)]);if(!hint)fail('거래가 없습니다.',404);await lockStore(c,hint.store_id);
 const allocated=await one(c,'SELECT settlement_id FROM market_settlement_items WHERE event_id=$1',[id]);if(allocated)fail('정산 초안을 해제한 뒤 대조 내용을 보완하세요. 지급 완료 거래는 원장 환불로 처리합니다.',409);
 if(hint.kind==='reversal'||await one(c,"SELECT id FROM market_finance_events WHERE parent_id=$1 AND kind='reversal'",[id]))fail('반제 전표와 이미 반제한 원 전표는 PG 대조 보완 대상이 아닙니다.',409);
 const actual=numeric(v.actualPgFee,-100000000,100000000);if(hint.kind==='capture'&&actual<0||hint.kind==='refund'&&actual>0)fail('PG 실비 부호를 확인하세요.');
 const reason=text(v.reason,1000),evidence=text(v.evidence,500),version=Number((await one(c,'SELECT coalesce(max(version),0)+1 n FROM market_finance_reconciliations WHERE event_id=$1',[id])).n),correctionId=uuid();
 await c.query('INSERT INTO market_finance_reconciliations(id,event_id,version,actual_pg_fee,reason,evidence_reference,actor_id) VALUES($1,$2,$3,$4,$5,$6,$7)',[correctionId,id,version,actual,reason,evidence,a.id]);await audit(c,a,hint.store_id,'ledger.reconcile',id,{reconciliationId:correctionId,version,reason,evidence});return {ok:true};});}
 const snapshot=rows=>{const totals={gross:0,platform:0,pg:0,vat:0,net:0};for(const r of rows)for(const k of Object.keys(totals))totals[k]+=r.amounts[k];if(Object.values(totals).some(x=>!Number.isSafeInteger(x)))fail('정산 금액 범위를 초과했습니다.');return {basis:'상품 카드 매출만 · 배송비/배달대행료 제외',events:rows.map(r=>({id:r.id,kind:r.kind,reference:r.external_reference,evidence:r.evidence_reference,occurredAt:r.occurred_at,contractId:r.contract_id,amounts:r.amounts,actualPgFee:Number(r.actual_pg_fee),varianceReason:r.variance_reason,reconciliationId:r.reconciliation?.id||null})),totals}};
 async function draft(a,v){operator(a);return tx(async c=>{const s=await lockStore(c,v.storeId);const active=await one(c,"SELECT id FROM market_settlements WHERE store_id=$1 AND status IN ('draft','approved','requested')",[s.id]);if(active)fail('진행 중인 정산서를 먼저 해제하거나 지급 확인하세요.',409);const cutoff=stamp(v.cutoff);if(Date.parse(cutoff)>clock().getTime())fail('미래 정산 마감은 불가합니다.');const rows=(await c.query('SELECT e.* FROM market_finance_events e LEFT JOIN market_settlement_items i ON i.event_id=e.id WHERE e.store_id=$1 AND e.occurred_at<=$2 AND i.event_id IS NULL ORDER BY e.occurred_at,e.id FOR UPDATE OF e',[s.id,cutoff])).rows;if(!rows.length)fail('미정산 거래가 없습니다.');if(rows.length>2000)fail('거래가 많습니다. 정산 마감 시각을 나누세요.');await resolved(c,rows);const snap=snapshot(rows),id=uuid();await c.query("INSERT INTO market_settlements(id,store_id,cutoff,status,snapshot,snapshot_hash) VALUES($1,$2,$3,'draft',$4,$5)",[id,s.id,cutoff,JSON.stringify(snap),hash(snap)]);for(const r of rows)await c.query('INSERT INTO market_settlement_items(event_id,settlement_id) VALUES($1,$2)',[r.id,id]);await audit(c,a,s.id,'settlement.draft',id,{hash:hash(snap)});return {id,snapshot:snap};});}
 async function check(c,r){
 const issues=[];if(hash(r.snapshot)!==r.snapshot_hash)issues.push('정산 스냅샷 해시 불일치');
 const rows=(await c.query('SELECT e.* FROM market_finance_events e JOIN market_settlement_items i ON i.event_id=e.id WHERE i.settlement_id=$1 ORDER BY e.occurred_at,e.id',[r.id])).rows;
 await resolved(c,rows);if(hash(snapshot(rows))!==r.snapshot_hash)issues.push('원장과 정산 내역 불일치');
 if(!rows.length)issues.push('정산 거래 없음');if(r.snapshot.totals.net<=0)issues.push('지급 가능액 없음: 음수 환불은 다음 양수 매출과 함께 재정산');
 for(const x of rows){if(Number(x.actual_pg_fee)!==x.amounts.pg&&!x.variance_reason&&!rows.some(y=>y.kind==='reversal'&&y.parent_id===x.id))issues.push(x.external_reference+': PG 실비 차이 사유 미등록');const contract=await one(c,'SELECT * FROM market_contracts WHERE id=$1',[x.contract_id]);if(!contract||contract.status!=='signed'||hash(contract.document)!==contract.document_hash)issues.push(x.external_reference+': 계약 검증 실패');}
 const unallocated=await one(c,"SELECT count(*) n FROM market_finance_events e LEFT JOIN market_settlement_items i ON i.event_id=e.id WHERE e.store_id=$1 AND i.event_id IS NULL AND (e.occurred_at<=$2 OR e.kind IN ('refund','reversal'))",[r.store_id,r.cutoff]);if(Number(unallocated.n))issues.push('추가 미정산 거래·환불이 있습니다. 초안을 해제하고 다시 산출하세요.');
 return {checkedAt:clock().toISOString(),snapshotHash:r.snapshot_hash,issues,passed:!issues.length,totals:r.snapshot.totals,method:'server ledger reconciliation',suggestions:issues.length?issues.map(x=>'보완 필요: '+x):['계약 요율·원장 대조 완료. 지급 대상 계좌는 별도 확인 후 관리자 승인을 진행하세요.']};
 }
 async function action(a,id,v){operator(a);return tx(async c=>{
 // Store lock serializes evidence/refund registration, batch release and payout transitions.
 const hint=await one(c,'SELECT store_id FROM market_settlements WHERE id=$1',[identifier(id)]);if(!hint)fail('정산서가 없습니다.',404);await lockStore(c,hint.store_id);const r=await one(c,'SELECT * FROM market_settlements WHERE id=$1 FOR UPDATE',[id]);if(r.version!==Number(v.version))fail('다른 작업으로 변경됐습니다. 새로고침하세요.',409);const review=await check(c,r);let status=r.status,payout=r.payout;
 if(v.action==='review'){if(!['draft','approved'].includes(status))fail('검토 가능한 정산서가 아닙니다.',409);await c.query('UPDATE market_settlements SET review=$2,version=version+1 WHERE id=$1',[id,JSON.stringify(review)]);}
 else if(v.action==='void'){if(!['draft','approved'].includes(status))fail('지급요청 후 해제할 수 없습니다.',409);await c.query('DELETE FROM market_settlement_items WHERE settlement_id=$1',[id]);await c.query("UPDATE market_settlements SET status='void',version=version+1 WHERE id=$1",[id]);}
 else if(v.action==='approve'){if(status!=='draft'||!r.review||r.review.snapshotHash!==r.snapshot_hash||!review.passed)fail('검증 통과 후 초안을 승인하세요. '+review.issues.join(' / '),409);if(v.confirm!==true)fail('관리자 승인 확인이 필요합니다.');await c.query("UPDATE market_settlements SET status='approved',review=$2,approved_by=$3,approved_at=now(),version=version+1 WHERE id=$1",[id,JSON.stringify(review),a.id]);}
 else if(v.action==='request'){if(status!=='approved'||!review.passed)fail('승인과 최신 검증을 통과해야 합니다. '+review.issues.join(' / '),409);if(v.confirm!==true)fail('수취계좌 대조 확인이 필요합니다.');payout={bank:text(v.bank,60),account:text(v.account,60),holder:text(v.holder,100),dueDate:date(v.dueDate),memo:text(v.memo,500),amount:r.snapshot.totals.net,requestId:'ARIRANG-'+id};await c.query("UPDATE market_settlements SET status='requested',payout=$2,requested_at=now(),version=version+1 WHERE id=$1",[id,JSON.stringify(payout)]);}
 else if(v.action==='paid'){if(status!=='requested')fail('지급요청서를 먼저 생성하세요.',409);if(!review.passed)fail('추가 환불 또는 대조 문제가 있습니다. 지급 전 검토하세요. '+review.issues.join(' / '),409);if(v.confirm!==true)fail('실제 은행 이체 증빙 확인이 필요합니다.');payout={...payout,transferReference:text(v.transferReference,200),paidConfirmedBy:a.id};await c.query("UPDATE market_settlements SET status='paid',payout=$2,paid_at=now(),version=version+1 WHERE id=$1",[id,JSON.stringify(payout)]);}
 else if(v.action==='recall'){if(status!=='requested')fail('지급요청 상태만 회수할 수 있습니다.',409);await c.query("UPDATE market_settlements SET status='draft',payout=NULL,requested_at=NULL,approved_by=NULL,approved_at=NULL,review=NULL,version=version+1 WHERE id=$1",[id]);}
 else fail('정산 작업을 확인하세요.');
 await audit(c,a,r.store_id,'settlement.'+v.action,id,{snapshotHash:r.snapshot_hash,issues:review.issues,note:optional(v.note,1000)});return {ok:true,review};});}
 async function context(a,id){actor(a);const r=await one(pool,'SELECT * FROM market_settlements WHERE id=$1',[identifier(id)]);if(!r)fail('정산서가 없습니다.',404);access(a,r.store_id);const review=await check(pool,r);return {id:r.id,status:r.status,snapshotHash:r.snapshot_hash,totals:r.snapshot.totals,eventCount:r.snapshot.events.length,review,notice:'AI는 제안만 하며 서명·승인·원장 수정·송금 권한이 없습니다.'};}
 async function contractContext(a,id){actor(a);const r=await one(pool,'SELECT * FROM market_contracts WHERE id=$1',[identifier(id)]);if(!r)fail('계약서가 없습니다.',404);access(a,r.store_id);return {type:'contract',id:r.id,status:r.status,hashVerified:hash(r.document)===r.document_hash,from:r.document.from,until:r.document.until,terms:r.document.terms,clauses:r.document.clauses,example:fees(100000,r.document.terms),notice:'계약 원문 조항과 요율 검토용. 실제 변경은 미서명 철회 후 재발행, 체결 후 갱신은 기존 기간 이후 새 계약과 재동의가 필요합니다. 법률·세무 확정 검토가 아닙니다.'};}
 return {list,issue,read,sign,withdraw,record,reconcile,reverse,draft,action,context,contractContext};
}
