# 더 아리랑 스토어 · Netlify 배포

## GitHub 연결

Netlify에서 Add new project → Import an existing project → GitHub → `NurionHoldings/thearirang`을 선택합니다.

- 배포 브랜치: `main`
- Base directory: 비워 두기
- Build command: `npm run build`
- Publish directory: `dist`
- Functions directory: `netlify/functions`
- Node.js: 22 (`netlify.toml`에 설정)

`dist`만 드래그해 올리면 저장 API가 배포되지 않습니다. 반드시 Git 연동 또는 프로젝트 루트에서 Netlify CLI 배포를 사용하세요.

## 관리자 계정 설정 (필수)

1. 사이트의 Identity를 활성화합니다. 대시보드 메뉴 이름은 계정 화면에 따라 달라질 수 있습니다.
2. Registration을 **Invite only**로 설정합니다.
3. 소유주/담당자 이메일을 초대합니다. 계정에 **admin** 역할을 부여합니다 (서버 관리 `app_metadata.roles`).
4. 받은 초대 링크로 접속해서 비밀번호를 설정합니다.
5. 화면의 관리자 로그인에서 이메일·비밀번호를 입력합니다.

관리자 계정 생성·초대와 역할 설정은 운영자가 합니다. 공유 비밀번호나 API 키를 소스에 넣지 않습니다. 비밀번호 분실 시 Netlify Identity의 비밀번호 복구 이메일을 사용하세요. 일반 계정은 저장·자료 열람 권한이 없습니다.

## 데이터와 파일

- Netlify Functions가 공정·점검·업체·공사비·사진·견적서 저장 요청을 처리합니다.
- Netlify Blobs에 데이터를 저장합니다. 운영 배포는 사이트 저장소를 사용하므로 재배포 후에도 기록이 유지됩니다.
- 미리보기/개발 배포는 배포별 저장소를 사용합니다. 운영 기록을 수정하지 않으며 새 미리보기에서는 이전 미리보기 기록이 공유되지 않습니다.
- 미로그인 화면은 초기 공사 계획과 예상도만 표시합니다. 실제 연락처·금액·사진·견적서 및 파일 주소는 관리자 인증이 필요합니다.
- 파일은 JPEG/PNG/WebP, 견적서는 추가로 PDF를 허용합니다. 파일당 3MB, 사진 묶음당 최대 20장입니다. 큰 사진은 크기를 줄인 후 업로드하세요.
- 버전과 저장소 ETag를 함께 비교해서 동시 수정 덮어쓰기를 막습니다. 충돌 안내 시 새로고침 후 다시 입력합니다.
- 최근 변경 메타데이터 500건을 저장합니다. 정식 감사 기록/복구 백업 기능은 별도입니다.
- 기존 Python 서버의 SQLite 데이터는 자동 이관되지 않습니다. 기존 등록 자료가 있으면 별도 이전이 필요합니다.

## 검증과 운영 점검

```sh
npm ci
npm run typecheck
npm run test:netlify
npm run build
npx netlify functions:build --src netlify/functions --functions .netlify/verify-functions
```

실제 배포 후 관리자 로그인 → 층별 기록 저장 → 사진/견적 업로드 → 새로고침 → 재배포 후 자료 유지 순서로 확인하세요. 로그아웃한 별도 창에서는 실제 자료와 `/uploads/` 주소가 열리지 않아야 합니다. PC/모바일과 소유주 기기에서 한국어 음성 재생을 확인하세요. Identity는 로컬 에뮬레이터와 다르게 동작할 수 있어 실제 배포에서 확인이 필요합니다.

예상도는 제공된 컨셉 이미지입니다. 업로드 사진에 따른 AI 자동 예상도 생성은 아직 연결되지 않았습니다. 아르카온은 입력 기반 검토 보조 기능입니다.

Python 로컬 서버(`python3 server.py`)도 유지됩니다. Netlify에서는 Python 서버 대신 위 함수를 사용하며 두 저장소는 서로 공유되지 않습니다.
