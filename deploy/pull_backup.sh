#!/usr/bin/env bash
# 노트북(Git Bash)에서 실행: 서버에서 지금 백업을 만들고 노트북으로 내려받는다.
#   bash deploy/pull_backup.sh <서버 IP>
# 서버 안의 자동 백업(/srv/hanwha-dx/backups)은 같은 디스크에 있어 서버를 지우거나 디스크를 잃으면 함께 사라진다.
# 관리자 주소에서 3D 연결·검토를 마친 뒤, 발표 전날, 발표 직후에 한 번씩 실행해 노트북에 보관한다.
set -euo pipefail
HOST=${1:?서버 IP 가 필요합니다}
KEY=${SSH_KEY:-$HOME/.ssh/hanwha_dx_do}
DEST=$(cd "$(dirname "$0")/.." && pwd)/backups/server
mkdir -p "$DEST"

remote=$(ssh -i "$KEY" "root@$HOST" 'bash /opt/hanwha-dx/app/deploy/backup.sh pull >/dev/null && ls -1t /srv/hanwha-dx/backups/hanwha-dx-pull-*.tar.gz | head -1')
scp -i "$KEY" "root@$HOST:$remote" "$DEST/"
local_file=$DEST/$(basename "$remote")
remote_sum=$(ssh -i "$KEY" "root@$HOST" "sha256sum '$remote'" | cut -d' ' -f1)
local_sum=$(sha256sum "$local_file" | cut -d' ' -f1)
[[ $remote_sum == "$local_sum" ]] || { echo "!! 내려받은 파일의 해시가 다릅니다: $local_file"; exit 1; }
echo "노트북 보관: $local_file (sha256 일치)"
