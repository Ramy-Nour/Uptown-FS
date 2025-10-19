# Convenience targets for database volume backup/restore
# Usage:
#   make db-backup [BACKUP_DIR=backups]
#   make db-restore FILE=backups/db_data-YYYYMMDD-HHMMSS.tar.gz
#
# Notes:
# - Run inside your local machine or GitHub Codespace.
# - For consistency, stop the db container before backup/restore:
#     docker compose stop db
# - Start db after restore:
#     docker compose up -d db

.PHONY: db-backup db-restore

db-backup:
	@echo "Running volume backup (output to \$${BACKUP_DIR:-backups})..."
	@bash scripts/db_volume_backup.sh $${BACKUP_DIR:-backups}

db-restore:
	@if [ -z "$(FILE)" ]; then \
		echo "Usage: make db-restore FILE=backups/db_data-YYYYMMDD-HHMMSS.tar.gz"; \
		echo ""; \
		echo "Available backups (backups/*.tar.gz):"; \
		ls -1 backups/*.tar.gz 2>/dev/null | sort || echo "  (none found)"; \
		echo ""; \
		echo "Example:"; \
		echo "  make db-restore FILE=backups/db_data-20251019-050000.tar.gz"; \
		exit 1; \
	fi
	@echo "Restoring volume from $(FILE)..."
	@bash scripts/db_volume_restore.sh "$(FILE)"