#!/usr/bin/env bash
# 새 Ubuntu 24.04 서버를 한 번 준비한다 (root 로 실행). 여러 번 실행해도 안전하다.
#   sudo bash server_setup.sh <공개 호스트> <관리자 호스트>
#   예) sudo bash server_setup.sh dx.203-0-113-10.sslip.io admin.203-0-113-10.sslip.io
# 하는 일: 패키지 설치(Caddy·Node 22·uv·Tesseract·Poppler), 스왑 2GB, 방화벽(22·80·443),
#          실행 사용자·폴더 생성, /etc/hanwha-dx/*.env 생성(ADMIN_TOKEN·관리자 비밀번호 무작위).
# 비밀번호는 화면에 출력하지 않고 /etc/hanwha-dx/admin-password.txt (root 전용)에 둔다.
set -euo pipefail

PUBLIC_HOST=${1:?공개 호스트 이름이 필요합니다}
ADMIN_HOST=${2:?관리자 호스트 이름이 필요합니다}
[[ $EUID -eq 0 ]] || { echo "root 로 실행하세요 (sudo)"; exit 1; }
export DEBIAN_FRONTEND=noninteractive

echo "== 패키지"
apt-get update -y
apt-get install -y git curl ca-certificates gnupg rsync sqlite3 ufw unzip \
  tesseract-ocr tesseract-ocr-eng tesseract-ocr-nor poppler-utils libgl1 libglib2.0-0

if ! command -v caddy >/dev/null; then
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y && apt-get install -y caddy
fi

if ! command -v node >/dev/null || [[ $(node -v | cut -c2- | cut -d. -f1) -lt 22 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

if ! command -v uv >/dev/null; then
  curl -LsSf https://astral.sh/uv/install.sh | env UV_INSTALL_DIR=/usr/local/bin UV_NO_MODIFY_PATH=1 sh
fi

echo "== 스왑 2GB (빌드·모델 로딩 순간 메모리 대비)"
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  sysctl -w vm.swappiness=10 && echo 'vm.swappiness=10' > /etc/sysctl.d/99-hanwha-dx.conf
fi

echo "== 방화벽"
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw --force enable

echo "== 사용자·폴더"
id hanwha >/dev/null 2>&1 || useradd --system --create-home --home-dir /home/hanwha --shell /usr/sbin/nologin hanwha
mkdir -p /opt/hanwha-dx/{app,www} /srv/hanwha-dx/{storage,vector_db,data,logs,cache,backups} /etc/hanwha-dx /var/log/caddy
chown -R hanwha:hanwha /opt/hanwha-dx /srv/hanwha-dx /home/hanwha
chmod 750 /srv/hanwha-dx

echo "== 설정 파일 (/etc/hanwha-dx)"
ENV_FILE=/etc/hanwha-dx/hanwha-dx.env
if [[ ! -f $ENV_FILE ]]; then
  cat > "$ENV_FILE" <<EOF
PUBLIC_HOST=$PUBLIC_HOST
ADMIN_HOST=$ADMIN_HOST
DEPLOY_MODE=public
ADMIN_TOKEN=$(openssl rand -hex 32)
WRITE_RATE_PER_MIN=60
OCR_MAX_ACTIVE=1
OCR_MAX_PER_HOUR=10
OCR_ENABLED=0
APP_MODULE=app:app
DX_STORAGE_DIR=/srv/hanwha-dx/storage
DX_VECTOR_DB_DIR=/srv/hanwha-dx/vector_db
DX_DATA_DIR=/srv/hanwha-dx/data
DX_LOG_DIR=/srv/hanwha-dx/logs
OCR_PYTHON=/opt/hanwha-dx/venv-ocr/bin/python
OCR_TESSDATA=/usr/share/tesseract-ocr/5/tessdata
HF_HOME=/srv/hanwha-dx/cache/huggingface
EOF
else
  sed -i "s|^PUBLIC_HOST=.*|PUBLIC_HOST=$PUBLIC_HOST|; s|^ADMIN_HOST=.*|ADMIN_HOST=$ADMIN_HOST|" "$ENV_FILE"
fi
chmod 600 "$ENV_FILE"

AUTH_FILE=/etc/hanwha-dx/admin-auth.env
if [[ ! -f $AUTH_FILE ]]; then
  password=$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-20)
  printf 'admin\n%s\n' "$password" > /etc/hanwha-dx/admin-password.txt
  chmod 600 /etc/hanwha-dx/admin-password.txt
  printf 'ADMIN_USER=admin\nADMIN_PASS_HASH=%s\n' "$(caddy hash-password --plaintext "$password")" > "$AUTH_FILE"
  chmod 600 "$AUTH_FILE"
fi

# Caddy 가 두 env 파일의 값을 Caddyfile 의 {$이름} 으로 읽게 한다.
# 패키지 기본 ExecStart 의 --environ 은 시작할 때 환경변수(ADMIN_TOKEN 등)를 저널에 그대로 찍으므로 뺀다.
mkdir -p /etc/systemd/system/caddy.service.d
cat > /etc/systemd/system/caddy.service.d/hanwha-dx.conf <<'EOF'
[Service]
ExecStart=
ExecStart=/usr/bin/caddy run --config /etc/caddy/Caddyfile
EnvironmentFile=/etc/hanwha-dx/hanwha-dx.env
EnvironmentFile=/etc/hanwha-dx/admin-auth.env
EOF
chown caddy:caddy /var/log/caddy
systemctl daemon-reload

echo "== 코드 받기 (공개 저장소라 인증 불필요)"
if [[ ! -d /opt/hanwha-dx/app/.git ]]; then
  sudo -u hanwha git clone https://github.com/seojin527/hanwha-engine-dx.git /opt/hanwha-dx/app
fi

echo
echo "준비 완료. 다음: sudo bash /opt/hanwha-dx/app/deploy/deploy.sh <브랜치 또는 커밋>"
echo "관리자 계정은 sudo cat /etc/hanwha-dx/admin-password.txt 로 확인하고, 바꾸려면 deploy/set_admin_password.sh 를 쓴다."
