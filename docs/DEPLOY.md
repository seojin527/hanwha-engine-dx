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
- **OCR·업로드 제한**: 동시 OCR `OCR_MAX_ACTIVE`(1), 시간당 `OCR_MAX_PER_HOUR`(10), 관리자 변경 요청 IP 당 분당 60, 업로드 30MB(관리자 주소만).

## 데이터 위치 (재배포해도 유지)

| 경로 | 내용 |
| --- | --- |
| `/srv/hanwha-dx/storage` | SQLite(`library.sqlite3`)·업로드 도면·OCR 결과 이미지·OCR 작업 폴더 |
| `/srv/hanwha-dx/vector_db` | Chroma 오류사례 검색 DB |
| `/srv/hanwha-dx/data` | 검수 원본 TXT·검토 결과·측정 이력 CSV (Git 샘플은 없는 것만 추가) |
| `/srv/hanwha-dx/backups` | 자동(매일 04:00 KST, 14개 보관)·배포 전·복구 전 백업 tar.gz |
| `/etc/hanwha-dx/*.env` | 비밀값(ADMIN_TOKEN·관리자 비밀번호 해시). Git 에 없다 |
| `/opt/hanwha-dx/app` · `/www` | 코드 체크아웃 · 프론트 빌드본 (재배포 시 교체) |

경로는 `backend/paths.py` 의 `DX_STORAGE_DIR`·`DX_VECTOR_DB_DIR`·`DX_DATA_DIR`·`DX_LOG_DIR` 로 바뀐다 (미지정 시 기존 로컬 경로 그대로).

## 메모리 실측과 서버 사양

노트북(Windows, 8코어)에서 잰 값. Linux 에서는 다소 다를 수 있어 서버에서 다시 확인한다.

| 프로세스 | 최대 메모리 | 비고 |
| --- | --- | --- |
| 백엔드 (`app_auto`, torch + E5 임베딩 + Chroma) | 약 1.24GB 작업 집합 | 시작 직후 |
| eDOCr2 CPU OCR 1건 (`HDH_63_01.pdf`) | 약 2.13GB 작업 집합 | 213초 소요, TensorFlow 2.10 |

→ **2GB 서버에서는 OCR 을 서버에서 돌리지 않는다** (`APP_MODULE=app:app`, 기본값). 백엔드 + OS + Caddy 가 2GB 안에 들어가고, 스왑 2GB 는 여유분이다.
OCR 결과는 노트북에서 만든 것을 데이터 사본으로 올린다. 발표장에서 실제 OCR 실행까지 보여주려면 4GB($24) 이상으로 하고
`APP_MODULE=app_auto:app` + `WITH_OCR=1` 로 배포한다 (2 vCPU 에서 1건 수 분 예상, 미검증).

## 비용 (2026-10 DigitalOcean 가격표 기준)

| 항목 | 금액 | 비고 |
| --- | --- | --- |
| Droplet Basic · Regular · 2GB/1vCPU/50GB/2TB 전송 | **월 $12 상한** | 초 단위 과금(최소 60초), 묶음 요금제라 월 $12 를 넘지 않음 |
| (선택) OCR 실행용 4GB/2vCPU/80GB | 월 $24 상한 | |
| 부가세 | 결제 화면 확인 | 한국 주소 계정은 VAT 10% 가 붙을 수 있음 |
| DO 자동 백업 | 선택 안 함 | 켜면 주간 +20%, 일간 +30%. 서버 내 백업 + 노트북 내려받기로 대체 |
| 도메인 | $0 | sslip.io 또는 DuckDNS 무료 호스트 이름. 자체 도메인은 연 $10~20 (선택) |
| 트래픽 | $0 | 2TB 포함. 전체 앱 약 3MB, 관람객 수백 명이어도 수 GB 수준 |
| 외부 API | $0 | OCR 은 로컬 eDOCr2/Tesseract. OpenAI·Qwen 코드는 OCR 경로에서 호출되지 않음 |
| 인증서 | $0 | Let's Encrypt (Caddy 자동) |

**v5(시간당 무상한) Droplet 이 아니라 'Basic' 묶음 요금제를 고른다.**

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

노트북의 로컬 백엔드를 멈춘 뒤 (원본은 바뀌지 않는다):

```powershell
cd backend
.venv\Scripts\python.exe tools\export_demo_bundle.py      # ..\backups\demo-bundle-<시각>.tar.gz
scp -i $HOME\.ssh\hanwha_dx_do ..\backups\demo-bundle-<시각>.tar.gz root@<IP>:/tmp/
ssh -i $HOME\.ssh\hanwha_dx_do root@<IP> "bash /opt/hanwha-dx/app/deploy/restore.sh /tmp/demo-bundle-<시각>.tar.gz"
```

- 검증용 DB 사본 폴더(`environment-verification`, `ui-verification`)는 빠진다.
- 자동 OCR 이 `data/origin` 에 복사하기 전에 처리된 도면은 OCR 작업 폴더의 TXT·JPG 를 사본에 채운다 (원본 폴더 변경 없음).
- **3D 유형 연결은 자동으로 하지 않는다.** 관리자 주소에서 부품을 3D 유형(크랭크 축·커넥팅 로드·크로스헤드·피스톤 로드·피스톤 헤드)에 직접 연결한다.
- 작업자 화면은 **관리자 검토가 끝난 도면만** 보여준다. 관람객에게 보여줄 도면은 관리자 주소에서 검토를 완료해 둔다.

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

백업을 노트북으로 내려받기: `scp -i ~/.ssh/hanwha_dx_do root@<IP>:/srv/hanwha-dx/backups/<파일> .`

## 발표 후 정리 (과금 종료)

1. 필요한 데이터를 내려받는다 (`backup.sh` 후 `scp`).
2. DigitalOcean → Droplets → `hanwha-dx` → Destroy → Destroy this Droplet. **전원 끄기(Power off)만으로는 과금이 계속된다.**
3. 스냅샷·Volume·Reserved IP 를 만들었다면 함께 삭제한다 (각각 따로 과금).
4. Billing 화면에서 남은 자원이 없는지 확인한다. DuckDNS 이름은 무료라 두어도 된다.

## 남은 제약

- 서버 인증 없음: 관람객 주소는 조회 전용으로 서버가 보호하지만, 관리자 주소는 Basic 인증 하나에 의존한다.
- 조회도 공개다: 관람객 주소를 아는 누구나 도면·OCR 결과·오류사례를 볼 수 있다. 외부 공개가 곤란한 도면은 사본에서 빼야 한다.
- 속도 제한은 단일 프로세스 메모리 기준이다 (재시작 시 초기화).
