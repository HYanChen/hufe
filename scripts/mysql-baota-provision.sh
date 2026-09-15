#!/bin/bash
set -Eeuo pipefail
umask 077
cd "$(dirname "$0")"
ROOT=/www/hufe-platform/mysql
test -z "$(docker ps -aq --filter 'name=^/hufe-mysql$')"
test ! -e "$ROOT/application.env"
test -z "$(docker network ls -q --filter 'name=^hufe-db$')"
MYSQL_IMAGE=$(docker image inspect mysql:8.4 --format '{{.Id}}')
NODE_IMAGE=$(docker image inspect node:22-alpine --format '{{.Id}}')
install -d -m 700 "$ROOT" "$ROOT/secrets" "$ROOT/data"
docker run --rm --network none -v "$ROOT:/mysql" -v "$(pwd):/release:ro" "$NODE_IMAGE" node /release/mysql-baota-provision.cjs
docker network create --internal hufe-db >/dev/null
docker run -d --name hufe-mysql --restart unless-stopped --network hufe-db --memory 768m \
  --log-opt max-size=10m --log-opt max-file=3 --env-file "$ROOT/container.env" \
  -v "$ROOT/data:/var/lib/mysql" -v "$ROOT/secrets:/run/secrets:ro" \
  "$MYSQL_IMAGE" --innodb-buffer-pool-size=128M >/dev/null
for i in {1..60}; do
  if docker exec hufe-mysql mysqladmin --defaults-extra-file=/run/secrets/client.cnf ping --silent >/dev/null 2>&1; then
    echo 'MYSQL_PROVISION_OK dedicated hufe_alumni database; no host database port'; exit 0
  fi
  sleep 1
done
echo 'MySQL startup did not pass health check; existing application untouched' >&2
exit 1
