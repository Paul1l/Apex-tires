#!/usr/bin/env sh
set -eu

: "${POSTGRES_DB:?POSTGRES_DB is required}"
: "${POSTGRES_USER:?POSTGRES_USER is required}"
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}"

backup_directory="${BACKUP_DIRECTORY:-/backups}"
retention_days="${BACKUP_RETENTION_DAYS:-14}"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_file="${backup_directory}/${POSTGRES_DB}_${timestamp}.dump"

mkdir -p "$backup_directory"
export PGPASSWORD="$POSTGRES_PASSWORD"
pg_dump --host="${POSTGRES_HOST:-postgres}" --username="$POSTGRES_USER" \
  --dbname="$POSTGRES_DB" --format=custom --file="$backup_file"
find "$backup_directory" -type f -name "${POSTGRES_DB}_*.dump" \
  -mtime "+$retention_days" -delete
printf 'Backup created: %s\n' "$backup_file"
