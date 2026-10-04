#!/usr/bin/env bash
# Instalace a aktualizace domácího cloudu na Ubuntu. Spouštět jako root:
#   sudo ./setup.sh
# Dá se pouštět opakovaně — co je hotové, přeskočí; kontejner vždy přestaví.
set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")"

C_ACCENT=$'\033[38;5;203m'
C_OK=$'\033[38;5;114m'
C_WARN=$'\033[38;5;221m'
C_MUTED=$'\033[38;5;245m'
C_BOLD=$'\033[1m'
C_RESET=$'\033[0m'

Step() { printf '\n%s━━ %s%s\n' "$C_ACCENT$C_BOLD" "$*" "$C_RESET"; }
Log()  { printf '%s→%s %s\n' "$C_ACCENT" "$C_RESET" "$*"; }
Ok()   { printf '%s✓%s %s\n' "$C_OK" "$C_RESET" "$*"; }
Warn() { printf '%s!%s %s\n' "$C_WARN" "$C_RESET" "$*"; }
Fail() { printf '%s✗ %s%s\n' $'\033[38;5;196m' "$*" "$C_RESET" >&2; exit 1; }

# Ask "Otázka" "výchozí" -> odpověď (Enter = výchozí)
Ask() {
  local answer
  read -r -p "$(printf '%s?%s %s %s[%s]%s ' "$C_ACCENT" "$C_RESET" "$1" "$C_MUTED" "$2" "$C_RESET")" answer
  printf '%s' "${answer:-$2}"
}

Confirm() {
  local answer
  read -r -p "$(printf '%s?%s %s %s[%s]%s ' "$C_ACCENT" "$C_RESET" "$1" "$C_MUTED" "$2" "$C_RESET")" answer
  answer="${answer:-$2}"
  [[ "${answer,,}" == a* || "${answer,,}" == y* ]]
}

printf '%s' "$C_ACCENT$C_BOLD"
cat <<'EOF'
   ☁  Cloud: self-hosted file storage
EOF
printf '%s\n' "$C_RESET"

[[ $EUID -eq 0 ]] || Fail "Run as root: sudo ./setup.sh"
[[ -f docker-compose.yml ]] || Fail "docker-compose.yml is missing. Run setup.sh from the project folder."

# ---- 1. Docker --------------------------------------------------------------
Step "Docker"
if command -v docker >/dev/null && docker compose version >/dev/null 2>&1; then
  Ok "Docker is installed ($(docker --version | cut -d' ' -f3 | tr -d ,))"
else
  Log "Installing Docker from the Ubuntu repositories…"
  apt-get update -qq
  apt-get install -y -qq docker.io docker-compose-v2 >/dev/null
  systemctl enable --now docker >/dev/null
  Ok "Docker installed"
fi

# ---- 2. Konfigurace ---------------------------------------------------------
Step "Settings"
# Předchozí hodnoty z .env slouží jako výchozí — opakované spuštění nic nepřepíše omylem.
if [[ -f .env ]]; then
  set -a
  . ./.env
  set +a
  Log "Loaded existing settings from .env"
fi

OWNER_DEFAULT="${SUDO_USER:-}"
if [[ -n "${PUID:-}" ]]; then OWNER_DEFAULT="$(getent passwd "$PUID" | cut -d: -f1 || true)"; fi
[[ -n "$OWNER_DEFAULT" && "$OWNER_DEFAULT" != root ]] || OWNER_DEFAULT="cloud"

CLOUD_DIR="$(Ask "Folder on disk where files will be stored" "${CLOUD_DIR:-/srv/cloud}")"
[[ "$CLOUD_DIR" == /* ]] || Fail "The path must be absolute (start with /)."
PORT="$(Ask "Web port" "${PORT:-8080}")"
[[ "$PORT" =~ ^[0-9]+$ ]] && (( PORT >= 1024 && PORT <= 65535 )) || Fail "The port must be a number from 1024 to 65535."
BIND_ADDRESS="$(Ask "Address to listen on (0.0.0.0 = LAN and Tailscale)" "${BIND_ADDRESS:-0.0.0.0}")"
OWNER="$(Ask "Linux user who will own the files" "$OWNER_DEFAULT")"

if ! id "$OWNER" >/dev/null 2>&1; then
  Log "Creating system user $OWNER…"
  useradd --system --no-create-home --shell /usr/sbin/nologin "$OWNER"
fi
PUID="$(id -u "$OWNER")"
PGID="$(id -g "$OWNER")"

mkdir -p "$CLOUD_DIR" data
chown "$PUID:$PGID" "$CLOUD_DIR" data

cat > .env <<EOF
CLOUD_DIR=$CLOUD_DIR
PORT=$PORT
BIND_ADDRESS=$BIND_ADDRESS
PUID=$PUID
PGID=$PGID
EOF
chmod 600 .env
Ok "Saved to .env (files: $CLOUD_DIR, owner: $OWNER $PUID:$PGID)"

# Port obsazený něčím jiným než tímhle kontejnerem
if ss -tlnH "sport = :$PORT" 2>/dev/null | grep -q . && ! docker compose ps --format '{{.Ports}}' 2>/dev/null | grep -q ":$PORT->"; then
  Warn "Port $PORT is already used by another program. The container may fail to start."
fi

# ---- 3. Build a start -------------------------------------------------------
Step "Build and start"
Log "Building the image (the first time takes a few minutes)…"
docker compose up -d --build --remove-orphans
Log "Waiting for the cloud to start…"
for _ in $(seq 1 60); do
  # 401 z /api/auth/me = API běží, jen nejsme přihlášení
  code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/api/auth/me" || true)"
  [[ "$code" == 401 ]] && break
  sleep 1
done
[[ "${code:-}" == 401 ]] || Fail "The cloud didn't start. Logs: docker compose logs cloud"
Ok "Cloud is running"

# ---- 4. Admin ---------------------------------------------------------------
Step "Administrator"
HAS_USERS=0
if [[ -f data/cloud.db ]] && docker compose exec -T cloud node --disable-warning=ExperimentalWarning -e \
  "const {DatabaseSync}=require('node:sqlite');process.exit(new DatabaseSync('/data/cloud.db').prepare('SELECT COUNT(*) n FROM users').get().n?0:1)" 2>/dev/null; then
  HAS_USERS=1
fi

if (( HAS_USERS == 0 )) || Confirm "Create another admin or reset an existing password?" "n"; then
  ADMIN="$(Ask "Admin username" "admin")"
  while true; do
    read -r -s -p "$(printf '%s?%s Password (at least 8 characters): ' "$C_ACCENT" "$C_RESET")" PASSWORD; echo
    read -r -s -p "$(printf '%s?%s Repeat password: ' "$C_ACCENT" "$C_RESET")" PASSWORD2; echo
    [[ "$PASSWORD" == "$PASSWORD2" ]] || { Warn "The passwords don't match."; continue; }
    (( ${#PASSWORD} >= 8 )) || { Warn "The password is too short."; continue; }
    break
  done
  # Heslo jde přes stdin, ne jako argument — v `ps` by ho viděl každý.
  printf '%s\n' "$PASSWORD" | docker compose exec -T cloud node --disable-warning=ExperimentalWarning src/Scripts/CreateAdmin.ts "$ADMIN"
  unset PASSWORD PASSWORD2
else
  Ok "Users already exist, skipping"
fi

# ---- 5. Hotovo --------------------------------------------------------------
Step "Done"
LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
[[ "$BIND_ADDRESS" == 0.0.0.0 ]] || LAN_IP="$BIND_ADDRESS"
printf '  %sNetwork:%s     http://%s:%s\n' "$C_BOLD" "$C_RESET" "${LAN_IP:-server-ip}" "$PORT"
if command -v tailscale >/dev/null && TS_IP="$(tailscale ip -4 2>/dev/null | head -1)" && [[ -n "$TS_IP" && "$BIND_ADDRESS" == 0.0.0.0 ]]; then
  printf '  %sTailscale:%s   http://%s:%s\n' "$C_BOLD" "$C_RESET" "$TS_IP" "$PORT"
else
  printf '  %sTailscale is not installed yet. For access from outside: https://tailscale.com/download/linux%s\n' "$C_MUTED" "$C_RESET"
fi
printf '\n  %sFiles:%s       %s\n' "$C_BOLD" "$C_RESET" "$CLOUD_DIR"
printf '  %sLogs:%s        docker compose logs -f cloud\n' "$C_BOLD" "$C_RESET"
printf '  %sUpdate:%s      git pull && sudo ./setup.sh\n\n' "$C_BOLD" "$C_RESET"
