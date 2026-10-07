export function zoneIDs(){return ['b1','1','2a','2b','3','4','5'] as const}
export type Step={status:string;start:string;end:string;owner:string;note:string};
export type Zone={steps:Step[];checks:boolean[];records:any[];quotes:any[];contracts?:any[];diaries?:any[];contractors:Record<string,{name:string;contact:string;phone:string;status?:string}>;costs:any[];scope:string};
export type Project={version:number;zones:Record<string,Zone>;audit?:{at:string;actor:string;zone:string;action:string}[]};
export class Problem extends Error{constructor(message:string,public status=400){super(message)}}
export function initial():Project{
 const zones=Object.fromEntries(zoneIDs().map(id=>[id,{steps:Array.from({length:6},()=>({status:['b1','2b'].includes(id)?'미등록':'예정',start:'',end:'',owner:'',note:''})),checks:[false,false,false,false],records:[],quotes:[],contractors:{},costs:[],scope:''}])) as Project['zones'];
 zones['1'].steps[2]={...zones['1'].steps[2],status:'진행 중',note:'사용자 확인: 전기공사 진행 중'};
 zones['1'].steps[4]={...zones['1'].steps[4],status:'진행 중',note:'사용자 확인: 마트 진열장 공사 진행 중'};
 return {version:0,zones,audit:[]};
}
export function text(v:unknown,max:number,label:string,required=false):string{if(typeof v!=='string'||v.length>max||(required&&!v.trim()))throw new Problem(label+' 입력을 확인하세요.');return v}
export function date(v:unknown){const s=text(v,10,'날짜');if(s&&(!/^\d{4}-\d{2}-\d{2}$/.test(s)||isNaN(Date.parse(s))||new Date(s).toISOString().slice(0,10)!==s))throw new Problem('날짜 형식 오류');return s}
export function validateZone(v:any):Pick<Zone,'steps'|'checks'|'contractors'|'costs'|'scope'>{
 if(!v||typeof v!=='object'||!Array.isArray(v.steps)||v.steps.length!==6||!Array.isArray(v.checks)||v.checks.length!==4||v.checks.some((x:any)=>typeof x!=='boolean'))throw new Problem('공정·점검 형식 오류');
 const steps=v.steps.map((s:any)=>{if(!s||!['미등록','예정','진행 중','완료','보류'].includes(s.status))throw new Problem('공정 상태 오류');const out={status:s.status,start:date(s.start),end:date(s.end),owner:text(s.owner,80,'담당자'),note:text(s.note,1000,'기록')};if(out.start&&out.end&&out.end<out.start)throw new Problem('종료일은 시작일 이후여야 합니다.');if(out.status==='완료'&&(!out.owner.trim()||!out.note.trim()))throw new Problem('완료 담당자와 근거가 필요합니다.');return out});
 if(steps[5].status==='완료'&&(steps.slice(0,5).some((s:Step)=>s.status!=='완료')||!v.checks.every(Boolean)))throw new Problem('인계 완료 전 선행 공정과 자체 점검을 확인하세요.');
 const trades=['전기공사','내부미장','인테리어','냉난방기 설치','마트설계','기타'];
 if(!v.contractors||typeof v.contractors!=='object'||Array.isArray(v.contractors))throw new Problem('업체 형식 오류');
 const contractors:Zone['contractors']={};for(const [k,c] of Object.entries(v.contractors) as [string,any][]){if(!trades.includes(k)||!c)throw new Problem('업체 형식 오류');contractors[k]={name:text(c.name??'',100,'업체명'),contact:text(c.contact??'',80,'담당자'),phone:text(c.phone??'',40,'연락처'),status:text(c.status??'미등록',10,'업체 상태')};if(!['미등록','예정','진행 중','완료','보류'].includes(contractors[k].status!))throw new Problem('업체 상태 오류')}
 if(!Array.isArray(v.costs)||v.costs.length>100)throw new Problem('산출 항목 수 오류');const costs=v.costs.map((r:any)=>{if(!r||!trades.includes(r.trade))throw new Problem('공종 오류');const {qty,price,vat}=r;if(typeof qty!=='number'||!Number.isFinite(qty)||qty<.001||qty>1000000||!Number.isSafeInteger(price)||price<0||price>100000000000||![0,10].includes(vat)||qty*price>9000000000000)throw new Problem('수량·단가·부가세 오류');return {trade:r.trade,item:text(r.item,150,'품명',true),unit:text(r.unit,20,'단위'),note:text(r.note,300,'비고'),qty,price,vat}});
 return {steps,checks:[...v.checks],contractors,costs,scope:text(v.scope??'',3000,'공사 형태')};
}
export function decodeFile(value:unknown,quote=false){
 if(typeof value!=='string')throw new Problem('파일 형식 오류');const m=/^data:(image\/jpeg|image\/png|image\/webp|application\/pdf);base64,([A-Za-z0-9+/]*={0,2})$/.exec(value);if(!m||(!quote&&m[1]==='application/pdf'))throw new Problem('허용되지 않은 파일 형식입니다.');
 const bytes=Buffer.from(m[2],'base64');if(bytes.toString('base64')!==m[2]||!bytes.length||bytes.length>3*1024*1024)throw new Problem('파일은 3MB 이하여야 합니다.');
 const ext=({'image/jpeg':'jpg','image/png':'png','image/webp':'webp','application/pdf':'pdf'} as Record<string,string>)[m[1]];
 const valid=ext==='jpg'?bytes.subarray(0,3).equals(Buffer.from([255,216,255])):ext==='png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):ext==='webp'?bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP':bytes.subarray(0,5).toString()==='%PDF-';
 if(!valid)throw new Problem('파일 내용과 형식이 일치하지 않습니다.');return {bytes,mime:m[1],ext};
}


export function publicProject(source:Project):Project{
 const result=initial();result.audit=[];
 for(const id of zoneIDs()){const zone=source.zones[id];if(!zone)continue;result.zones[id].steps=zone.steps.map(s=>({status:s.status,start:s.start,end:s.end,owner:'',note:''}));
 result.zones[id].contractors=Object.fromEntries(Object.entries(zone.contractors||{}).filter(([,c])=>c.status==='진행 중'&&c.name.trim()).map(([trade,c])=>[trade,{name:c.name,contact:c.contact,phone:c.phone,status:'진행 중'}]));
 }return result;
}
