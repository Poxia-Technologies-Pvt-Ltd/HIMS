#!/usr/bin/env bash
# Nightly logical backup of the Karnataka LIMS database (run from cron on the host, see
# docs/03-Business-Continuity-and-Disaster-Recovery.md). Keeps KEEP_DAYS days locally and
# writes a SHA-256 next to each dump. Copy BACKUP_DIR to a second site with your own tool
# (rsync/rclone/object storage) — a backup that lives only on the server is not a backup.
set -euo pipefail
BACKUP_DIR="${BACKUP_DIR:-/var/backups/ka-lims}"
KEEP_DAYS="${KEEP_DAYS:-14}"
CONTAINER="${MYSQL_CONTAINER:-ka_mysql}"
DB="${DB_NAME:-ka-lims}"
umask 077
mkdir -p "$BACKUP_DIR"
stamp="$(date +%Y%m%d-%H%M%S)"
file="$BACKUP_DIR/${DB}_${stamp}.sql.gz"
# --single-transaction: consistent snapshot without locking; routines/triggers are part of the schema (audit log is trigger-protected).
docker exec "$CONTAINER" sh -c 'exec mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --single-transaction --routines --triggers --events --hex-blob --set-gtid-purged=OFF "'"$DB"'"' | gzip -9 > "$file"
gzip -t "$file"
( cd "$BACKUP_DIR" && sha256sum "$(basename "$file")" > "$(basename "$file").sha256" )
find "$BACKUP_DIR" -name "${DB}_*.sql.gz*" -mtime +"$KEEP_DAYS" -delete
echo "backup ok: $file ($(du -h "$file" | cut -f1))"
