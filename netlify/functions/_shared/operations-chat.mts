import {Problem} from './project.mjs';
export type ChatMessage={role:'user'|'assistant';content:string};
export function chatMessages(value:unknown):ChatMessage[]{
 if(!Array.isArray(value)||!value.length||value.length>10)throw new Problem('대화는 최근 10개 메시지까지 전송하세요.');
 const messages=value.map((m:any,i)=>{if(!m||!['user','assistant'].includes(m.role)||typeof m.content!=='string'||!m.content.trim()||m.content.length>1500||m.role!==(i%2===0?'user':'assistant'))throw new Problem('질문·답변 순서와 입력 길이를 확인하세요.');return {role:m.role,content:m.content.trim()} as ChatMessage});
 if(messages.at(-1)?.role!=='user')throw new Problem('마지막 질문을 입력하세요.');return messages;
}
export function guidedChat(messages:ChatMessage[],s:any,floor:string){
 const question=messages.at(-1)!.content;const previous=messages.filter(m=>m.role==='user').map(m=>m.content).join(' ');const context=/재고|식자재|수불|소비기한|입고|출고|회계|지출|수입|증빙|장부|급여|청구|요율|본인부담|사무|일정|할 일|업무|요약/.test(question)?question:previous;let answer='';
 if(/재고|식자재|수불|소비기한|입고|출고/.test(context))answer=`현재 재고는 ${s.inventory.lots}개 로트이며, 부족 기준 이하 ${s.inventory.lowStock}건, 소비기한 경과 ${s.inventory.expired}건입니다.\n식자재·기타 재고 화면에서 품목 코드, 로트, 단위와 소비기한을 확인하세요. 입고를 먼저 기록하고 출고 수량을 입력하면 잔량을 계산합니다.\n식자재 입출고와 부족 재고 점검 중 어느 작업을 도와드릴까요?`;
 else if(/회계|지출|수입|증빙|장부/.test(context))answer=`현재 입력된 수입 합계는 ${s.accounting.income.toLocaleString('ko-KR')}원, 지출 합계는 ${s.accounting.expense.toLocaleString('ko-KR')}원입니다. 전체 누적 입력 합계로 기간별 결산액은 아닙니다.\n회계 화면에서 거래일·수입/지출·분류·금액·증빙을 기록하고 영수증 및 계좌 내역과 대조하세요.\n증빙 정리와 거래 입력 절차 중 무엇이 필요하신가요?`;
 else if(/급여|청구|요율|본인부담/.test(context))answer=floor==='3'?`해온의 요양급여 산출 초안은 ${s.benefits.drafts}건, 급여 총액 합계는 ${s.benefits.gross.toLocaleString('ko-KR')}원입니다.\n급여 화면에서 입소자 코드·대상 월·이용일수·확인된 일당·본인부담률·요율 근거를 입력하세요. 법정 요율은 자동 확정하지 않으며 공단에 제출된 기록은 없습니다.\n입력 절차와 산출 내역 대조 중 어느 부분이 궁금하신가요?`:'요양급여 업무는 3층 해온 전용입니다. 현재 담당 층의 사무·회계·재고 업무를 안내해 드릴 수 있습니다.';
 else if(/사무|일정|할 일|업무|요약/.test(context))answer=`현재 등록된 전체 기록은 ${s.totalRecords}건이고, 완료되지 않은 사무 업무는 ${s.office.open}건입니다.\n사무 화면에서 업무 제목·담당자·기한·진행 상태를 기록할 수 있습니다.\n사무 일정, 회계, 식자재·재고${floor==='3'?', 요양급여':''} 중 어느 업무부터 살펴볼까요?`;
 else answer=`질문하신 “${question.slice(0,100)}”에 대한 자유 대화는 AI 연결 후 이용할 수 있습니다. 현재는 사무 일정·회계·재고${floor==='3'?'·요양급여':''} 안내와 집계 조회를 지원합니다.\n어떤 업무를 진행하시려는지 알려주세요. 예: “식자재 입고는 어떻게 입력해?”`;
 return answer;
}
