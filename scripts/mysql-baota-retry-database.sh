#!/bin/bash
# Explicit second-attempt target preparation. No data import, API stop/start,
# old database cleanup, user creation or password rotation occurs here.
# Historical workflow example only: the fictional target below is not a live
# deployment configuration. Review all source/target/user restrictions before
# any authorized use; this is not a general-purpose retry installer.
set -Eeuo pipefail
umask 077
test "$#" = 1 && test "$1" = --apply
cd "$(dirname "$0")"
ROOT=/www/hufe-platform
RELEASE=$(pwd -P)
STAMP=$(basename "$RELEASE")
test "$RELEASE" = "$ROOT/releases/$STAMP"
[[ "$STAMP" =~ ^[a-zA-Z0-9][a-zA-Z0-9._-]{7,95}$ ]]
test "${STAMP//../}" = "$STAMP"
exec 9>"$ROOT/deploy.lock"
flock -n 9
IMAGE=$(docker image inspect node:22-alpine --format '{{.Id}}')
docker run --rm --network none -v "$RELEASE:/release:ro" "$IMAGE" node /release/release.cjs /release "$STAMP"
docker inspect hufe-api | docker run --rm -i --network none -v "$RELEASE:/release:ro" "$IMAGE" node /release/mysql-baota-preflight.cjs source
docker inspect hufe-mysql | docker run --rm -i --network none -v "$RELEASE:/release:ro" "$IMAGE" node /release/mysql-baota-preflight.cjs container
docker network inspect hufe-db | docker run --rm -i --network none -v "$RELEASE:/release:ro" "$IMAGE" node /release/mysql-baota-preflight.cjs network
helper() { docker run --rm --network none -v "$ROOT/mysql:/mysql" -v "$ROOT/shared:/shared:ro" -v "$RELEASE:/release:ro" "$IMAGE" node /release/mysql-baota-retry-database.cjs "$1"; }
sql() { docker exec hufe-mysql mysql --defaults-extra-file=/run/secrets/client.cnf --batch --skip-column-names -e "$1"; }
SOURCE=hufe_alumni
TARGET=hufe_retry_example
BACKUP="$ROOT/mysql/retry-$TARGET"
STATE=$(helper status)
test "$(sql "SELECT COUNT(*) FROM information_schema.schemata WHERE schema_name='$SOURCE';")" = 1
test "$(sql "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$SOURCE';")" -gt 0
test "$(sql "SELECT COUNT(*) FROM mysql.user WHERE User='hufe_app' AND Host='%';")" = 1
if [ "$STATE" = prepared ]; then
  test "$(sql "SELECT COUNT(*) FROM information_schema.schemata WHERE schema_name='$TARGET';")" = 1
  test "$(sql "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$TARGET';")" = 0
  echo "MYSQL_RETRY_ALREADY_PREPARED target=$TARGET; original database and backups preserved; no writes performed"
  exit 0
fi
test "$STATE" = new
# Refuse even an empty pre-existing target without this helper's completed
# preservation record. A nonempty or interrupted target is never cleared/reused.
test "$(sql "SELECT COUNT(*) FROM information_schema.schemata WHERE schema_name='$TARGET';")" = 0
test "$(sql "SELECT COUNT(*) FROM information_schema.schema_privileges WHERE table_schema='$TARGET';")" = 0
helper prepare
(set -o noclobber; docker exec hufe-mysql mysqldump --defaults-extra-file=/run/secrets/client.cnf --single-transaction --routines --triggers --events --hex-blob --set-gtid-purged=OFF --no-tablespaces --databases "$SOURCE" > "$BACKUP/failed-source.sql.next")
helper seal-backup
sql "CREATE DATABASE \`hufe_retry_example\` CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;"
sql "GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES ON \`hufe_retry_example\`.* TO 'hufe_app'@'%';"
test "$(sql "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$TARGET';")" = 0
test "$(docker exec hufe-mysql mysql --defaults-extra-file=/run/secrets/retry-hufe_retry_example.cnf --database "$TARGET" --batch --skip-column-names -e 'SELECT CURRENT_USER();')" = 'hufe_app@%'
helper activate
echo "MYSQL_RETRY_TARGET_READY target=$TARGET source_preserved=$SOURCE backup=$BACKUP; API unchanged; run the verified update.sh separately"
