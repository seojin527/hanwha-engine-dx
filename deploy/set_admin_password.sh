#!/usr/bin/env bash
# 관리자 주소(Basic 인증)의 비밀번호를 직접 정한다. 입력은 화면에 보이지 않는다.
#   sudo bash /opt/hanwha-dx/app/deploy/set_admin_password.sh [사용자이름]
set -euo pipefail
USER_NAME=${1:-admin}
[[ $EUID -eq 0 ]] || { echo "root 로 실행하세요 (sudo)"; exit 1; }
read -rsp "새 관리자 비밀번호: " p1; echo
read -rsp "한 번 더: " p2; echo
[[ $p1 == "$p2" && ${#p1} -ge 10 ]] || { echo "두 입력이 다르거나 10자 미만입니다."; exit 1; }
printf 'ADMIN_USER=%s\nADMIN_PASS_HASH=%s\n' "$USER_NAME" "$(caddy hash-password --plaintext "$p1")" > /etc/hanwha-dx/admin-auth.env
chmod 600 /etc/hanwha-dx/admin-auth.env
rm -f /etc/hanwha-dx/admin-password.txt
systemctl restart caddy
echo "변경 완료 (사용자: $USER_NAME)"
