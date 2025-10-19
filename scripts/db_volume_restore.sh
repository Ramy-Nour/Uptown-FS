#!/usr/bin/env bash
# Restore the Docker volume 'db_data' from a compressed tarball created by db_volume_backup.sh.
# Usage:
#   scripts/db_volume_restore.sh <path/to/db_data-YYYYMMDD-HHMMSS.tar.gz>
#
# WARNING:
# - This will delete current contents of the 'db_data' volume and replace them with the archive.
# - Stop the db container before restoring:
#     docker compose stop db
# - Ensure the archive matches the Postgres major version in use, or prefer logical restore (psql) from pg_dump.

set -euo pipefail

if [ "${#}" -ne 1 ]; then
  echo "Usage: $0 <path/to/db_data-YYYYMMDD-HHMMSS.tar.gz>"
  exit 1
fi

ARCHIVE_PATH="$1"

if [ ! -f "${ARCHIVE_PATH}" ]; then
  echo "Archive not found: ${ARCHIVE_PATH}"
  exit 1
fi

VOLUME_NAME="db_data"

# Determine repo root and absolute archive dir
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

ARCHIVE_DIR="$(dirname "${ARCHIVE_PATH}")"
ARCHIVE_BASE="$(basename "${ARCHIVE_PATH}")"

echo "Restoring Docker volume '${VOLUME_NAME}' from ${ARCHIVE_PATH}"

# Use Alpine to clear the volume and extract the tarball into it.
docker run --rm \
  -v "${VOLUME_NAME}:/volume" \
  -v "${REPO_ROOT}/${ARCHIVE_DIR}:/backup" \
  alpine:3.20 \
  sh -c "apk add --no-cache tar && rm -rf /volume/* && tar -xzf /backup/${ARCHIVE_BASE} -C /volume"

echo "Restore completed. You may start the db container:"
echo "  docker compose up -d db"