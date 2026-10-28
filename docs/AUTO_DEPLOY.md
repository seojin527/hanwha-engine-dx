# 자동 배포 (deploy-main4 → 발표 서버)

`deploy-main4` 에 push 하면 GitHub Actions 가 검사 후 서버(165.245.178.152)에 배포한다. 다른 브랜치는 배포되지 않는다.

- 관람객: https://dx.165-245-178-152.sslip.io/
- 관리자: https://admin.165-245-178-152.sslip.io/ (Basic 인증)

## 흐름

```
push(deploy-main4)
 └ checks: 프론트 의존성 → 타입 검사(tsc) → 빌드(localhost 주소 검사) → 백엔드 전체 테스트(알려진 실패만 허용)
    └ deploy (production 환경, 한 번에 하나)
       └ ssh deployer@서버 "deploy <SHA>"  ← 전용 키, 호스트 키 고정, 명령 3개만 허용
          └ 서버: 잠금 대기 → deploy-main4 커밋인지 확인 → 더 새 커밋이 이미 배포됐으면 건너뜀
                 → 데이터 백업(pre-deploy) → 체크아웃 → 그 커밋의 deploy/deploy.sh
                 → health · 공개 HTTPS · 읽기 전용 · OCR 차단 · 관리자 인증 확인
                 → 실패하면 직전 커밋으로 다시 배포 (Actions 는 실패로 표시)
       └ 서버 SHA = Actions SHA 확인 → 러너에서 외부 HTTPS 확인
```

- **검사·빌드가 실패하면 배포 단계가 실행되지 않는다.** 서버는 그대로다.
- **동시 배포 없음**: GitHub 쪽 `concurrency`(진행 중 취소 안 함) + 서버 잠금(`flock`, 끝날 때까지 대기).
  대기 중인 오래된 배포는 더 새 push 가 오면 대체되고, 늦게 도착해도 서버가 "더 새 커밋이 있음"으로 건너뛴다.
- **보존**: DB·업로드·OCR 결과·측정 기록(`/srv/hanwha-dx`), 관리자 계정·토큰·환경변수(`/etc/hanwha-dx`)는 배포가 건드리지 않는다.
  발표용 데이터 사본은 다시 복원하지 않는다 (복원은 `deploy/restore.sh` 수동 실행만).
- **정책 유지**: 서버 환경변수 `DEPLOY_MODE=public`, `OCR_ENABLED=0` 은 코드 밖에 있다. 배포 후 읽기 전용·OCR 차단·관리자 인증이 아니면 실패로 보고 되돌린다.
- **백업**: 배포마다 `/srv/hanwha-dx/backups/hanwha-dx-pre-deploy-*.tar.gz` (최근 10개), 매일 04:00 `daily` (14개). 같은 디스크이므로 중요한 시점에는 `bash deploy/pull_backup.sh 165.245.178.152` 로 노트북에 받는다.

## 테스트 처리

`backend/tools/run_ci_tests.py` 가 `backend/tests/test_*.py` **전체**를 실행한다. 건너뛰는 테스트는 없다.
`backend/tests/known_failures.txt` 에 적힌 3개(`test_ocr_results` — 결과 이미지가 JPG 만 허용되도록 바뀐 뒤 PNG 픽스처가 갱신되지 않음)만 실패를 허용하고,
그 밖의 실패가 하나라도 있으면 배포하지 않는다. 목록의 테스트가 통과하기 시작해도 CI 가 실패하므로, 고친 사람은 목록에서 지운다.

## 팀원 사용법

### 1. 수정하고 배포하기

```bash
git switch deploy-main4
git pull --ff-only origin deploy-main4
# 수정
git add <파일>
git commit -m "변경 내용"
git push origin deploy-main4
```

push 가 거부되면(다른 사람이 먼저 push) `git pull --rebase origin deploy-main4` 후 다시 push. **강제 push(`--force`) 금지.**

### 2. 결과 확인

GitHub 저장소 → **Actions** → `deploy` → 내 커밋.
- 초록 ✓: 배포 완료. `서버 배포 SHA 확인` 단계에 서버 커밋이, Summary 에 외부 확인 결과가 있다.
- 빨강 ✗ `checks`: 타입·테스트·빌드 실패 → 서버는 바뀌지 않음. 로그의 `[새 실패]`·오류를 고쳐 다시 push.
- 빨강 ✗ `deploy`: 서버 배포·확인 실패 → 로그에 `result=rolled-back` 이면 직전 버전으로 자동 복구됨. `result=broken` 이면 관리자에게 연락.
- 노란 대기: 앞 배포가 끝나기를 기다리는 중 (취소하지 말 것).

### 3. 재배포 · 롤백

- **최신 커밋 다시 배포**: Actions → `deploy` → **Run workflow** → Branch `deploy-main4`, SHA 비움 → Run (검사부터 다시).
- **이전 커밋으로 롤백**: Actions 의 이전 성공 실행에서 커밋 SHA(40자리)를 복사 → Run workflow → SHA 칸에 붙여넣기 → Run.
  검사 없이 그 커밋을 배포한다 (`deploy-main4` 이력에 있는 커밋만 가능). 다음 push 가 오면 다시 최신으로 배포된다.
- 코드로 되돌리고 싶으면 `git revert <SHA>` 후 push 하는 것이 이력상 가장 깔끔하다.

## 관리자용

- 서버 쪽 진입점은 저장소 파일이 아니라 설치본이다: `/usr/local/sbin/hanwha-dx-deploy-gate`, `/usr/local/sbin/hanwha-dx-ci-deploy`.
  `deploy/ci/` 를 고쳤으면 서버에서 `sudo bash deploy/setup_ci_deploy.sh <Actions 공개키>` 로 다시 설치한다.
- 서버 배포 기록: `/var/log/hanwha-dx-deploy/*.log`, `/opt/hanwha-dx/DEPLOYS.log`.
- 주의: `deploy-main4` 에 push 할 수 있는 사람은 그 커밋의 `deploy/deploy.sh` 를 서버 root 로 실행시킬 수 있다. 쓰기 권한은 신뢰하는 팀원에게만 준다.
- Actions 키 교체: 새 키를 만들고 `setup_ci_deploy.sh` 를 새 공개키로 다시 실행한 뒤 Secret `DEPLOY_SSH_KEY` 를 바꾼다.

### GitHub 설정 (한 번)

저장소 **Settings → Environments → New environment** `production`
- Deployment branches and tags: **Selected branches and tags** → `deploy-main4`
- Environment secrets: `DEPLOY_SSH_KEY` = Actions 전용 개인키 파일 전체 (`-----BEGIN` ~ `END-----` 포함)
- Environment variables: `DEPLOY_HOST` = `165.245.178.152`, `DEPLOY_KNOWN_HOSTS` = 서버 호스트 키 한 줄 (`setup_ci_deploy.sh` 출력)
