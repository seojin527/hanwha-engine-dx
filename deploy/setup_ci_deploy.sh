#!/usr/bin/env bash
# GitHub Actions 자동 배포용 서버 설정 (root, 한 번). 다시 실행해도 안전하다.
#   sudo bash deploy/setup_ci_deploy.sh /root/hanwha_dx_actions.pub
# 만드는 것:
#   - deployer 계정 (비밀번호 잠금). 전용 공개키 하나만, command= 게이트로 묶음 (셸·포워딩 불가)
#   - /usr/local/sbin/hanwha-dx-deploy-gate  (허용 명령: status | deploy <sha> | rollback <sha>)
#   - /usr/local/sbin/hanwha-dx-ci-deploy    (root 로 실행되는 배포 진입점, 잠금·백업·확인·복구)
#   - /etc/sudoers.d/hanwha-dx-deploy        (deployer 는 위 진입점 하나만 sudo 가능)
set -euo pipefail
PUBKEY_FILE=${1:?Actions 전용 공개키 파일 경로가 필요합니다}
HERE=$(cd "$(dirname "$0")" && pwd)
[[ $EUID -eq 0 ]] || { echo "root 로 실행하세요"; exit 1; }
PUBKEY=$(head -n1 "$PUBKEY_FILE")
[[ $PUBKEY =~ ^ssh-ed25519\ [A-Za-z0-9+/=]+(\ .*)?$ ]] || { echo "ed25519 공개키 한 줄이 아닙니다"; exit 1; }

id deployer >/dev/null 2>&1 || useradd --create-home --shell /bin/bash deployer
passwd -l deployer >/dev/null

install -o root -g root -m 755 "$HERE/ci/hanwha-dx-deploy-gate" /usr/local/sbin/hanwha-dx-deploy-gate
install -o root -g root -m 755 "$HERE/ci/hanwha-dx-ci-deploy" /usr/local/sbin/hanwha-dx-ci-deploy

SUDOERS=$(mktemp)
echo 'deployer ALL=(root) NOPASSWD: /usr/local/sbin/hanwha-dx-ci-deploy' > "$SUDOERS"
visudo -cf "$SUDOERS" >/dev/null
install -o root -g root -m 440 "$SUDOERS" /etc/sudoers.d/hanwha-dx-deploy
rm -f "$SUDOERS"

install -d -o deployer -g deployer -m 700 /home/deployer/.ssh
printf 'restrict,command="/usr/local/sbin/hanwha-dx-deploy-gate" %s\n' "$PUBKEY" > /home/deployer/.ssh/authorized_keys
chown deployer:deployer /home/deployer/.ssh/authorized_keys
chmod 600 /home/deployer/.ssh/authorized_keys

echo "설정 완료: deployer 계정 · 게이트 · 배포 진입점 · sudoers"
echo "서버 호스트 키 (GitHub Variable DEPLOY_KNOWN_HOSTS 값):"
for type in ed25519; do
  echo "$(hostname -I | awk '{print $1}') $(cut -d' ' -f1,2 /etc/ssh/ssh_host_${type}_key.pub)"
done
