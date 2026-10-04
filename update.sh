#!/usr/bin/env bash
# Aktualizace na nejnovější verzi z GitHubu bez otázek: git pull + přestavění kontejneru.
#   sudo ./update.sh           # jen když je na GitHubu něco nového
#   sudo ./update.sh --force   # přestavět i bez nových commitů
# Nastavení (.env) a data zůstávají. Poprvé se instaluje přes setup.sh.
set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")"

C_ACCENT=$'\033[38;5;203m'
C_OK=$'\033[38;5;114m'
C_MUTED=$'\033[38;5;245m'
C_RESET=$'\033[0m'
Log()  { printf '%s→%s %s\n' "$C_ACCENT" "$C_RESET" "$*"; }
Ok()   { printf '%s✓%s %s\n' "$C_OK" "$C_RESET" "$*"; }
Fail() { printf '%s✗ %s%s\n' $'\033[38;5;196m' "$*" "$C_RESET" >&2; exit 1; }

[[ $EUID -eq 0 ]] || Fail "Run as root: sudo ./update.sh"
[[ -f .env ]] || Fail "No .env yet. Install first: sudo ./setup.sh"
FORCE=0
[[ "${1:-}" == "--force" ]] && FORCE=1

# git jako vlastník repozitáře — jeho deploy key, žádné "dubious ownership" a soubory nepatřící rootovi.
OWNER="$(stat -c %U .)"
Git() { if [[ "$OWNER" == root ]]; then git "$@"; else sudo -u "$OWNER" git "$@"; fi; }

BEFORE="$(Git rev-parse --short HEAD)"
Log "Downloading the latest version…"
Git pull --ff-only --quiet || Fail "git pull failed. Local changes in the folder? See: git status"
AFTER="$(Git rev-parse --short HEAD)"

if [[ "$BEFORE" == "$AFTER" && $FORCE -eq 0 ]]; then
  Ok "Already up to date ($AFTER). To rebuild anyway: sudo ./update.sh --force"
  exit 0
fi
[[ "$BEFORE" != "$AFTER" ]] && Git log --oneline --no-decorate "$BEFORE..$AFTER" | sed "s/^/  ${C_MUTED}/;s/$/${C_RESET}/"

Log "Rebuilding the container…"
docker compose up -d --build --remove-orphans
# staré image po přestavění jen zabírají místo
docker image prune -f >/dev/null

PORT="$(sed -n 's/^PORT=//p' .env)"
Log "Waiting for the cloud to start…"
for _ in $(seq 1 60); do
  # 401 z /api/auth/me = API běží, jen nejsme přihlášení
  code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORT:-8080}/api/auth/me" || true)"
  [[ "$code" == 401 ]] && break
  sleep 1
done
[[ "${code:-}" == 401 ]] || Fail "The cloud didn't start. Logs: docker compose logs cloud"
Ok "Updated $BEFORE → $AFTER, the cloud is running"
