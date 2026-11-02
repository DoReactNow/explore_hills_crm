#!/usr/bin/env bash
# Prepares a fresh Ubuntu VPS, run once as root over SSH. It creates the deploy user with the given public
# key, and turns password sign-in off only after confirming that key is in place. Not yet run on the real VPS.
# Usage: bash setup-vps.sh "<ssh public key>"
set -euo pipefail
key="${1:?give the deploy user's SSH public key}"
export DEBIAN_FRONTEND=noninteractive

apt-get update -q
apt-get install -y -q ca-certificates curl ufw fail2ban unattended-upgrades cron
if ! command -v docker > /dev/null; then curl -fsSL https://get.docker.com | sh; fi

id deploy > /dev/null 2>&1 || adduser --disabled-password --gecos "" deploy
usermod -aG docker deploy
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
grep -qxF "$key" /home/deploy/.ssh/authorized_keys 2>/dev/null || echo "$key" >> /home/deploy/.ssh/authorized_keys
chown deploy:deploy /home/deploy/.ssh/authorized_keys
chmod 600 /home/deploy/.ssh/authorized_keys

install -d -m 750 -o deploy -g deploy /opt/explorehills /opt/explorehills/scripts /opt/explorehills/releases /opt/explorehills/backups /opt/explorehills/rclone
# The app and worker run as uid 1000 in their containers; the group lets the deploy user back files up.
install -d -m 2770 -o 1000 -g deploy /opt/explorehills/storage

ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

if [ -s /home/deploy/.ssh/authorized_keys ]; then
  printf 'PasswordAuthentication no\nPermitRootLogin prohibit-password\n' > /etc/ssh/sshd_config.d/90-explorehills.conf
  systemctl reload ssh || systemctl reload sshd
fi

if [ "$(free -m | awk '/^Swap:/ {print $2}')" = "0" ] && [ ! -e /swapfile ]; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# Nightly at 02:30 server time. Only starts backing up once the deploy folder has its script.
cat > /etc/cron.d/explorehills-backup <<'CRON'
30 2 * * * deploy cd /opt/explorehills && [ -f rclone/rclone.conf ] && scripts/backup-offsite.sh >> backups/offsite.log 2>&1
CRON
systemctl enable --now cron unattended-upgrades fail2ban
echo "Done. Test 'ssh deploy@this-server' in a NEW window before closing this one."
