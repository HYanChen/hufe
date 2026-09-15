#!/bin/bash
# Existing hufe.pla.wiki installation only. Never seed or import local user data.
set -Eeuo pipefail
umask 077
cd "$(dirname "$0")"
ROOT=/www/hufe-platform
WEB=/www/wwwroot/hufe.pla.wiki
RELEASE=$(pwd -P)
STAMP=$(basename "$RELEASE")
BACKUP="$ROOT/backups/$STAMP"
OLD_NAME="hufe-api-before-$STAMP"
curl() { command curl --connect-timeout 5 --max-time 12 "$@"; }
test "$RELEASE" = "$ROOT/releases/$STAMP"
[[ "$STAMP" =~ ^[a-zA-Z0-9][a-zA-Z0-9._-]{7,95}$ ]]
exec 9>"$ROOT/deploy.lock"
flock -n 9
IMAGE=$(docker image inspect node:22-alpine --format '{{.Id}}')
docker run --rm --network none -v "$RELEASE:/release:ro" "$IMAGE" node /release/release.cjs /release "$STAMP"
INSPECT=$(docker inspect hufe-api | docker run --rm -i --network none -v "$RELEASE:/release:ro" "$IMAGE" node /release/preflight.cjs container)
read -r OLD_APP OLD_PORT GATEWAY <<< "$INSPECT"
NEW_PORT=8788
[ "$OLD_PORT" = 8788 ] && NEW_PORT=8787
test "$OLD_APP" != "$RELEASE/server"
test "$(readlink -f "$OLD_APP")" = "$OLD_APP"
test -z "$(docker ps -q --filter "publish=$NEW_PORT")"
test -z "$(ss -H -ltn "sport = :$NEW_PORT")"
test -f "$ROOT/shared/runtime.env"
test -f "$ROOT/shared/data/application-data.json"
test -d "$OLD_APP/node_modules"
test ! -e "$BACKUP"
test ! -e server/node_modules
test -z "$(docker ps -aq --filter "name=^/$OLD_NAME$")"
test -x /www/server/nginx/sbin/nginx
# The rollback files are restored using same-filesystem renames.
test "$(stat -c %d "$ROOT")" = "$(stat -c %d "$WEB")"
SHARED_KB=$(du -sk "$ROOT/shared" | awk '{print $1}')
WEB_KB=$(du -sk "$WEB" | awk '{print $1}')
DEPS_KB=$(du -sk "$OLD_APP/node_modules" | awk '{print $1}')
RELEASE_KB=$(du -sk "$RELEASE" | awk '{print $1}')
FREE_KB=$(df -Pk "$ROOT" | awk 'END {print $4}')
NEEDED_KB=$((SHARED_KB * 2 + WEB_KB + DEPS_KB + RELEASE_KB + 1048576))
if [ "$FREE_KB" -lt "$NEEDED_KB" ]; then echo "Insufficient disk space for release and rollback: need ${NEEDED_KB} KiB, available ${FREE_KB} KiB" >&2; exit 1; fi
docker run --rm --network none -v "$RELEASE:/release:ro" -v "$OLD_APP/package.json:/old-package.json:ro" "$IMAGE" node /release/preflight.cjs dependencies
# Validate the current route layout before changing service availability.
docker run --rm --network none -v "$RELEASE:/release:ro" -v /www/server/panel/vhost/rewrite/hufe.pla.wiki.conf:/original.conf:ro "$IMAGE" node -e 'require("/release/nginx.cjs").activateConfig(require("node:fs").readFileSync("/original.conf","utf8"),process.argv[1],process.argv[2]);console.log("Existing proxy routes validated")' "$OLD_PORT" "$NEW_PORT"
# Reuse already installed dependencies: no registry install and no credential changes.
cp -a "$OLD_APP/node_modules" server/node_modules
mkdir -p server/data
docker run --rm --network none --user 1000:1000 --env-file "$ROOT/shared/runtime.env" \
  --env "TRUSTED_PROXY_CIDRS=$GATEWAY/32,127.0.0.1/32,::1/128" --env AUDIT_GEO_DIR=/app/ip-region \
  -v "$RELEASE/server:/app:ro" -v "$RELEASE:/release:ro" -v "$ROOT/shared/data:/production-data:ro" -w /app "$IMAGE" node --input-type=module -e \
  'import "./src/app.js"; import fs from "node:fs"; import checks from "/release/preflight.cjs"; import {createConfig} from "./src/config.js"; import {GeoLocator} from "./src/audit/geo-location.js"; const c=createConfig(); checks.assertProduction(c); fs.accessSync("/production-data/application-data.json",fs.constants.R_OK); const g=new GeoLocator(c.auditGeoDir); await g.init(); if(g.status().databases.length!==2) throw Error("Both geo databases required"); console.log("Source, production paths, data permissions and IPv4/IPv6 databases checked");'
install -d -m 700 "$BACKUP"
cp -a "$WEB" "$BACKUP/web"
cp -a /www/server/panel/vhost/rewrite/hufe.pla.wiki.conf "$BACKUP/routes.conf"
PHASE=ready
DONE=false
rollback() {
  code=$?
  trap - EXIT INT TERM HUP
  if [ "$DONE" = true ]; then
    /www/server/nginx/sbin/nginx -t && /www/server/nginx/sbin/nginx -s reload
    echo "UPDATE_COMMITTED_CHECK_FAILED release=$RELEASE; current data preserved; inspect online checks before declaring success." >&2
    exit "$code"
  fi
  set +e
  echo "Update failed; preserving failed version and restoring previous service." >&2
  if [ "$PHASE" != ready ]; then
    if docker inspect "$OLD_NAME" >/dev/null 2>&1; then
      if docker inspect hufe-api >/dev/null 2>&1; then
        if ! docker stop hufe-api >/dev/null 2>&1; then
          echo "ROLLBACK_BLOCKED: candidate could not be stopped; maintenance and current data preserved." >&2
          exit 1
        fi
        docker update --restart=no hufe-api >/dev/null 2>&1 || true
        if ! docker rename hufe-api "hufe-api-failed-$STAMP"; then
          echo "ROLLBACK_BLOCKED: candidate rename failed; maintenance and current data preserved." >&2
          exit 1
        fi
      fi
      if ! docker rename "$OLD_NAME" hufe-api; then
        echo "ROLLBACK_BLOCKED: previous container rename failed; maintenance and current data preserved." >&2
        exit 1
      fi
    fi
    if [ -d "$BACKUP/restore-shared-ready" ]; then
      if mv "$ROOT/shared" "$BACKUP/shared-after-failure"; then
        if ! mv "$BACKUP/restore-shared-ready" "$ROOT/shared"; then
          mv "$BACKUP/shared-after-failure" "$ROOT/shared"
          echo "ROLLBACK_BLOCKED: previous data restore failed; maintenance preserved." >&2
          exit 1
        fi
      else
        echo "ROLLBACK_BLOCKED: current data could not be preserved; maintenance kept closed." >&2
        exit 1
      fi
    fi
    # One common bind mount is required: rename across two bind mounts is EXDEV.
    if ! docker run --rm --network none -v /www:/www -v "$RELEASE:/release:ro" "$IMAGE" node /release/restore-web.cjs "$BACKUP/web" "$WEB"; then
      echo "ROLLBACK_BLOCKED: static restore failed; previous data restored and maintenance preserved." >&2
      exit 1
    fi
    docker update --restart=unless-stopped hufe-api >/dev/null 2>&1 || true
    if ! docker start hufe-api >/dev/null; then
      echo "ROLLBACK_BLOCKED: previous API could not start; maintenance preserved." >&2
      exit 1
    fi
  fi
  cp -a "$BACKUP/routes.conf" /www/server/panel/vhost/rewrite/hufe.pla.wiki.conf
  /www/server/nginx/sbin/nginx -t && /www/server/nginx/sbin/nginx -s reload
  [ "$code" = 0 ] && code=1
  exit "$code"
}
trap rollback EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP
docker run --rm --network none -v /www/server/panel/vhost/rewrite:/routes -v "$RELEASE:/release:ro" "$IMAGE" node /release/maintenance.cjs
/www/server/nginx/sbin/nginx -t
/www/server/nginx/sbin/nginx -s reload
gated=false
for i in {1..5}; do
  if [ "$(curl --silent --output /dev/null --write-out '%{http_code}' https://hufe.pla.wiki/api/v1/auth/registration/config)" = 503 ]; then gated=true; break; fi
  sleep 1
done
test "$gated" = true
PHASE=stopping
docker stop hufe-api >/dev/null
PHASE=stopped
tar -czf "$BACKUP/shared.tar.gz.next" -C "$ROOT" shared
mv "$BACKUP/shared.tar.gz.next" "$BACKUP/shared.tar.gz"
chmod 600 "$BACKUP/shared.tar.gz"
# Prepare an entire rollback copy before changes. Rollback then uses only same-disk
# renames, so ENOSPC cannot force decompression or abandon the live data directory.
cp -a "$ROOT/shared" "$BACKUP/restore-shared.tmp"
mv "$BACKUP/restore-shared.tmp" "$BACKUP/restore-shared-ready"
docker run --rm --network none -v "$ROOT/shared/data:/data:ro" -v "$BACKUP:/backup" -v "$RELEASE/verify-accounts.cjs:/verify.cjs:ro" "$IMAGE" node /verify.cjs snapshot
docker run --rm --network none -v "$ROOT/shared:/shared" -v "$RELEASE/set-runtime.cjs:/set-runtime.cjs:ro" "$IMAGE" node /set-runtime.cjs "$GATEWAY"
docker run --rm --network none --user 1000:1000 --env-file "$ROOT/shared/runtime.env" -v "$RELEASE/server:/app:ro" -v "$ROOT/shared/data:/app/data:rw" -w /app "$IMAGE" node src/cli/merge-region-seed.js --data-file /app/data/application-data.json --apply --service-stopped
docker rename hufe-api "$OLD_NAME"
docker run -d --name hufe-api --restart unless-stopped --user 1000:1000 --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=64m --cap-drop ALL --security-opt no-new-privileges \
  --log-opt max-size=10m --log-opt max-file=3 --env-file "$ROOT/shared/runtime.env" \
  -p "127.0.0.1:$NEW_PORT:8787" -v "$RELEASE/server:/app:ro" -v "$ROOT/shared/data:/app/data:rw" \
  -w /app "$IMAGE" node src/index.js >/dev/null
healthy=false
for i in {1..45}; do
  if curl --fail --silent "http://127.0.0.1:$NEW_PORT/health" >/dev/null; then healthy=true; break; fi
  sleep 1
done
test "$healthy" = true
docker run --rm --network none -v "$ROOT/shared/data:/data:ro" -v "$BACKUP:/backup:ro" -v "$RELEASE/verify-accounts.cjs:/verify.cjs:ro" "$IMAGE" node /verify.cjs verify
# Copy assets before switching entry HTML; retain old assets for already-open clients.
for source in frontend admin; do
  target="$WEB"; [ "$source" = admin ] && target="$WEB/admin"
  mkdir -p "$target"
  for file in "$source/"*; do
    [ "$(basename "$file")" = index.html ] && continue
    cp -a "$file" "$target/"
  done
  cp -a "$source/index.html" "$target/index.html.next"
  chmod 644 "$target/index.html.next"
  mv "$target/index.html.next" "$target/index.html"
done
find "$WEB" -name .user.ini -prune -o -exec chmod a+rX {} +
curl --fail --silent "http://127.0.0.1:$NEW_PORT/health" >/dev/null
curl --fail --silent https://hufe.pla.wiki/admin/ >/dev/null
test "$(curl --silent --output /dev/null --write-out '%{http_code}' "http://127.0.0.1:$NEW_PORT/api/v1/admin/audit-logs")" = 401
docker update --restart=no "$OLD_NAME" >/dev/null
# New API was only on an unexposed loopback port during acceptance. Old Nginx
# workers still target the stopped previous port, never the candidate writer.
docker run --rm --network none -v /www/server/panel/vhost/rewrite:/routes -v "$BACKUP/routes.conf:/original.conf:ro" -v "$RELEASE:/release:ro" "$IMAGE" node /release/activate.cjs "$OLD_PORT" "$NEW_PORT"
/www/server/nginx/sbin/nginx -t
# From this point the verified new API is committed. Never restore an old data
# snapshot after the maintenance gate may have opened for real users.
DONE=true
/www/server/nginx/sbin/nginx -s reload
PHASE=done
# Public checks compare the actual entry HTML and JS/CSS hashes with this release.
# Failure after opening traffic never restores an old data snapshot.
docker run --rm -v "$RELEASE:/release:ro" "$IMAGE" node /release/online.cjs
trap - EXIT INT TERM HUP
echo "UPDATE_OK release=$RELEASE backup=$BACKUP previous_container=$OLD_NAME port=$NEW_PORT"
