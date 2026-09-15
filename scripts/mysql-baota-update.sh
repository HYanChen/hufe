#!/bin/bash
# One-time JSON -> MySQL cutover for the existing hufe.pla.wiki installation.
# MySQL and matching Linux node_modules must already be provisioned/packaged.
# Never reads a workstation database and never overwrites a nonempty MySQL DB.
set -Eeuo pipefail
umask 077
cd "$(dirname "$0")"
ROOT=/www/hufe-platform
WEB=/www/wwwroot/hufe.pla.wiki
RELEASE=$(pwd -P)
STAMP=$(basename "$RELEASE")
BACKUP="$ROOT/backups/$STAMP"
OLD_NAME="hufe-api-before-$STAMP"
MYSQL_ENV="$ROOT/mysql/application.env"
curl() { command curl --connect-timeout 5 --max-time 12 "$@"; }
test "$RELEASE" = "$ROOT/releases/$STAMP"
[[ "$STAMP" =~ ^[a-zA-Z0-9][a-zA-Z0-9._-]{7,95}$ ]]
test "${STAMP//../}" = "$STAMP"
exec 9>"$ROOT/deploy.lock"
flock -n 9
IMAGE=$(docker image inspect node:22-alpine --format '{{.Id}}')
docker run --rm --network none -v "$RELEASE:/release:ro" "$IMAGE" node /release/release.cjs /release "$STAMP"
INSPECT=$(docker inspect hufe-api | docker run --rm -i --network none -v "$RELEASE:/release:ro" "$IMAGE" node /release/preflight.cjs container)
read -r OLD_APP OLD_PORT GATEWAY <<< "$INSPECT"
docker inspect hufe-api | docker run --rm -i --network none -v "$RELEASE:/release:ro" "$IMAGE" node /release/mysql-baota-preflight.cjs source
docker inspect hufe-mysql | docker run --rm -i --network none -v "$RELEASE:/release:ro" "$IMAGE" node /release/mysql-baota-preflight.cjs container
docker network inspect hufe-db | docker run --rm -i --network none -v "$RELEASE:/release:ro" "$IMAGE" node /release/mysql-baota-preflight.cjs network
docker run --rm --network none -v "$ROOT/mysql:/mysql:ro" -v "$RELEASE:/release:ro" "$IMAGE" node /release/mysql-baota-preflight.cjs database
DB_NAME=$(docker run --rm --network none -v "$ROOT/mysql:/mysql:ro" -v "$RELEASE:/release:ro" "$IMAGE" node /release/mysql-baota-preflight.cjs name)
# Fresh target required even after a failed earlier import. A preserved failed
# database is investigated or a new empty target is explicitly provisioned.
test "$(docker exec hufe-mysql mysql --defaults-extra-file=/run/secrets/client.cnf --batch --skip-column-names -e "SELECT COUNT(*) FROM information_schema.schemata WHERE schema_name='$DB_NAME';")" = 1
test "$(docker exec hufe-mysql mysql --defaults-extra-file=/run/secrets/client.cnf --batch --skip-column-names -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$DB_NAME';")" = 0
NEW_PORT=8788
[ "$OLD_PORT" = 8788 ] && NEW_PORT=8787
test "$OLD_APP" != "$RELEASE/server"
test "$(readlink -f "$OLD_APP")" = "$OLD_APP"
test -z "$(docker ps -q --filter "publish=$NEW_PORT")"
test -z "$(ss -H -ltn "sport = :$NEW_PORT")"
test -f "$ROOT/shared/runtime.env"
test -f "$ROOT/shared/data/application-data.json"
test -f "$RELEASE/server/src/cli/mysql-data.js"
test -f "$RELEASE/server/src/cli/prepare-mysql-snapshots.js"
test -f "$RELEASE/server/data/.mountpoint"
test -f "$RELEASE/server-dependencies.tar.gz"
test ! -e "$BACKUP"
test ! -e server/node_modules
test -z "$(docker ps -aq --filter "name=^/$OLD_NAME$")"
test -x /www/server/nginx/sbin/nginx
test "$(stat -c %d "$ROOT")" = "$(stat -c %d "$WEB")"
SHARED_KB=$(du -sk "$ROOT/shared" | awk '{print $1}')
WEB_KB=$(du -sk "$WEB" | awk '{print $1}')
RELEASE_KB=$(du -sk "$RELEASE" | awk '{print $1}')
FREE_KB=$(df -Pk "$ROOT" | awk 'END {print $4}')
NEEDED_KB=$((SHARED_KB * 2 + WEB_KB + RELEASE_KB * 4 + 1048576))
if [ "$FREE_KB" -lt "$NEEDED_KB" ]; then echo "Insufficient disk space for cutover and rollback: need ${NEEDED_KB} KiB, available ${FREE_KB} KiB" >&2; exit 1; fi
docker run --rm --network none -v "$RELEASE:/release:ro" -v /www/server/panel/vhost/rewrite/hufe.pla.wiki.conf:/original.conf:ro "$IMAGE" node -e 'require("/release/nginx.cjs").activateConfig(require("node:fs").readFileSync("/original.conf","utf8"),process.argv[1],process.argv[2]);console.log("Existing proxy routes validated")' "$OLD_PORT" "$NEW_PORT"
# This archive is part of the verified release. It must contain only regular
# files/directories under node_modules; runtime does not require executable bins.
tar -tzf server-dependencies.tar.gz | docker run --rm -i --network none -v "$RELEASE:/release:ro" "$IMAGE" node /release/mysql-baota-dependencies.cjs paths
tar -tvzf server-dependencies.tar.gz | docker run --rm -i --network none -v "$RELEASE:/release:ro" "$IMAGE" node /release/mysql-baota-dependencies.cjs types
# Only public dependency files use normal read/traverse permissions. Keep the
# outer 077 mask for backups, runtime credentials and MySQL exports.
(
  umask 022
  tar -xzf server-dependencies.tar.gz --no-same-owner --no-same-permissions -C server
)
test -d server/node_modules/mysql2
docker run --rm --network none --read-only --user 1000:1000 --tmpfs /tmp:rw,noexec,nosuid,size=64m \
  --env-file "$ROOT/shared/runtime.env" --env-file "$MYSQL_ENV" \
  --env "TRUSTED_PROXY_CIDRS=$GATEWAY/32,127.0.0.1/32,::1/128" --env AUDIT_GEO_DIR=/app/ip-region \
  -v "$RELEASE/server:/app:ro" -v "$ROOT/shared/data:/app/data:ro" -v "$RELEASE:/release:ro" -w /app "$IMAGE" node --input-type=module -e \
  'import "./src/app.js"; import "mysql2/promise"; import checks from "/release/preflight.cjs"; import {createConfig} from "./src/config.js"; import {GeoLocator} from "./src/audit/geo-location.js"; const c=createConfig(); checks.assertProduction(c); const g=new GeoLocator(c.auditGeoDir); await g.init(); if(g.status().databases.length!==2) throw Error("Both geo databases required"); console.log("Source, new Linux dependencies and production configuration checked")'
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
    echo "MYSQL_COMMITTED_CHECK_FAILED release=$RELEASE; current MySQL data preserved; never restore stale JSON after traffic opens." >&2
    exit "$code"
  fi
  set +e
  echo "Cutover failed; preserving MySQL for investigation and restoring previous JSON service." >&2
  if [ "$PHASE" != ready ]; then
    if docker inspect "$OLD_NAME" >/dev/null 2>&1; then
      if docker inspect hufe-api >/dev/null 2>&1; then
        if ! docker stop -t 30 hufe-api >/dev/null 2>&1; then echo 'ROLLBACK_BLOCKED: candidate cannot stop; maintenance kept closed.' >&2; exit 1; fi
        docker update --restart=no hufe-api >/dev/null 2>&1 || true
        if ! docker rename hufe-api "hufe-api-failed-$STAMP"; then echo 'ROLLBACK_BLOCKED: cannot preserve failed candidate; maintenance kept closed.' >&2; exit 1; fi
      fi
      if ! docker rename "$OLD_NAME" hufe-api; then echo 'ROLLBACK_BLOCKED: cannot restore old container name; maintenance kept closed.' >&2; exit 1; fi
    fi
    if [ -d "$BACKUP/restore-shared-ready" ]; then
      if mv "$ROOT/shared" "$BACKUP/shared-after-failure"; then
        if ! mv "$BACKUP/restore-shared-ready" "$ROOT/shared"; then
          mv "$BACKUP/shared-after-failure" "$ROOT/shared"
          echo 'ROLLBACK_BLOCKED: previous shared data cannot be restored; maintenance preserved.' >&2; exit 1
        fi
      else echo 'ROLLBACK_BLOCKED: cannot preserve candidate shared data; maintenance preserved.' >&2; exit 1; fi
    fi
    if ! docker run --rm --network none -v /www:/www -v "$RELEASE:/release:ro" "$IMAGE" node /release/restore-web.cjs "$BACKUP/web" "$WEB"; then echo 'ROLLBACK_BLOCKED: static restore failed; maintenance preserved.' >&2; exit 1; fi
    docker update --restart=unless-stopped hufe-api >/dev/null 2>&1 || true
    if ! docker start hufe-api >/dev/null; then echo 'ROLLBACK_BLOCKED: old API cannot restart; maintenance preserved.' >&2; exit 1; fi
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
docker stop -t 30 hufe-api >/dev/null
PHASE=stopped
tar -czf "$BACKUP/shared.tar.gz.next" -C "$ROOT" shared
mv "$BACKUP/shared.tar.gz.next" "$BACKUP/shared.tar.gz"
chmod 600 "$BACKUP/shared.tar.gz"
cp -a "$ROOT/shared" "$BACKUP/restore-shared.tmp"
mv "$BACKUP/restore-shared.tmp" "$BACKUP/restore-shared-ready"
docker run --rm --network none -v "$ROOT/shared/data:/data:ro" -v "$BACKUP:/backup" -v "$RELEASE:/release:ro" "$IMAGE" node /release/mysql-baota-account-integrity.cjs snapshot
docker run --rm --network none -v "$RELEASE/server:/app:ro" -v "$ROOT/shared/data:/production-data:ro" -v "$BACKUP:/backup" -w /app "$IMAGE" node src/cli/prepare-mysql-snapshots.js --data-dir /production-data --output /backup/source-snapshots
docker exec hufe-mysql mysqldump --defaults-extra-file=/run/secrets/client.cnf --single-transaction --routines --triggers --events --hex-blob --set-gtid-purged=OFF --no-tablespaces --databases "$DB_NAME" > "$BACKUP/mysql-before.sql.next"
mv "$BACKUP/mysql-before.sql.next" "$BACKUP/mysql-before.sql"
# Read only the stopped server's own production files; no local data path exists.
mysql_data() {
  docker run --rm --network hufe-db --env-file "$MYSQL_ENV" \
    -v "$RELEASE/server:/app:ro" -v "$ROOT/shared/data:/production-data:ro" -v "$BACKUP:/backup" \
    -w /app "$IMAGE" node src/cli/mysql-data.js "$@"
}
for action in import verify; do
  for namespace in application chat image-transfers audit regions content; do
    mysql_data "$action" --namespace "$namespace" --file "/backup/source-snapshots/$namespace.json"
  done
done
docker exec hufe-mysql mysqldump --defaults-extra-file=/run/secrets/client.cnf --single-transaction --routines --triggers --events --hex-blob --set-gtid-purged=OFF --no-tablespaces --databases "$DB_NAME" > "$BACKUP/mysql-imported.sql.next"
mv "$BACKUP/mysql-imported.sql.next" "$BACKUP/mysql-imported.sql"
(cd "$BACKUP" && sha256sum shared.tar.gz mysql-before.sql mysql-imported.sql > backup.sha256)
docker run --rm --network none -v "$ROOT/shared:/shared" -v "$ROOT/mysql:/mysql:ro" -v "$RELEASE:/release:ro" "$IMAGE" node /release/mysql-baota-preflight.cjs runtime "$GATEWAY"
docker rename hufe-api "$OLD_NAME"
docker create --name hufe-api --restart unless-stopped --user 1000:1000 --read-only \
  --network bridge --tmpfs /tmp:rw,noexec,nosuid,size=64m --cap-drop ALL --security-opt no-new-privileges \
  --log-opt max-size=10m --log-opt max-file=3 --env-file "$ROOT/shared/runtime.env" \
  -p "127.0.0.1:$NEW_PORT:8787" -v "$RELEASE/server:/app:ro" -v "$ROOT/shared/data:/app/data:rw" \
  -w /app "$IMAGE" node src/index.js >/dev/null
docker network connect hufe-db hufe-api
docker start hufe-api >/dev/null
healthy=false
for i in {1..45}; do
  if curl --fail --silent "http://127.0.0.1:$NEW_PORT/health" >/dev/null; then healthy=true; break; fi
  sleep 1
done
test "$healthy" = true
for namespace in application chat image-transfers audit regions content; do
  mysql_data export --namespace "$namespace" --file "/backup/mysql-$namespace-after.json"
done
docker run --rm --network none -v "$BACKUP/mysql-application-after.json:/data/application-data.json:ro" -v "$BACKUP:/backup:ro" -v "$RELEASE:/release:ro" "$IMAGE" node /release/mysql-baota-account-integrity.cjs verify
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
test "$(curl --silent --output /dev/null --write-out '%{http_code}' "http://127.0.0.1:$NEW_PORT/api/v1/admin/audit-logs")" = 401
docker update --restart=no "$OLD_NAME" >/dev/null
docker run --rm --network none -v /www/server/panel/vhost/rewrite:/routes -v "$BACKUP/routes.conf:/original.conf:ro" -v "$RELEASE:/release:ro" "$IMAGE" node /release/activate.cjs "$OLD_PORT" "$NEW_PORT"
/www/server/nginx/sbin/nginx -t
# Commit boundary: traffic may write MySQL from here. Never restore old JSON.
DONE=true
/www/server/nginx/sbin/nginx -s reload
PHASE=done
docker run --rm -v "$RELEASE:/release:ro" "$IMAGE" node /release/online.cjs
trap - EXIT INT TERM HUP
echo "MYSQL_UPDATE_OK release=$RELEASE backup=$BACKUP previous_container=$OLD_NAME port=$NEW_PORT database=$DB_NAME"
