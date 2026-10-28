#!/usr/bin/env bash
# 백업 또는 노트북에서 만든 발표용 데이터 사본(tar.gz)으로 서버 데이터를 바꾼다.
#   sudo bash /opt/hanwha-dx/app/deploy/restore.sh /srv/hanwha-dx/backups/hanwha-dx-daily-....tar.gz
#   sudo bash /opt/hanwha-dx/app/deploy/restore.sh /tmp/demo-bundle-....tar.gz
# 현재 데이터는 지우지 않고 먼저 백업한 뒤 바꾼다 (pre-restore 백업).
set -euo pipefail
ARCHIVE=${1:?tar.gz 경로가 필요합니다}
DATA=/srv/hanwha-dx
[[ $EUID -eq 0 ]] || { echo "root 로 실행하세요 (sudo)"; exit 1; }
[[ -f $ARCHIVE ]] || { echo "파일 없음: $ARCHIVE"; exit 1; }

# 압축 안의 경로가 storage/ vector_db/ data/ logs/ manifest.json 뿐인지 확인한다.
if tar -tzf "$ARCHIVE" | grep -vqE '^(\./)?(storage|vector_db|data|logs)(/|$)|^(\./)?manifest\.json$'; then
  echo "예상하지 않은 경로가 들어 있습니다. 중단합니다."; tar -tzf "$ARCHIVE" | grep -vE '^(\./)?(storage|vector_db|data|logs)(/|$)' | head; exit 1
fi
tar -tzf "$ARCHIVE" | grep -qE '^(\./)?storage/library\.sqlite3$' || { echo "storage/library.sqlite3 가 없습니다. 중단합니다."; exit 1; }

if [[ -f $DATA/storage/library.sqlite3 ]]; then
  bash "$(dirname "$0")/backup.sh" pre-restore
fi

systemctl stop hanwha-dx || true
STAGE=$(mktemp -d "$DATA/restore.XXXXXX")
tar -C "$STAGE" --no-same-owner -xzf "$ARCHIVE"
for dir in storage vector_db data logs; do
  if [[ -d $STAGE/$dir ]]; then
    rm -rf "${DATA:?}/$dir.old" && { [[ -d $DATA/$dir ]] && mv "$DATA/$dir" "$DATA/$dir.old" || true; }
    mv "$STAGE/$dir" "$DATA/$dir"
  fi
done
mkdir -p "$DATA/logs"
rm -rf "$STAGE" "$DATA"/*.old
chown -R hanwha:hanwha "$DATA"
systemctl start hanwha-dx
echo "복구 완료: $ARCHIVE"
