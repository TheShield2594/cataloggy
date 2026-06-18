#!/usr/bin/env bash
# Restores the Postgres database used by docker-compose.yml from a .sql.gz
# backup created by scripts/backup.sh.
#
# Usage: scripts/restore.sh <path-to-backup.sql.gz>
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 <path-to-backup.sql.gz>" >&2
  exit 1
fi

BACKUP_FILE="$1"
if [ ! -f "$BACKUP_FILE" ]; then
  echo "Backup file not found: $BACKUP_FILE" >&2
  exit 1
fi

COMPOSE_PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$COMPOSE_PROJECT_DIR"

POSTGRES_USER="${POSTGRES_USER:-postgres}"
POSTGRES_DB="${POSTGRES_DB:-cataloggy}"

echo "This will OVERWRITE the current contents of database '$POSTGRES_DB'."
read -r -p "Type 'yes' to continue: " CONFIRM
if [ "$CONFIRM" != "yes" ]; then
  echo "Aborted."
  exit 1
fi

echo "Restoring $BACKUP_FILE into '$POSTGRES_DB'..."
gunzip -c "$BACKUP_FILE" | docker compose exec -T db psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" "$POSTGRES_DB"

echo "Restore complete."
