#!/usr/bin/env bash
# 지정한 브랜치·커밋으로 배포(또는 재배포)한다. root 로 실행. 데이터(/srv/hanwha-dx)는 건드리지 않는다.
#   sudo bash /opt/hanwha-dx/app/deploy/deploy.sh main4
#   sudo bash /opt/hanwha-dx/app/deploy/deploy.sh 6f2c6fb           # 커밋 고정
#   WITH_OCR=1 sudo -E bash .../deploy.sh main4                      # OCR 환경도 설치 (OCR_ENABLED=1 인 4GB 이상 서버만)
# 순서: 데이터 백업 → 코드 체크아웃 → Python 의존성 → 프론트 빌드 → Caddy·systemd 설정 → 재시작 → /health 확인
set -euo pipefail

REF=${1:?배포할 브랜치 또는 커밋이 필요합니다}
APP=/opt/hanwha-dx/app
WWW=/opt/hanwha-dx/www
VENV=/opt/hanwha-dx/venv
VENV_OCR=/opt/hanwha-dx/venv-ocr
DATA=/srv/hanwha-dx
as_app() { sudo -u hanwha -H "$@"; }
[[ $EUID -eq 0 ]] || { echo "root 로 실행하세요 (sudo)"; exit 1; }
# hanwha 사용자로 실행하는 uv·npm 이 현재 폴더(/root 등)의 설정 파일을 읽으려다 권한 오류가 나지 않게 한다.
cd /opt/hanwha-dx
set -a; source /etc/hanwha-dx/hanwha-dx.env; set +a
OCR_ENABLED=${OCR_ENABLED:-1}
if [[ $OCR_ENABLED =~ ^(0|false|no|off)$ ]]; then
  # 조회용 구성: OCR 앱·OCR 환경을 쓰지 않는다.
  if [[ $APP_MODULE != app:app || ${WITH_OCR:-0} == 1 ]]; then
    echo "!! OCR_ENABLED=0 인데 APP_MODULE=$APP_MODULE / WITH_OCR=${WITH_OCR:-0} 입니다. app:app 으로 두세요."; exit 1
  fi
fi

echo "== 1. 배포 전 데이터 백업"
if [[ -f $DATA/storage/library.sqlite3 ]]; then
  bash "$APP/deploy/backup.sh" pre-deploy
fi

echo "== 2. 코드 ($REF)"
as_app git -C "$APP" fetch --prune origin
if as_app git -C "$APP" rev-parse --verify -q "origin/$REF" >/dev/null; then
  as_app git -C "$APP" checkout --detach "origin/$REF"
else
  as_app git -C "$APP" checkout --detach "$REF"
fi
COMMIT=$(as_app git -C "$APP" rev-parse HEAD)
echo "커밋 $COMMIT"

echo "== 3. 백엔드 의존성 (Python 3.12, CPU 전용 torch)"
[[ -x $VENV/bin/python ]] || as_app uv venv --python 3.12 "$VENV"
TORCH=$(grep -E '^torch==' "$APP/backend/requirements.txt" | cut -d'#' -f1 | tr -d ' ')
# PyPI 의 기본 torch 는 GPU 라이브러리(수 GB)를 함께 받으므로 CPU 빌드를 먼저 설치한다.
as_app uv pip install --python "$VENV/bin/python" "$TORCH" --index-url https://download.pytorch.org/whl/cpu
as_app uv pip install --python "$VENV/bin/python" -r "$APP/backend/requirements.txt"

if [[ ${WITH_OCR:-0} == 1 || $APP_MODULE == app_auto:app ]]; then
  echo "== 3b. OCR 환경 (Python 3.10, TensorFlow CPU)"
  [[ -x $VENV_OCR/bin/python ]] || as_app uv venv --python 3.10 "$VENV_OCR"
  as_app uv pip install --python "$VENV_OCR/bin/python" -r "$APP/deploy/requirements-ocr-linux.txt"
  for f in recognizer_dimensions_2.keras recognizer_gdts.keras; do
    [[ -f $APP/edocr2/edocr2/tools/models/$f ]] || echo "!! OCR 모델 없음: edocr2/edocr2/tools/models/$f (Git 제외 파일, docs/DEPLOY.md 참고)"
  done
  [[ -f /home/hanwha/.keras-ocr/craft_mlt_25k.h5 ]] || echo "!! 검출 모델 없음: /home/hanwha/.keras-ocr/craft_mlt_25k.h5 (첫 OCR 때 GitHub 에서 받으려 시도)"
fi

echo "== 4. 데이터 폴더 (Git 의 샘플 중 서버에 없는 것만 추가, 기존 파일은 덮지 않음)"
as_app rsync -a --ignore-existing "$APP/data/" "$DATA/data/"

echo "== 5. 프론트 빌드 → $WWW"
as_app npm --prefix "$APP/frontend" ci --no-audit --no-fund
as_app npm --prefix "$APP/frontend" run build
# 빌드본에 개발용 주소가 남아 있으면 휴대폰에서 동작하지 않는다.
if grep -rlE 'https?://(127\.0\.0\.1|localhost)(:[0-9]+)?' "$APP/frontend/dist" --include='*.js' --include='*.html'; then
  echo "!! 빌드본에 localhost 주소가 있습니다. 배포를 멈춥니다."; exit 1
fi
as_app rsync -a --delete "$APP/frontend/dist/" "$WWW/"

echo "== 6. Caddy · systemd"
install -m 644 "$APP/deploy/Caddyfile" /etc/caddy/Caddyfile
install -m 644 "$APP/deploy/hanwha-dx.service" /etc/systemd/system/hanwha-dx.service
install -m 644 "$APP/deploy/hanwha-dx-backup.service" /etc/systemd/system/hanwha-dx-backup.service
install -m 644 "$APP/deploy/hanwha-dx-backup.timer" /etc/systemd/system/hanwha-dx-backup.timer
# 메모리 상한을 서버 RAM 에 맞춘다 (OS·Caddy·SSH 몫 350MB 를 남김). 넘으면 백엔드만 재시작된다.
TOTAL_MB=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
mkdir -p /etc/systemd/system/hanwha-dx.service.d
printf '[Service]\nMemoryHigh=%dM\nMemoryMax=%dM\n' $((TOTAL_MB - 550)) $((TOTAL_MB - 350)) \
  > /etc/systemd/system/hanwha-dx.service.d/memory.conf
systemctl daemon-reload
# admin-auth.env 의 bcrypt 해시에는 $ 가 있어 source 하지 않고 그대로 읽는다.
export ADMIN_USER=$(grep -m1 '^ADMIN_USER=' /etc/hanwha-dx/admin-auth.env | cut -d= -f2-)
export ADMIN_PASS_HASH=$(grep -m1 '^ADMIN_PASS_HASH=' /etc/hanwha-dx/admin-auth.env | cut -d= -f2-)
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
# validate 가 root 로 로그 파일을 먼저 만들면 caddy 사용자가 열지 못해 시작에 실패한다.
chown -R caddy:caddy /var/log/caddy
systemctl enable --now caddy hanwha-dx-backup.timer
systemctl reload caddy || systemctl restart caddy

echo "== 7. 백엔드 재시작"
systemctl enable hanwha-dx
systemctl restart hanwha-dx
for i in $(seq 1 120); do
  if curl -fsS http://127.0.0.1:8000/health >/dev/null 2>&1; then break; fi
  sleep 3
done
curl -fsS http://127.0.0.1:8000/health || { echo "!! 백엔드가 시작되지 않았습니다: journalctl -u hanwha-dx -n 100"; exit 1; }
echo "$COMMIT $(date -Is) $APP_MODULE" | tee -a /opt/hanwha-dx/DEPLOYS.log
echo
echo "완료: https://$PUBLIC_HOST (관람객) / https://$ADMIN_HOST (관리자)"
