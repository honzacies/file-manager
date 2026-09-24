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
   ☁  Cloud — domácí úložiště
EOF
printf '%s\n' "$C_RESET"

[[ $EUID -eq 0 ]] || Fail "Spusť jako root: sudo ./setup.sh"
[[ -f docker-compose.yml ]] || Fail "Chybí docker-compose.yml — spouštěj setup.sh ze složky projektu."

# ---- 1. Docker --------------------------------------------------------------
Step "Docker"
if command -v docker >/dev/null && docker compose version >/dev/null 2>&1; then
  Ok "Docker je nainstalovaný ($(docker --version | cut -d' ' -f3 | tr -d ,))"
else
  Log "Instaluji Docker z repozitářů Ubuntu…"
  apt-get update -qq
  apt-get install -y -qq docker.io docker-compose-v2 >/dev/null
  systemctl enable --now docker >/dev/null
  Ok "Docker nainstalován"
fi

# ---- 2. Konfigurace ---------------------------------------------------------
Step "Nastavení"
# Předchozí hodnoty z .env slouží jako výchozí — opakované spuštění nic nepřepíše omylem.
if [[ -f .env ]]; then
  set -a
  . ./.env
  set +a
  Log "Načteno stávající nastavení z .env"
fi

OWNER_DEFAULT="${SUDO_USER:-}"
if [[ -n "${PUID:-}" ]]; then OWNER_DEFAULT="$(getent passwd "$PUID" | cut -d: -f1 || true)"; fi
[[ -n "$OWNER_DEFAULT" && "$OWNER_DEFAULT" != root ]] || OWNER_DEFAULT="cloud"

CLOUD_DIR="$(Ask "Složka na disku, kam se budou ukládat soubory" "${CLOUD_DIR:-/srv/cloud}")"
[[ "$CLOUD_DIR" == /* ]] || Fail "Cesta musí být absolutní (začínat /)."
PORT="$(Ask "Port webu" "${PORT:-8080}")"
[[ "$PORT" =~ ^[0-9]+$ ]] && (( PORT >= 1024 && PORT <= 65535 )) || Fail "Port musí být číslo 1024–65535."
BIND_ADDRESS="$(Ask "Adresa, na které web poslouchá (0.0.0.0 = LAN i Tailscale)" "${BIND_ADDRESS:-0.0.0.0}")"
OWNER="$(Ask "Linuxový uživatel, kterému budou soubory patřit" "$OWNER_DEFAULT")"

if ! id "$OWNER" >/dev/null 2>&1; then
  Log "Zakládám systémového uživatele $OWNER…"
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
Ok "Uloženo do .env (soubory: $CLOUD_DIR, vlastník: $OWNER $PUID:$PGID)"

# Port obsazený něčím jiným než tímhle kontejnerem
if ss -tlnH "sport = :$PORT" 2>/dev/null | grep -q . && ! docker compose ps --format '{{.Ports}}' 2>/dev/null | grep -q ":$PORT->"; then
  Warn "Port $PORT už používá jiný program — kontejner se nemusí spustit."
fi

# ---- 3. Build a start -------------------------------------------------------
Step "Sestavení a spuštění"
Log "Stavím image (poprvé to trvá pár minut)…"
docker compose up -d --build --remove-orphans
Log "Čekám, až cloud naběhne…"
for _ in $(seq 1 60); do
  # 401 z /api/auth/me = API běží, jen nejsme přihlášení
  code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/api/auth/me" || true)"
  [[ "$code" == 401 ]] && break
  sleep 1
done
[[ "${code:-}" == 401 ]] || Fail "Cloud nenaběhl. Log: docker compose logs cloud"
Ok "Cloud běží"

# ---- 4. Admin ---------------------------------------------------------------
Step "Administrátor"
HAS_USERS=0
if [[ -f data/cloud.db ]] && docker compose exec -T cloud node --disable-warning=ExperimentalWarning -e \
  "const {DatabaseSync}=require('node:sqlite');process.exit(new DatabaseSync('/data/cloud.db').prepare('SELECT COUNT(*) n FROM users').get().n?0:1)" 2>/dev/null; then
  HAS_USERS=1
fi

if (( HAS_USERS == 0 )) || Confirm "Založit dalšího admina nebo obnovit heslo existujícímu?" "n"; then
  ADMIN="$(Ask "Uživatelské jméno admina" "admin")"
  while true; do
    read -r -s -p "$(printf '%s?%s Heslo (aspoň 8 znaků): ' "$C_ACCENT" "$C_RESET")" PASSWORD; echo
    read -r -s -p "$(printf '%s?%s Heslo znovu: ' "$C_ACCENT" "$C_RESET")" PASSWORD2; echo
    [[ "$PASSWORD" == "$PASSWORD2" ]] || { Warn "Hesla se neshodují."; continue; }
    (( ${#PASSWORD} >= 8 )) || { Warn "Heslo je moc krátké."; continue; }
    break
  done
  # Heslo jde přes stdin, ne jako argument — v `ps` by ho viděl každý.
  printf '%s\n' "$PASSWORD" | docker compose exec -T cloud node --disable-warning=ExperimentalWarning src/Scripts/CreateAdmin.ts "$ADMIN"
  unset PASSWORD PASSWORD2
else
  Ok "Uživatelé už existují, přeskakuji"
fi

# ---- 5. Hotovo --------------------------------------------------------------
Step "Hotovo"
LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
[[ "$BIND_ADDRESS" == 0.0.0.0 ]] || LAN_IP="$BIND_ADDRESS"
printf '  %sV síti:%s      http://%s:%s\n' "$C_BOLD" "$C_RESET" "${LAN_IP:-IP-serveru}" "$PORT"
if command -v tailscale >/dev/null && TS_IP="$(tailscale ip -4 2>/dev/null | head -1)" && [[ -n "$TS_IP" && "$BIND_ADDRESS" == 0.0.0.0 ]]; then
  printf '  %sTailscale:%s   http://%s:%s\n' "$C_BOLD" "$C_RESET" "$TS_IP" "$PORT"
else
  printf '  %sTailscale zatím není nainstalovaný — přístup zvenku: https://tailscale.com/download/linux%s\n' "$C_MUTED" "$C_RESET"
fi
printf '\n  %sSoubory:%s     %s\n' "$C_BOLD" "$C_RESET" "$CLOUD_DIR"
printf '  %sLogy:%s        docker compose logs -f cloud\n' "$C_BOLD" "$C_RESET"
printf '  %sAktualizace:%s git pull && sudo ./setup.sh\n\n' "$C_BOLD" "$C_RESET"
