# 관리자 비공개 제안서

홈에서 총괄관리자 또는 1층 관리자 세션이 확인되면 비공개 문서 패널을 표시합니다. 일반 방문자와 다른 층 관리자에게는 패널을 만들지 않으며, 서버 역시 읽기·다운로드·등록 요청마다 권한을 확인합니다.

PDF 원문은 public/dist 또는 저장소에 평문으로 두지 않습니다. 최초 문서는 AES-256-GCM 암호문으로 서버 모듈에 포함하고, 복호화 키는 Netlify의 production Functions 전용 secret `ARIRANG_PROPOSAL_KEY_20261102`에서만 읽습니다. 키 값은 저장소·빌드 출력·브라우저에 포함하지 않습니다. 배포 아티팩트의 암호문도 같은 키가 있어야 복호화할 수 있습니다.

인증된 최초 조회 시 복호화한 PDF를 production 전용 비공개 Blobs에 조건부 등록합니다. 기존 문서가 있으면 덮어쓰지 않습니다. preview는 별도 deploy store를 사용하며 production 키를 제공하지 않으므로 최초 문서는 자동 등록되지 않습니다. 이후에는 패널에서 3MB 이하 PDF를 등록·교체할 수 있습니다. 교체에는 최신 ETag가 필요합니다.

이 문서 패널은 공개자료 출력 목록과 별개입니다. 응답은 `private, no-store`, CDN `no-store`, `Vary: Cookie`, 검색 제외 헤더를 사용합니다. 다운로드는 서버 권한 확인 후 attachment로 전송하며, 원문 경로를 공개하지 않습니다.

검증: `npm run typecheck`, `node --test tests/netlify/opening-proposal.test.mjs`, `npm run build`. 브라우저 검증은 관리자 표시·PDF 등록·다운로드·로그아웃 후 제거를 확인합니다. Netlify 환경변수 변경은 재배포 후 적용됩니다.
