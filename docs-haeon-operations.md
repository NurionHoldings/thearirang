# 해온 및 층별 관리자

- 공사 후 가상 이미지 30장: `/nursing-home.html#after-gallery` (실제 준공사진·측정 도면 아님).
- 해온 전용 관리자: `/admin.html?floor=3`.
- 다른 층: `floor=b1,1,2,4,5`. 2층은 2a/2b를 함께 관리.
- 기존 전체 관리자(Identity app_metadata의 admin 역할)로 `/?owner=1`에서 로그인한 뒤 관리자 페이지에서 층별 12~128자 비밀번호 설정. 초기/공통 비밀번호를 코드에 두지 않는다.
- 비밀번호는 scrypt 솔트+해시만 보관. HttpOnly/Secure/SameSite=Strict 쿠키, 8시간 세션. 변경 시 해당 층 기존 세션 무효. 로그아웃 시 세션 삭제.
- 인증 기록은 `arirang-floor-access`, 업무는 `arirang-operations`의 `floor/{floor}` 키. production과 Deploy Preview 저장소 분리. 강한 일관성+ETag 조건 쓰기.
- 공사 자료는 서버에서 담당 구역 권한 검증; 다른 층의 공개 진행 정보만 기본 공개 범위로 제공하며 비공개 견적·연락처·메모·첨부는 공유하지 않는다.
- 사무, 수입/지출 증빙 기록, 요양급여 수기요율 산술 초안(3층만), 로트별 식자재/재고 입출고를 저장. 기록은 추가형. 중복 청구월·음수 재고·단위 혼용·동시 수정 방지.
- 등록 오류 정정/취소·이월·복원·회계 전표 승인·법정 서식·직원별 계정/직무권한·공단/회계 시스템 연계는 후속 구현 대상이다. 운영 데이터 투입 전 백업·보관/삭제 정책·실제 현장 인수 테스트가 필요하다.
- 입소자 실명·주민번호·진료정보 대신 내부 가명 코드 사용. 요양급여는 확인한 일당·부담률·일수·비급여와 근거를 입력한 검토 초안으로 공단 제출·법정요율 검증을 하지 않는다.
- AI 지원: 기존 서버 OPENAI_API_KEY 설정 시 익명 숫자 집계만 AI에 전달. 미설정 시 규칙 기반 집계를 명시. 기본 모델은 OPENAI_TEXT_MODEL 또는 gpt-4.1-mini. 외부 전송에 입소자 코드·자유 메모·품목명 제외. 자동 승인/발주/결제 없음.
- 로고: 생성 원본 `public/assets/haeon/logo-master.webp`, 벡터 애니메이션 `logo-animated.svg` (일출·온기·빛·등장 모션, reduced-motion 지원).
- 검증: `npm run typecheck`, `npm run test:netlify`, `npm run build`.
