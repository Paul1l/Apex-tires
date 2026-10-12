#!/usr/bin/env sh
set -eu

: "${POSTGRES_DB:?POSTGRES_DB is required}"
: "${POSTGRES_USER:?POSTGRES_USER is required}"
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}"

backup_directory="${BACKUP_DIRECTORY:-/backups}"
retention_days="${BACKUP_RETENTION_DAYS:-14}"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_file="${backup_directory}/${POSTGRES_DB}_${timestamp}.dump"
# pg_dump writes here; renamed to backup_file only after it succeeded, so a
# failed or interrupted run never leaves a truncated *.dump that would look
# like a backup and count in the retention below (QA-43).
partial_file="${backup_file}.partial"

mkdir -p "$backup_directory"
# The dump holds customers' personal data: readable by the owner (root) only.
umask 077
trap 'rm -f "$partial_file"' EXIT
trap 'exit 1' HUP INT TERM
export PGPASSWORD="$POSTGRES_PASSWORD"
pg_dump --host="${POSTGRES_HOST:-postgres}" --username="$POSTGRES_USER" \
  --dbname="$POSTGRES_DB" --format=custom --file="$partial_file"
mv "$partial_file" "$backup_file"
find "$backup_directory" -type f -name "${POSTGRES_DB}_*.dump" \
  -mtime "+$retention_days" -delete
printf 'Backup created: %s\n' "$backup_file"
