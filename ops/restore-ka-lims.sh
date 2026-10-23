#!/usr/bin/env bash
# Restores a dump produced by backup-ka-lims.sh.
#   ./restore-ka-lims.sh <dump.sql.gz> [target-db]
# With no target-db it restores into a scratch database "ka-lims_restore_test" so a restore can be
# rehearsed without touching live data. To recover production, pass the live name AFTER stopping
# the backend container (docker stop ka_backend) and starting it again once the checks pass.
set -euo pipefail
dump="${1:?usage: restore-ka-lims.sh <dump.sql.gz> [target-db]}"
target="${2:-ka-lims_restore_test}"
CONTAINER="${MYSQL_CONTAINER:-ka_mysql}"
[ -f "$dump.sha256" ] && ( cd "$(dirname "$dump")" && sha256sum -c "$(basename "$dump").sha256" )
gzip -t "$dump"
docker exec "$CONTAINER" sh -c 'exec mysql -uroot -p"$MYSQL_ROOT_PASSWORD" -e "CREATE DATABASE IF NOT EXISTS \`'"$target"'\` CHARACTER SET utf8mb4"'
gunzip -c "$dump" | docker exec -i "$CONTAINER" sh -c 'exec mysql -uroot -p"$MYSQL_ROOT_PASSWORD" "'"$target"'"'
echo "restored into $target; sanity counts:"
docker exec "$CONTAINER" sh -c 'exec mysql -uroot -p"$MYSQL_ROOT_PASSWORD" -N -e "SELECT '"'"'patients'"'"', COUNT(*) FROM \`'"$target"'\`.patients UNION ALL SELECT '"'"'lab_test_result'"'"', COUNT(*) FROM \`'"$target"'\`.lab_test_result UNION ALL SELECT '"'"'system_audit_log'"'"', COUNT(*) FROM \`'"$target"'\`.system_audit_log"'
