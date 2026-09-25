# Cloud

Domácí cloud: soubory, uživatelé, kvóty, koš, sdílení s uživateli (s notifikacemi) i odkazem, náhledy (obrázky, video, audio, PDF, text).
Běží jako jeden Docker kontejner — Fastify API servíruje i statický export Next.js webu.

```
Api/   Fastify 5 + node:sqlite, TypeScript spouštěný přímo Nodem (bez buildu)
Web/   Next.js 16 (output: export) + Tailwind v4 + HeroUI v3, červené téma, light/dark
setup.sh            instalace/aktualizace na Ubuntu (Docker, .env, admin)
docker-compose.yml  kontejner + mounty: CLOUD_DIR -> /cloud, ./data -> /data (SQLite)
```

## Nasazení (Ubuntu)

```bash
git clone <repo> /opt/cloud && cd /opt/cloud
sudo ./setup.sh
```

Skript nainstaluje Docker, zeptá se na složku se soubory, port a vlastníka souborů, postaví image,
spustí ho a založí admina. Spouští se opakovaně — aktualizace je `git pull && sudo ./setup.sh`.
Zapomenuté heslo admina: znovu `sudo ./setup.sh` → „obnovit heslo".

Soubory leží na disku normálně jako `<CLOUD_DIR>/<username>/…`, smazané v `<CLOUD_DIR>/.trash`
(30 dní). Kořen jde v adminu změnit, ale v Dockeru přežijí restart jen složky namountované z hostitele.

## Vývoj

```bash
cd Api && npm i && npm run dev        # API na :8080, data v ./data a ./cloud
cd Web && npm i && npm run dev        # web na :3000, /api se přeposílá na API (API_URL)
cd Api && npm run create-admin -- honza   # heslo ze stdin
cd Api && npm run verify              # bezpečnostní self-check (22 kontrol přes app.inject)
```

## Bezpečnost v kostce

- Relace = náhodný token v httpOnly cookie (`SameSite=Strict`), v DB jen SHA-256. Argon2id hesla, rate limit na login.
- Každá cesta od klienta se normalizuje uvnitř složky uživatele; admin vidí celý kořen jen v režimu „Všechny soubory".
- Nahrané HTML/SVG se nikdy nespustí na originu appky (text/plain nebo `CSP: sandbox`, `nosniff`).
- Reset cizího hesla a smazání účtu potvrzuje admin vlastním heslem.
- Sdílení s uživatelem: každý request nese `share` id a server ho hledá s `recipient_id` přihlášeného — cizí sdílení je 404. Zápis jen se sdílením „může upravovat“, kvóta a koš patří vlastníkovi.

## Vědomě vynecháno

- Stažení složky jako ZIP — přidat, až bude chybět (`archiver`).
- Miniatury — grid načítá originály s `loading="lazy"`; generovat až bude pomalé.
- Verze souborů, HTTPS (přes Tailscale lze `tailscale serve`).
- Kvóta hlídá jen upload do vlastní složky: koš se nepočítá a admin v „Všech souborech“ ji obchází.
- Notifikace jen v appce (dotaz každých 30 s), ne push při zavřeném prohlížeči.
