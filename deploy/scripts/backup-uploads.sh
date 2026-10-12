#!/usr/bin/env sh
# Backup of the product photos volume (`uploads`, UPLOADS_DIR=/app/uploads in
# the app container). Run on the VDS host by cron, after the database backup:
#
#   sh /opt/apex/deploy/scripts/backup-uploads.sh
#
# tar runs inside the running app container as the app user (it only reads
# the volume) and streams the archive to the host:
#   <deploy>/backups/uploads_<UTC time>.tar.gz
# next to the database dumps (that directory is /backups in the postgres
# container). The archive is written as *.partial first and checked with
# gzip -t; a failed run leaves no partial file, prints the error and exits
# non-zero (cron mails it when MAILTO is set). Archives older than
# BACKUP_RETENTION_DAYS days (default 14, as for the database) are deleted.
# Restore: docs/VDS_DEPLOYMENT.md, "Резервные копии".
#
# Optional environment: APEX_ENV_FILE (default <repository>/.env.production),
# UPLOADS_BACKUP_DIRECTORY (default <deploy>/backups), BACKUP_RETENTION_DAYS.
set -eu

retention_days="${BACKUP_RETENTION_DAYS:-14}"
case "$retention_days" in
  '' | *[!0-9]*)
    echo "BACKUP_RETENTION_DAYS: a whole number of days is expected" >&2
    exit 2
    ;;
esac

deploy_dir=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
env_file="${APEX_ENV_FILE:-$(dirname -- "$deploy_dir")/.env.production}"
backup_directory="${UPLOADS_BACKUP_DIRECTORY:-$deploy_dir/backups}"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_file="${backup_directory}/uploads_${timestamp}.tar.gz"
partial_file="${backup_file}.partial"

mkdir -p "$backup_directory"
# Readable by the owner (root) only, like the database dumps.
umask 077
trap 'rm -f "$partial_file"' EXIT
trap 'exit 1' HUP INT TERM

docker compose --env-file "$env_file" \
  -f "$deploy_dir/docker-compose.production.yml" \
  exec -T app tar -C /app/uploads -czf - . > "$partial_file"
gzip -t "$partial_file"
mv "$partial_file" "$backup_file"
find "$backup_directory" -type f -name 'uploads_*.tar.gz' \
  -mtime "+$retention_days" -delete
# Leftovers of runs killed with SIGKILL (no trap runs then), older than a day.
find "$backup_directory" -type f -name 'uploads_*.tar.gz.partial' \
  -mmin +1440 -delete
printf 'Backup created: %s\n' "$backup_file"
