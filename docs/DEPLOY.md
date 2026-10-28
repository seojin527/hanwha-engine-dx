# 발표용 서버 배포 (DigitalOcean 1대 · HTTPS)

노트북을 꺼도 휴대폰으로 접속되는 고정 HTTPS 주소를 만드는 절차. 파일은 [`deploy/`](../deploy) 에 있다.

## 구성

```
휴대폰 ──HTTPS──► Caddy (:443, 인증서 자동)
                   ├─ 관람객 주소  dx.<…>     : 조회 전용 (X-Admin-Token 헤더 제거)
                   └─ 관리자 주소  admin.<…>  : Basic 인증 → X-Admin-Token 헤더 추가
                         │  /api/*, /health        → uvicorn 127.0.0.1:8000 (systemd: hanwha-dx)
                         └─ 그 밖 (화면·3D·GLB)    → /opt/hanwha-dx/www (frontend 빌드본)
```

- 화면·API·3D iframe 이 **같은 origin** 이다. 빌드본의 API 주소는 `window.location.origin` 이고(`frontend/src/lib/drawingAPI.ts`),
  iframe 메시지는 `location.origin` 으로 검사하므로 공개 주소에서도 그대로 동작한다. `deploy.sh` 는 빌드본에 `localhost` 가 남으면 배포를 멈춘다.
- **서버 측 보호**: `DEPLOY_MODE=public` 이면 `backend/deploy_guard.py` 가 GET 외 요청을 403 으로 막는다.
  관리자 주소에서 Basic 인증을 통과한 요청만 Caddy 가 붙인 `X-Admin-Token` 으로 변경이 허용된다.
  로그인 화면의 역할 선택은 여전히 화면 표시용이며 인증이 아니다. 관람객이 '관리자' 역할을 골라도 저장·업로드는 서버가 막는다.
- **서버 OCR 차단 (발표 구성)**: `OCR_ENABLED=0` 이면 관리자 요청이어도 OCR 실행·샘플 OCR 저장
  (`/api/drawings/{id}/ocr/run`, `/api/drawings/{id}/ocr/sample`)을 403 으로 막는다.
  도면 파일 등록(`POST /api/parts/{id}/drawings`)은 관리자 주소에서 OCR 없이 저장되고 'OCR 미실행' 으로 표시된다 (관람객 주소는 403).
  `APP_MODULE=app:app` 이라 OCR 작업자도 없고, `deploy.sh` 는 `OCR_ENABLED=0` 에서 `app_auto:app`·`WITH_OCR=1` 을 거부한다.
  화면의 OCR 결과는 노트북에서 미리 만든 것을 데이터 사본으로 올린 것이다.
- **변경 요청 제한**: 관리자 변경 요청 IP 당 분당 60, 요청 본문 관람객 1MB·관리자 30MB. (OCR 을 켜는 구성이면 동시 1건·시간당 10건)

## 데이터 위치 (재배포해도 유지)

| 경로 | 내용 |
| --- | --- |
| `/srv/hanwha-dx/storage` | SQLite(`library.sqlite3`)·업로드 도면·OCR 결과 이미지·OCR 작업 폴더 |
| `/srv/hanwha-dx/vector_db` | Chroma 오류사례 검색 DB |
| `/srv/hanwha-dx/data` | 검수 원본 TXT·검토 결과·측정 이력 CSV (Git 샘플은 없는 것만 추가) |
| `/srv/hanwha-dx/backups` | 자동(매일 04:00 KST, 14개 보관)·배포 전·복구 전 백업 tar.gz — **서버와 같은 디스크** |
| 노트북 `C:\HW\backups\` | `demo-bundle-*.tar.gz`(올린 사본), `server\hanwha-dx-pull-*.tar.gz`(서버에서 내려받은 백업) — **외부 보관본** |
| `/etc/hanwha-dx/*.env` | 비밀값(ADMIN_TOKEN·관리자 비밀번호 해시). Git 에 없다 |
| `/opt/hanwha-dx/app` · `/www` | 코드 체크아웃 · 프론트 빌드본 (재배포 시 교체) |

> 서버 안의 백업은 Droplet 삭제·디스크 손실 때 함께 사라진다. **외부 백업이 아니다.**
> 발표 데이터는 노트북에도 둔다: 올린 사본(`demo-bundle-*.tar.gz`)을 지우지 말고, 서버에서 3D 연결·검토를 마친 뒤·발표 전날·발표 직후에
> `bash deploy/pull_backup.sh <IP>` 로 서버 백업을 노트북 `backups\server\` 로 내려받는다 (sha256 비교).

경로는 `backend/paths.py` 의 `DX_STORAGE_DIR`·`DX_VECTOR_DB_DIR`·`DX_DATA_DIR`·`DX_LOG_DIR` 로 바뀐다 (미지정 시 기존 로컬 경로 그대로).

## 메모리 실측과 서버 사양

노트북(Windows, 8코어)에서 잰 값. Linux 에서는 다소 다를 수 있어 서버에서 다시 확인한다.

| 프로세스 | 최대 메모리 | 비고 |
| --- | --- | --- |
| 백엔드 (`app_auto`, torch + E5 임베딩 + Chroma) | 약 1.24GB 작업 집합 | 시작 직후 |
| eDOCr2 CPU OCR 1건 (`HDH_63_01.pdf`) | 약 2.13GB 작업 집합 | 213초 소요, TensorFlow 2.10 |

→ **이번 발표는 $12·2GB 조회용 구성**: `OCR_ENABLED=0`, `APP_MODULE=app:app`. 백엔드 + OS + Caddy 가 2GB 안에 들어가고 스왑 2GB 는 여유분이다
(Linux 실측은 서버 생성 후 확인). OCR 결과는 노트북에서 만든 것을 데이터 사본으로 올린다.

## 비용 (2026-10 DigitalOcean 가격표 기준)

| 항목 | 금액 | 비고 |
| --- | --- | --- |
| Droplet Basic · Regular · 2GB/1vCPU/50GB/2TB 전송 | **월 $12 상한** | 초 단위 과금(최소 60초), 묶음 요금제라 월 $12 를 넘지 않음 |
| (선택) OCR 실행용 4GB/2vCPU/80GB | 월 $24 상한 | |
| 부가세 | 결제 화면 확인 | 한국 주소 계정은 VAT 10% 가 붙을 수 있음 |
| DO 자동 백업 | 선택 안 함 | 켜면 주간 +20%, 일간 +30%. 서버 내 백업 + 노트북 내려받기로 대체 |
| 도메인 | $0 | sslip.io 또는 DuckDNS 무료 호스트 이름. 자체 도메인은 연 $10~20 (선택) |
| 트래픽 | 포함량 안에서는 $0 | 아래 「트래픽」 참고. 포함량을 넘는 나가는 전송은 GiB 당 $0.01 |
| 외부 API | $0 | OCR 은 로컬 eDOCr2/Tesseract. OpenAI·Qwen 코드는 OCR 경로에서 호출되지 않음 |
| 인증서 | $0 | Let's Encrypt (Caddy 자동) |

**v5(시간당 무상한) Droplet 이 아니라 'Basic' 묶음 요금제를 고른다.**

### 트래픽 (빌드본 실측, 2026-10-28)

| 항목 | 크기 | 비고 |
| --- | --- | --- |
| 프론트 빌드본 전체 `frontend/dist` | 3.17MB | 아래 전부 포함 |
| ├ 3D 모델 GLB 5개 | 432KB | `engine-viewer/models/*.glb` |
| ├ three.js·로더 | 714KB (three.min.js 는 gzip 시 589→145KB) | |
| ├ 앱 JS·CSS | 628KB (gzip 시 161KB) | |
| └ 로그인 선화 PNG 2개 + 샘플 이미지 | 1.42MB | 압축 안 됨 |
| 도면 1건 열 때 (API) | 원본 PDF 평균 99KB(최대 224KB) + OCR 결과 이미지 약 446KB | 데이터 사본 기준 |
| 글꼴 (Pretendard·IBM Plex Mono) | 서버 트래픽 아님 | jsDelivr·Google Fonts CDN 에서 받음. CDN 이 막히면 기본 글꼴로 표시 |

관람객 1명이 처음 접속해 도면 몇 건을 열면 대략 3~6MB 다. 2,000GiB 포함량이면 수십만 회 접속에 해당해 발표 규모에서는 넘지 않을 것으로 본다.
다만 **포함량 안에서만 추가 비용이 없다.** 포함량은 Droplet 이 존재한 시간에 비례해 쌓이고(한 달 내내 있으면 2,000GiB, 1주일이면 약 500GiB),
같은 계정(팀)의 Droplet 끼리 합산되며, 넘는 나가는 전송은 GiB 당 $0.01 이 붙는다. 들어오는 전송은 무료다.

## 고정 HTTPS 주소

| 방법 | 비용 | 사용자 작업 | QR 안정성 |
| --- | --- | --- | --- |
| **sslip.io** `dx.<IP를-로-이은값>.sslip.io` | 무료 | 없음 | Droplet 을 지우고 새로 만들면 IP 가 바뀌어 주소도 바뀜 |
| **DuckDNS** `<이름>.duckdns.org` | 무료 | duckdns.org 로그인(GitHub/Google) 후 이름 만들고 IP 입력 | 서버를 다시 만들어도 IP 만 고치면 같은 주소 |
| 자체 도메인 | 연 $10~20 | 구매·DNS 설정 | 가장 안정 |

기본은 sslip.io 로 바로 시작하고, QR 인쇄 전에 DuckDNS 로 바꾸는 것을 권장한다 (`server_setup.sh` 를 새 이름으로 다시 실행 → `deploy.sh`).

## 사용자(결제자)가 할 일

1. DigitalOcean 가입·결제수단 등록 (직접).
2. Create → Droplets:
   - Region: **Singapore (SGP1)** — 한국에서 가장 가까운 지역 (서울 리전 없음)
   - Image: **Ubuntu 24.04 (LTS) x64**
   - Size: **Basic → Regular → $12/mo (2GB / 1 CPU / 50GB / 2TB)**
   - Authentication: **SSH Key** → New SSH Key 에 아래 공개키 붙여넣기 (노트북 `~/.ssh/hanwha_dx_do.pub`)
   - Backups·Monitoring 추가 옵션·Volume: 선택 안 함
   - Hostname: `hanwha-dx`
3. 생성 후 **공인 IPv4 주소**를 알려준다. 그 다음은 SSH 로 진행한다.

## 서버 준비·배포 (SSH)

```bash
scp -i ~/.ssh/hanwha_dx_do deploy/server_setup.sh root@<IP>:/root/
ssh -i ~/.ssh/hanwha_dx_do root@<IP> 'bash /root/server_setup.sh dx.<IP-대시>.sslip.io admin.<IP-대시>.sslip.io'
ssh -i ~/.ssh/hanwha_dx_do root@<IP> 'bash /opt/hanwha-dx/app/deploy/deploy.sh <브랜치 또는 커밋>'
```

### 발표용 데이터 사본 올리기

원본(storage/·vector_db/·data/)은 바뀌지 않는다. 임시 폴더의 사본에서만 제외·이름 변경을 한다.

```powershell
cd backend
# 1) 현황 확인 (읽기 전용, 로컬 서버 실행 중이어도 됨)
.venv\Scripts\python.exe tools\export_demo_bundle.py --list
# 2) 뺄 부품의 영향 확인 — 연결 도면·OCR·검토·측정 기록·파일 건수 (사본 안 만듦)
.venv\Scripts\python.exe tools\export_demo_bundle.py --exclude-part <part_id> --dry-run
# 3) 로컬 백엔드를 멈춘 뒤 사본 생성 → ..\backups\demo-bundle-<시각>.tar.gz (노트북에 보관)
.venv\Scripts\python.exe tools\export_demo_bundle.py --exclude-part <part_id> --rename-part <part_id>=<새 이름>
scp -i $HOME\.ssh\hanwha_dx_do ..\backups\demo-bundle-<시각>.tar.gz root@<IP>:/tmp/
ssh -i $HOME\.ssh\hanwha_dx_do root@<IP> "bash /opt/hanwha-dx/app/deploy/restore.sh /tmp/demo-bundle-<시각>.tar.gz"
```

- 검증용 DB 사본 폴더(`environment-verification`, `ui-verification`)는 빠진다.
- 사본에서 부품을 빼면 그 부품의 도면과, 도면에 딸린 OCR 결과·작업·측정·가공 기록·오류사례 연결·이동 기록·파일·review_history.csv 행을 지운다.
  오류사례 원문과 벡터DB 는 남긴다. 지운 뒤 외래키 검사를 하고 `VACUUM` 으로 지운 행이 파일에 남지 않게 한다.
- 자동 OCR 이 `data/origin` 에 복사하기 전에 처리된 도면은 OCR 작업 폴더의 TXT·JPG 를 사본에 채운다 (원본 폴더 변경 없음).
- **3D 유형 연결·관리자 검토는 자동으로 하지 않는다.** 아래 「대표 도면 준비」를 서버의 관리자 주소에서 한다.

### 대표 도면 준비 (서버 관리자 주소)

작업자 화면은 **관리자 검토가 끝난 도면만** 보여준다. 3D 부품을 눌러 도면을 여는 흐름은 **3D 유형에 연결된 부품**에서만 이어진다.

1. `https://admin.<…>` 접속 → Basic 인증(관리자 계정) → 로그인 화면에서 역할 '관리자'.
2. 왼쪽 트리 「3D 미연결 등록 부품」에서 대표 부품을 고르고, 정보의 「3D 부품 종류에 연결」에서 3D 유형(예: **피스톤 로드**)을 골라 「연결」.
   (또는 트리에서 3D 유형을 고른 뒤 「기존 등록 부품 연결」.) 이름이 비슷한 부품은 안내만 하고 자동 연결하지 않는다.
   같은 3D 유형에는 대표 부품 하나만 연결하는 것을 권장한다.
3. 그 부품에서 OCR 결과가 있는 도면을 연다 → 항목마다 「확인 후 다음」 → 「검토 완료 및 서버 저장」.
   이미 검토가 끝난 도면이 다른 부품에 있으면 「소속 부품 변경」으로 대표 부품으로 옮길 수 있다 (이동 이력이 남는다).
4. 관람객 주소에서 작업자 역할로 로그인 → 3D 에서 그 부품 클릭 → 연결 도면 → 도면 열기 → 「3D에서 보기」로 복귀까지 확인한다.
5. 노트북에서 `bash deploy/pull_backup.sh <IP>` 로 이 상태를 노트북에 받아 둔다.

### 새 도면 추가 (서버 OCR 이 꺼진 상태)

서버는 `OCR_ENABLED=0` 이라 관리자 주소에서도 OCR 실행이 403 이다 (2GB 서버에서 OCR 1건이 약 2.1GB).
관리자 주소에서 PDF 를 등록할 수는 있지만 'OCR 미실행' 으로 남는다. OCR·검토 결과가 필요한 도면은
노트북에서 실제 OCR 까지 끝낸 뒤 데이터째 서버로 옮긴다. 서버 DB 가 그 사이에 바뀌지 않았는지 확인하고 반영한다.

1. `bash deploy/pull_backup.sh <IP>` → 최신 서버 데이터를 노트북으로 받고, 서버 `library.sqlite3` 의 sha256 을 적어 둔다.
2. 받은 tar.gz 를 빈 폴더에 풀고, 그 폴더를 `DX_STORAGE_DIR`·`DX_VECTOR_DB_DIR`·`DX_DATA_DIR`·`DX_LOG_DIR` 로 지정해
   `DEPLOY_MODE=local OCR_ENABLED=1` 로 `app_auto:app` 을 띄운다 (`OCR_TESSDATA` 에 eng·nor 가 있는 tessdata).
3. 그 로컬 서버의 관리자 화면(또는 API)에서 부품 등록·3D 연결 → 도면 업로드(자동 OCR) → 「확인 후 다음」·「검토 완료 및 서버 저장」.
4. 로컬 서버를 멈추고 `tar -czf bundle.tar.gz storage vector_db data logs` (worker.lock 제외) 로 묶는다.
5. 서버 `library.sqlite3` sha256 이 1번과 같은지 확인한 뒤 `restore.sh bundle.tar.gz` (현재 데이터는 pre-restore 로 먼저 백업된다).

## 운영 명령

```bash
sudo bash /opt/hanwha-dx/app/deploy/deploy.sh main4          # 재배포 (배포 전 자동 백업)
sudo systemctl restart hanwha-dx                              # 백엔드 재시작
sudo systemctl status hanwha-dx caddy
journalctl -u hanwha-dx -f                                    # 백엔드 로그
sudo tail -f /var/log/caddy/hanwha-dx.log                     # 접속 로그
cat /opt/hanwha-dx/DEPLOYS.log                                # 배포한 커밋 이력
sudo bash /opt/hanwha-dx/app/deploy/backup.sh                 # 수동 백업
sudo bash /opt/hanwha-dx/app/deploy/restore.sh <tar.gz>       # 복구 (현재 데이터는 먼저 백업)
sudo bash /opt/hanwha-dx/app/deploy/set_admin_password.sh     # 관리자 비밀번호 변경
sudo cat /etc/hanwha-dx/admin-password.txt                    # 처음 생성된 관리자 계정
```

노트북으로 백업 받기 (Git Bash, 저장소 폴더에서): `bash deploy/pull_backup.sh <IP>` → `backups\server\` (Git 제외 폴더)

## SSH 키

- 이 서버 전용 키: 노트북 `C:\Users\SAMSUNG\.ssh\hanwha_dx_do`(개인키, 암호 없음)·`hanwha_dx_do.pub`(공개키). 저장소 밖이라 Git 에 올라가지 않는다.
- 개인키는 채팅·Git·메신저로 보내지 않는다. DigitalOcean 에는 공개키(`.pub`)만 등록한다.
- 키를 잃으면 새 키를 만들고 DigitalOcean 콘솔(Droplet → Access → Recovery/Droplet Console)에서 `~/.ssh/authorized_keys` 에 새 공개키를 추가한다.
- 발표 후 Droplet 을 지우면 이 키도 지워도 된다 (DigitalOcean Settings → Security 의 등록 공개키도 삭제).

## 발표 후 정리 (과금 종료)

1. 필요한 데이터를 내려받는다 (`backup.sh` 후 `scp`).
2. DigitalOcean → Droplets → `hanwha-dx` → Destroy → Destroy this Droplet. **전원 끄기(Power off)만으로는 과금이 계속된다.**
3. 스냅샷·Volume·Reserved IP 를 만들었다면 함께 삭제한다 (각각 따로 과금).
4. Billing 화면에서 남은 자원이 없는지 확인한다. DuckDNS 이름은 무료라 두어도 된다.

## 남은 제약

- 서버 인증 없음: 관람객 주소는 조회 전용으로 서버가 보호하지만, 관리자 주소는 Basic 인증 하나에 의존한다.
- 조회도 공개다: 관람객 주소를 아는 누구나 도면·OCR 결과·오류사례를 볼 수 있다. 외부 공개가 곤란한 도면은 사본에서 빼야 한다.
- 속도 제한은 단일 프로세스 메모리 기준이다 (재시작 시 초기화).
