#!/usr/bin/env bash
# 데이터 백업: /srv/hanwha-dx/{storage,vector_db,data,logs} → /srv/hanwha-dx/backups/hanwha-dx-<이름>-<시각>.tar.gz
#   sudo bash /opt/hanwha-dx/app/deploy/backup.sh            # 수동
#   (매일 04:00 hanwha-dx-backup.timer 가 'daily' 로 실행)
# 보관 개수는 이름(label)별로 따로 센다: daily 14개, 그 밖(pre-deploy·pre-restore·manual·pull) 각 10개.
# 잦은 자동 배포의 pre-deploy 백업이 daily 백업을 밀어내지 않게 하기 위함이다.
# Chroma 를 일관되게 복사하려고 백엔드를 수 초 멈췄다가 다시 시작한다.
set -euo pipefail
LABEL=${1:-manual}
DATA=/srv/hanwha-dx
OUT=$DATA/backups
[[ $LABEL =~ ^[a-z0-9-]+$ ]] || { echo "백업 이름은 영문 소문자·숫자·- 만"; exit 1; }
if [[ $LABEL == daily ]]; then KEEP=${KEEP:-14}; else KEEP=${KEEP:-10}; fi
[[ $EUID -eq 0 ]] || { echo "root 로 실행하세요 (sudo)"; exit 1; }
mkdir -p "$OUT"
FILE=$OUT/hanwha-dx-$LABEL-$(date +%Y%m%d-%H%M%S).tar.gz

was_active=0
systemctl is-active --quiet hanwha-dx && was_active=1
[[ $was_active == 1 ]] && systemctl stop hanwha-dx
trap 'if [[ $was_active == 1 ]]; then systemctl start hanwha-dx; fi' EXIT

tar -C "$DATA" --exclude='storage/ocr_jobs/worker.lock' -czf "$FILE" storage vector_db data logs
chown hanwha:hanwha "$FILE"
chmod 640 "$FILE"
echo "백업: $FILE ($(du -h "$FILE" | cut -f1))"

# 같은 이름의 오래된 백업만 정리한다.
ls -1t "$OUT"/hanwha-dx-"$LABEL"-*.tar.gz 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f
