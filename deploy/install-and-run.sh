#!/usr/bin/env bash
# Bootstraps a fresh Ubuntu VM. Written for Oracle Cloud Always Free (Ampere A1 / arm64); works unchanged on any
# x86 or arm64 Ubuntu VM (e.g. a Hetzner CX instance).
# Usage: DOMAIN=pulse.example.com REPO=https://github.com/you/competitorpulse.git bash install-and-run.sh
set -euo pipefail
: "${REPO:?set REPO to the git clone URL}"
: "${DOMAIN:?set DOMAIN to the hostname pointing at this VM}"

# Docker Engine + compose plugin
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER"
fi

# Oracle's Ubuntu images ship an iptables ruleset that drops 80/443; open them.
if command -v iptables >/dev/null; then
  sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
  sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
  sudo netfilter-persistent save 2>/dev/null || true
fi

sudo mkdir -p /opt/competitorpulse
sudo chown "$USER" /opt/competitorpulse
if [ ! -d /opt/competitorpulse/.git ]; then
  git clone "$REPO" /opt/competitorpulse
fi
cd /opt/competitorpulse
git pull --ff-only
grep -q '^DOMAIN=' .env 2>/dev/null || echo "DOMAIN=$DOMAIN" >> .env
grep -q '^POLL_INTERVAL_SECONDS=' .env 2>/dev/null || echo "POLL_INTERVAL_SECONDS=120" >> .env

sudo docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
sudo docker compose -f docker-compose.yml -f docker-compose.prod.yml ps
echo "Up. Visit https://$DOMAIN (first TLS certificate takes ~30s)."
