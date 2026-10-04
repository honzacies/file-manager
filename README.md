<div align="center">

# ☁️ Cloud

**Tvůj vlastní Google Drive. Na tvém serveru, s tvými disky, bez předplatného.**

Self-hosted správce souborů pro domácí server — rychlý, hezký a připravený pro celou rodinu.
Jeden Docker kontejner, jeden příkaz na instalaci.

![Node 24](https://img.shields.io/badge/Node-24-5FA04E?logo=nodedotjs&logoColor=white)
![Next.js 16](https://img.shields.io/badge/Next.js-16-000?logo=nextdotjs)
![Fastify 5](https://img.shields.io/badge/Fastify-5-000?logo=fastify)
![SQLite](https://img.shields.io/badge/SQLite-vestavěná-003B57?logo=sqlite)
![Docker](https://img.shields.io/badge/Docker-jeden_kontejner-2496ED?logo=docker&logoColor=white)

</div>

---

## Proč Cloud?

- **Tvoje data zůstávají doma.** Žádná cizí firma, žádné limity tarifu, žádné skenování fotek.
- **Soubory jsou obyčejné soubory.** Leží na disku jako `<složka>/<uživatel>/…` — žádný proprietární formát. Kdykoli je zkopíruješ, zazálohuješ nebo otevřeš bez aplikace.
- **Vypadá a ovládá se jako služby, na které jsi zvyklý.** Kontextové menu jako v Google Drive, náhledy, přetahování, sdílení.
- **Instalace za pár minut.** `sudo ./setup.sh` se na všechno zeptá a zbytek udělá sám.

## ✨ Funkce

**Soubory**
- Seznam i mřížka s náhledy, řazení podle názvu, data a velikosti (u složek počet položek)
- Nahrávání přetažením — soubory i celé složky (víc najednou), s průběhem
- Přesun přetažením do složky, kopírování, přejmenování, nové složky
- Stažení složky nebo výběru jako ZIP (streamuje se, i obří složky)
- Výběr klikem, Ctrl/Shift klikem nebo tažením přes checkboxy; dvojklik otevírá
- Kontextové menu s podmenu (Sdílet / Uspořádat / Informace) a klávesové zkratky
- Okamžitý filtr ve složce a hledání v podsložkách (Enter)
- Koš — smazané soubory jdou 30 dní obnovit

**Náhledy**
- Fotky, video (s posouváním), hudba, PDF a textové soubory přímo v prohlížeči
- Miniatury fotek, snímky z videí a obaly alb (ffmpeg), s cache — mřížka se načítá bleskově i na mobilních datech

**Uspořádání**
- Barvy složek, hvězdičky a záložka *S hvězdičkou*
- Záložka *Nedávné* — co jsi naposledy otevřel nebo nahrál
- Podrobnosti o souboru i složce (velikost, počet položek, vlastník, data)

**Sdílení**
- Sdílení s ostatními uživateli — pro každého zvlášť *jen čtení* nebo *může upravovat*
- Notifikace v aplikaci (zvoneček), když ti někdo něco nasdílí
- Veřejné odkazy s volitelnou platností — i pro lidi bez účtu, s náhledy
- Přehled *Moje sdílení* — komu a co sdílíš, zrušení jedním klikem

**Uživatelé a správa**
- Účty s profilem — jméno, příjmení a avatar (u každé položky vidíš vlastníka)
- Každý vidí jen svoje soubory, admin může procházet všechno
- Kvóty na uživatele s přehledem obsazeného místa
- Admin panel: uživatelé, reset hesla, kořenová složka cloudu

**Všude a vždycky**
- Světlý i tmavý režim, plně responzivní — na mobilu se ovládá jako appka
- Instalace jako aplikace (PWA) a soubory dostupné offline
- Česky

## 🚀 Instalace (Ubuntu server)

Potřebuješ Ubuntu (22.04 nebo novější), přístup přes `sudo` a git. Docker si skript doinstaluje sám.

```bash
sudo git clone https://github.com/honzacies/file-manager.git /opt/cloud
cd /opt/cloud
sudo ./setup.sh
```

Skript se zeptá na:

1. **složku pro soubory** — třeba velký datový disk (`/mnt/data/cloud`),
2. **port** (výchozí `8080`),
3. **adresu**, na které má web poslouchat (`0.0.0.0` = celá domácí síť),
4. **linuxového uživatele**, kterému budou soubory patřit,
5. **jméno a heslo administrátora**.

Pak sestaví a spustí kontejner a vypíše adresu, třeba `http://192.168.1.10:8080`. Hotovo — přihlas se a v *Admin → Uživatelé* založ účty pro ostatní.

### Aktualizace

```bash
cd /opt/cloud && sudo ./update.sh
```

Stáhne nejnovější verzi z GitHubu a přestaví kontejner, na nic se neptá. Nastavení i data zůstanou, kde byla. Když nic nového není, nic nedělá (`--force` přestaví i tak).

### Přístup zvenku (doporučeno: Tailscale)

Nejbezpečnější cesta, jak se ke cloudu dostat mimo domov, je [Tailscale](https://tailscale.com) — server nevystavíš do internetu a dostaneš HTTPS zdarma:

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
sudo tailscale serve --bg 8080
```

Cloud pak běží na `https://<jméno-serveru>.<tvoje-síť>.ts.net`. HTTPS je potřeba i pro offline soubory a instalaci jako aplikace.

### Zapomenuté heslo admina

```bash
cd /opt/cloud && sudo ./setup.sh
```

…a na otázku *„Založit dalšího admina nebo obnovit heslo?“* odpověz `a`.

### Užitečné příkazy

| Co | Příkaz |
| --- | --- |
| Logy | `docker compose logs -f cloud` |
| Restart | `docker compose restart cloud` |
| Záloha databáze | zkopíruj složku `/opt/cloud/data` |

Soubory uživatelů jsou ve složce, kterou jsi zadal při instalaci; databáze (účty, sdílení, nastavení) v `/opt/cloud/data`. Pro kompletní zálohu stačí tyhle dvě složky.

## 🛡️ Bezpečnost

Cloud je postavený tak, aby k tvým souborům nepustil nikoho, kdo k nim nemá přístup — a bezpečnost se ověřuje automaticky: `npm run verify` spouští **32 útočných testů** proti skutečnému serveru (procházení mimo svou složku, cizí soubory, eskalace na admina, XSS přes nahraný soubor, podvržené hlavičky…).

- **Hesla** jsou hashovaná algoritmem **Argon2id** (doporučený standard), přihlášení má rate limit proti hádání hesel.
- **Přihlášení** drží náhodný token v `httpOnly` + `SameSite=Strict` cookie — JavaScript ho nepřečte a cizí web ho nepoužije. V databázi je jen jeho SHA-256 otisk, takže ani únik databáze nedá přístup k účtům.
- **Izolace uživatelů:** každá cesta se na serveru normalizuje a uzavře do složky uživatele (`../` nikam nevede). Cizí soubor nebo cizí sdílení vrací 404, ne „přístup odepřen“ — neprozradí ani, že existuje.
- **Sdílení** se ověřuje u každého požadavku proti přihlášenému uživateli; *jen pro čtení* znamená jen pro čtení i na úrovni API.
- **Nahrané soubory se nikdy nespustí:** HTML a SVG se servírují jako text nebo v `CSP: sandbox`, s `X-Content-Type-Options: nosniff`. Avatary jen jako ověřený WebP.
- **Citlivé akce** (reset cizího hesla, smazání účtu) admin potvrzuje vlastním heslem — ukradená relace nestačí.
- **Databáze je mimo dosah:** kořen cloudu nesmí zahrnovat datovou složku, takže ji nejde stáhnout přes aplikaci.
- **Veřejné odkazy** jsou dlouhé náhodné tokeny s volitelnou platností a vlastním rate limitem.
- **Proxy hlavičky** (`X-Forwarded-For`) se věří jen z localhostu a Docker sítě — z LAN nejde podvrhnout IP a obejít limity.
- **Kontejner** běží pod neprivilegovaným uživatelem, ne jako root. Málo závislostí, `npm audit` bez nálezů.

**Doporučení pro provoz:** nevystavuj port přímo do internetu přes přesměrování na routeru — použij Tailscale nebo jinou VPN / reverzní proxy s HTTPS. Do složky cloudu nedávej symlinky ven z ní.

Našel jsi zranitelnost? Nahlas ji prosím soukromě přes **Security → Report a vulnerability** na GitHubu, ne veřejným issue.

## 🧑‍💻 Vývoj

**Potřebuješ:** Node.js **24+** (TypeScript se spouští přímo, bez buildu) a volitelně `ffmpeg` pro miniatury.

```bash
git clone https://github.com/honzacies/file-manager.git
cd file-manager

# API — http://localhost:8080, data v Api/data a soubory v Api/cloud
cd Api && npm install && npm run dev

# Web (druhý terminál) — http://localhost:3000, /api se přeposílá na API
cd Web && npm install && npm run dev

# První účet (heslo se zadá na vstupu)
cd Api && npm run create-admin -- admin
```

### Architektura

```
┌─────────────── Docker kontejner ───────────────┐
│  Fastify API  ──►  SQLite (účty, sdílení, …)   │
│      │                                         │
│      ├──►  soubory na disku  <root>/<user>/…   │
│      ├──►  ffmpeg  →  cache miniatur           │
│      └──►  statický export Next.js webu        │
└────────────────────────────────────────────────┘
```

| Složka | Co v ní je |
| --- | --- |
| `Api/` | Fastify 5, vestavěné `node:sqlite`, Argon2id (`hash-wasm`), TypeScript spouštěný přímo Nodem |
| `Web/` | Next.js 16 (`output: "export"`), React 19, Tailwind CSS v4, HeroUI v3, service worker pro offline |
| `setup.sh` | instalace a aktualizace na Ubuntu |
| `Dockerfile` | dvoufázový build: web → statické soubory, API je servíruje |

Web a API běží na jednom originu — žádné CORS, žádný reverse proxy uvnitř. V produkci API servíruje statický export webu, ve vývoji `next dev` přeposílá `/api` na API (`API_URL`).

### Kontroly

```bash
cd Api && npm run verify                      # 32 bezpečnostních a funkčních testů
cd Api && npm run typecheck
cd Web && npm run typecheck
cd Web && npm run build                       # statický export do Web/out
cd Web && node src/lib/safeRedirect.check.ts  # přesměrování po loginu nevede ven
cd Web && node src/lib/dropFiles.check.ts     # přetažení víc složek najednou
```

### Konfigurace API (proměnné prostředí)

| Proměnná | Výchozí | Význam |
| --- | --- | --- |
| `PORT` | `8080` | port API |
| `LISTEN_HOST` | `127.0.0.1` | adresa (v Dockeru `0.0.0.0`) |
| `DATA_DIR` | `./data` | SQLite databáze, avatary, cache miniatur |
| `DEFAULT_ROOT_DIR` | `./cloud` | výchozí kořen souborů (admin ho může změnit) |
| `WEB_DIR` | — | statický export webu; bez něj běží jen API |
| `FFMPEG_PATH` | `ffmpeg` | cesta k ffmpeg |

## Co zatím neumí

Verze souborů, synchronizační klient pro desktop, push notifikace při zavřeném prohlížeči a jiný jazyk než čeština. Pull requesty vítány.
