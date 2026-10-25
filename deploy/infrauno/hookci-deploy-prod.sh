#!/bin/bash
# HookCI production deploy (KCuppens/bugwatch .hookci.yml, deployments.production.run).
# Host path: /opt/buguno/hookci-deploy-prod.sh, root-owned 0755. hookci-deploy may run
# only this file as root (/etc/sudoers.d/hookci-buguno).
#
# The deploy step builds bugwatch-{server,web,mcp}:sha-<12 hex> as hookci-deploy
# (scripts/deploy/build-images.sh), then calls this with the full sha. This checks the
# three images exist, flips the cell with deploy-cell.sh under one lock, and keeps the
# newest 3 tags per image (plus the live one) for rollback:
#   IMAGE_TAG=sha-<old> bash /opt/infrauno/scripts/deploy-cell.sh buguno
set -euo pipefail
[ "$#" -eq 1 ] && [[ "$1" =~ ^[0-9a-f]{40}$ ]] || { echo "usage: $0 <full sha>" >&2; exit 2; }
tag="sha-${1:0:12}"
images=(bugwatch-server bugwatch-web bugwatch-mcp)

for img in "${images[@]}"; do
  docker image inspect "$img:$tag" >/dev/null 2>&1 || { echo "missing image $img:$tag" >&2; exit 1; }
done

exec 9>/var/lock/buguno-deploy.lock
flock -w 1800 9 || { echo "another buguno deploy holds the lock" >&2; exit 1; }

echo "==> $(date -Is) deploy $1 ($tag)" | tee -a /opt/buguno/deploys.log
IMAGE_TAG="$tag" bash /opt/infrauno/scripts/deploy-cell.sh buguno 2>&1 | tee -a /opt/buguno/deploys.log

for img in "${images[@]}"; do
  docker image ls "$img" --format '{{.CreatedAt}}\t{{.Tag}}' | sort -r | cut -f2 \
    | grep -E '^sha-[0-9a-f]{12}$' | grep -vx "$tag" | tail -n +3 \
    | while read -r old; do docker image rm "$img:$old" >/dev/null || true; done
done
