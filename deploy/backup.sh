#!/usr/bin/env bash
# 데이터 백업: /srv/hanwha-dx/{storage,vector_db,data,logs} → /srv/hanwha-dx/backups/hanwha-dx-<이름>-<시각>.tar.gz
#   sudo bash /opt/hanwha-dx/app/deploy/backup.sh            # 수동
#   (매일 04:00 hanwha-dx-backup.timer 가 'daily' 로 실행, 최근 14개만 보관)
# Chroma 를 일관되게 복사하려고 백엔드를 수 초 멈췄다가 다시 시작한다.
set -euo pipefail
LABEL=${1:-manual}
DATA=/srv/hanwha-dx
OUT=$DATA/backups
KEEP=${KEEP:-14}
[[ $EUID -eq 0 ]] || { echo "root 로 실행하세요 (sudo)"; exit 1; }
mkdir -p "$OUT"
FILE=$OUT/hanwha-dx-$LABEL-$(date +%Y%m%d-%H%M%S).tar.gz

was_active=0
systemctl is-active --quiet hanwha-dx && was_active=1
[[ $was_active == 1 ]] && systemctl stop hanwha-dx
trap '[[ $was_active == 1 ]] && systemctl start hanwha-dx' EXIT

tar -C "$DATA" --exclude='storage/ocr_jobs/worker.lock' -czf "$FILE" storage vector_db data logs
chown hanwha:hanwha "$FILE"
chmod 640 "$FILE"
echo "백업: $FILE ($(du -h "$FILE" | cut -f1))"

# 오래된 백업 정리 (pre-deploy·pre-restore 포함 같은 규칙)
ls -1t "$OUT"/hanwha-dx-*.tar.gz 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f
