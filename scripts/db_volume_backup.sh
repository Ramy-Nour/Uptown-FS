#!/usr/bin/env bash
# Backup the Docker volume 'db_data' (PostgreSQL data dir) into a compressed tarball.
# Usage:
#   scripts/db_volume_backup.sh [backup_dir]
# - backup_dir: optional, defaults to "backups" under repo root.
#
# Notes:
# - For maximum consistency, stop the db container before taking a volume backup:
#     docker compose stop db
# - Alternatively, use a logical dump (pg_dump) if you need portability between Postgres versions.

set -euo pipefail

VOLUME_NAME="db_data"
BACKUP_DIR="${1:-backups}"

# Ensure we run from repo root (this script lives in scripts/)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

mkdir -p "${BACKUP_DIR}"

TS="$(date -u +%Y%m%d-%H%M%S)"
ARCHIVE_NAME="db_data-${TS}.tar.gz"
ARCHIVE_PATH="${BACKUP_DIR}/${ARCHIVE_NAME}"

echo "Backing up Docker volume '${VOLUME_NAME}' to ${ARCHIVE_PATH}"

# Use a lightweight Alpine container to tar the volume contents.
# Install tar explicitly to avoid busybox quirks in some environments.
docker run --rm \
  -v "${VOLUME_NAME}:/volume" \
  -v "${REPO_ROOT}/${BACKUP_DIR}:/backup" \
  alpine:3.20 \
  sh -c "apk add --no-cache tar && tar -czf /backup/${ARCHIVE_NAME} -C /volume ."

echo "Backup completed: ${ARCHIVE_PATH}"