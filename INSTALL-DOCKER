# INSTALL-DOCKER

Production deployment guide using Docker containers only.

Guide de deploiement production en utilisant uniquement des containers Docker.

---

# English

## 1. Target Architecture

The production stack is expected to run these containers:

- `web`: static Vite build served by nginx.
- `api`: Fastify API on port `4000` inside Docker.
- `nginx`: public reverse proxy on ports `80` and `443`.
- `certbot`: Let's Encrypt certificate generation and renewal.

Public traffic flow:

```text
Browser -> https://zkroll.naamahdaemon.eu -> nginx -> web
Browser -> https://zkroll.naamahdaemon.eu/api -> nginx -> api:4000
```

## 2. Server Prerequisites

Install Docker and Docker Compose plugin on the server.

On Ubuntu:

```bash
sudo apt update
sudo apt install -y ca-certificates curl git
```

Install Docker from the official Docker repository if it is not already installed:

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"
```

Log out and log back in after adding your user to the `docker` group.

Check:

```bash
docker --version
docker compose version
```

## 3. Clone Or Update The Repository

Recommended layout:

```bash
sudo mkdir -p /opt/zkroll
sudo chown -R "$USER":"$USER" /opt/zkroll
cd /opt/zkroll
git clone git@github.com:naamahdaemon/zkroll.git .
```

If you already cloned into `/opt/zkroll/zkroll`, either work from that directory or move the files up.

Update later with:

```bash
cd /opt/zkroll
git pull --ff-only origin main
```

## 4. DNS

Create an `A` record:

```text
zkroll.naamahdaemon.eu -> YOUR_SERVER_IPV4
```

Wait until DNS resolves:

```bash
dig +short zkroll.naamahdaemon.eu
```

## 5. Production Environment

Create `/opt/zkroll/.env.production`:

```env
DOMAIN=zkroll.naamahdaemon.eu
LETSENCRYPT_EMAIL=you@example.com

ZKROLL_CONTRACT_ADDRESS=B62_REPLACE_WITH_DEPLOYED_ZKROLL_ADDRESS
ZKROLL_DB_PATH=/data/zkroll-mainnet.db
ZKROLL_ONCHAIN_ROOT_CACHE_MS=60000
ZKROLL_CURRENT_SLOT_CACHE_MS=60000
ZKROLL_CHAIN_REQUEST_TIMEOUT_MS=8000

VITE_API_URL=https://zkroll.naamahdaemon.eu/api
VITE_ONCHAIN_ENABLED=true
VITE_ZKROLL_CONTRACT_ADDRESS=B62_REPLACE_WITH_DEPLOYED_ZKROLL_ADDRESS
VITE_FEE_NANOMINA=100000000
VITE_WALLET_RESPONSE_TIMEOUT_MS=120000
VITE_REFUND_TIMEOUT_SLOTS=120
VITE_O1JS_BROWSER_CACHE_ENABLED=false
VITE_TX_POLL_INTERVAL_MS=120000
VITE_SLOT_POLL_INTERVAL_MS=120000
```

Important:

- `ZKROLL_CONTRACT_ADDRESS` and `VITE_ZKROLL_CONTRACT_ADDRESS` must be the same.
- Use a SQLite DB that matches the deployed contract root.
- For a fresh contract, use a fresh DB.
- `VITE_*` variables are baked into the web image at build time. Rebuild `web` after changing them.

## 6. Required Directories

Create persistent directories:

```bash
mkdir -p data/api
mkdir -p deploy/nginx
mkdir -p deploy/certbot/www
mkdir -p deploy/certbot/conf
```

The API database should be mounted from:

```text
./data/api:/data
```

## 7. Nginx Reverse Proxy

Create `deploy/nginx/reverse.conf`.

The public nginx must set COOP/COEP headers once. These headers are required by o1js browser proving.

```nginx
server {
  listen 80;
  server_name zkroll.naamahdaemon.eu;

  location /.well-known/acme-challenge/ {
    root /var/www/certbot;
  }

  location / {
    return 301 https://$host$request_uri;
  }
}

server {
  listen 443 ssl http2;
  server_name zkroll.naamahdaemon.eu;

  ssl_certificate /etc/letsencrypt/live/zkroll.naamahdaemon.eu/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/zkroll.naamahdaemon.eu/privkey.pem;

  location /api/ {
    rewrite ^/api/(.*)$ /$1 break;
    proxy_pass http://api:4000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto https;
  }

  location / {
    proxy_pass http://web:80;
    proxy_http_version 1.1;
    proxy_set_header Host $host;

    add_header Cross-Origin-Opener-Policy same-origin always;
    add_header Cross-Origin-Embedder-Policy require-corp always;
    add_header Cross-Origin-Resource-Policy same-origin always;
  }
}
```

If you mount a single config file, recreate the nginx container after changing it. Docker bind mounts can keep an old file inode after `git pull`.

## 8. First Certificate Bootstrap

If nginx cannot start because certificates do not exist yet, use a temporary HTTP-only nginx config or create the certificate with certbot standalone while port `80` is free.

Standalone option:

```bash
sudo systemctl stop nginx || true
docker run --rm \
  -p 80:80 \
  -v "$PWD/deploy/certbot/conf:/etc/letsencrypt" \
  -v "$PWD/deploy/certbot/www:/var/www/certbot" \
  certbot/certbot certonly \
  --standalone \
  --email "$LETSENCRYPT_EMAIL" \
  --agree-tos \
  --no-eff-email \
  -d zkroll.naamahdaemon.eu
```

Then start the Docker stack.

## 9. Start Production

Build and start:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```

Because the public nginx container can keep stale upstream state after rebuilding `web`, recreate nginx after web/api rebuilds:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --force-recreate nginx
```

Check:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml ps
curl -I https://zkroll.naamahdaemon.eu/
```

Expected security headers:

```text
cross-origin-opener-policy: same-origin
cross-origin-embedder-policy: require-corp
cross-origin-resource-policy: same-origin
```

In the browser console:

```js
window.crossOriginIsolated
```

must return:

```text
true
```

## 10. Update And Rebuild

Normal update:

```bash
cd /opt/zkroll
git pull --ff-only origin main
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build api web
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --force-recreate nginx
```

Full no-cache rebuild:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml build --no-cache api web
docker compose --env-file .env.production -f docker-compose.prod.yml up -d
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --force-recreate nginx
```

Restart only API:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml restart api
```

Restart only web:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build web
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --force-recreate nginx
```

Restart only public nginx:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --force-recreate nginx
```

## 11. Logs And Diagnostics

Show container status:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml ps
```

Follow API logs:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml logs -f api
```

Follow nginx logs:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml logs -f nginx
```

Inspect effective nginx config:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml exec nginx nginx -T
```

Check COOP/COEP headers:

```bash
curl -I https://zkroll.naamahdaemon.eu/
```

Test web from the public nginx container:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml exec nginx wget -S -O - http://web:80/ 2>&1 | head -40
```

Test API from the public nginx container:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml exec nginx wget -S -O - http://api:4000/health 2>&1 | head -40
```

Test public API:

```bash
curl -sS https://zkroll.naamahdaemon.eu/api/health
curl -sS https://zkroll.naamahdaemon.eu/api/networks/devnet/current-slot
```

Test local placeholder transaction status. It should answer immediately:

```bash
curl -sS "https://zkroll.naamahdaemon.eu/api/transactions/devnet/pending:123/status"
```

## 12. SQLite Operations

Open the DB from the host:

```bash
sqlite3 data/api/zkroll-mainnet.db
```

If the DB is read-only from the host:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml stop api
sudo chown -R "$USER":"$USER" data/api
sqlite3 data/api/zkroll-mainnet.db
docker compose --env-file .env.production -f docker-compose.prod.yml start api
```

Backup:

```bash
mkdir -p backups
cp data/api/zkroll-mainnet.db "backups/zkroll-mainnet-$(date +%Y%m%d-%H%M%S).db"
```

Dump:

```bash
sqlite3 data/api/zkroll-mainnet.db ".dump" > "backups/zkroll-mainnet-$(date +%Y%m%d-%H%M%S).sql"
```

Restore from DB file:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml stop api
cp backups/zkroll-mainnet-YYYYMMDD-HHMMSS.db data/api/zkroll-mainnet.db
docker compose --env-file .env.production -f docker-compose.prod.yml start api
```

## 13. Certificate Renewal

Manual renewal:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml run --rm certbot renew
docker compose --env-file .env.production -f docker-compose.prod.yml exec nginx nginx -s reload
```

Cron example:

```cron
0 3 * * * cd /opt/zkroll && docker compose --env-file .env.production -f docker-compose.prod.yml run --rm certbot renew --quiet && docker compose --env-file .env.production -f docker-compose.prod.yml exec nginx nginx -s reload
```

## 14. Common Problems

### 502 Bad Gateway On `/`

Nginx cannot reach `web:80`.

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml ps
docker compose --env-file .env.production -f docker-compose.prod.yml logs --tail=100 web
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build web
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --force-recreate nginx
```

### 504 Gateway Timeout On `/api/...`

The API did not answer before nginx timeout. Usually the API is waiting for an external Mina GraphQL endpoint.

Reduce polling and use conservative cache values:

```env
VITE_TX_POLL_INTERVAL_MS=120000
VITE_SLOT_POLL_INTERVAL_MS=120000
ZKROLL_CHAIN_REQUEST_TIMEOUT_MS=8000
ZKROLL_CURRENT_SLOT_CACHE_MS=60000
ZKROLL_ONCHAIN_ROOT_CACHE_MS=60000
```

Then rebuild `api` and `web`.

### `window.crossOriginIsolated` Is `false`

Check headers:

```bash
curl -I https://zkroll.naamahdaemon.eu/
docker compose --env-file .env.production -f docker-compose.prod.yml exec nginx nginx -T | grep -i -n "cross-origin"
```

Headers must be emitted once by the public nginx. If they are missing, fix `deploy/nginx/reverse.conf` and recreate nginx.

### Duplicate Or Missing Headers After Rebuild

Recreate nginx:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --force-recreate nginx
```

### Local Root Differs From On-chain Root

The SQLite DB and the contract state are out of sync. With the current contract design, the DB must match the contract Merkle root.

Options:

- restore the matching SQLite backup;
- reimport exact game rows;
- deploy a fresh contract with a fresh DB.

---

# Francais

## 1. Architecture Cible

La stack de production utilise ces containers :

- `web` : build statique Vite servi par nginx.
- `api` : API Fastify sur le port `4000` dans Docker.
- `nginx` : reverse proxy public sur les ports `80` et `443`.
- `certbot` : generation et renouvellement du certificat Let's Encrypt.

Flux public :

```text
Navigateur -> https://zkroll.naamahdaemon.eu -> nginx -> web
Navigateur -> https://zkroll.naamahdaemon.eu/api -> nginx -> api:4000
```

## 2. Prerequis Serveur

Installe Docker et le plugin Docker Compose.

Sur Ubuntu :

```bash
sudo apt update
sudo apt install -y ca-certificates curl git
```

Si Docker n'est pas encore installe :

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"
```

Deconnecte-toi puis reconnecte-toi apres l'ajout au groupe `docker`.

Verification :

```bash
docker --version
docker compose version
```

## 3. Cloner Ou Mettre A Jour Le Depot

Arborescence recommandee :

```bash
sudo mkdir -p /opt/zkroll
sudo chown -R "$USER":"$USER" /opt/zkroll
cd /opt/zkroll
git clone git@github.com:naamahdaemon/zkroll.git .
```

Si le depot est deja dans `/opt/zkroll/zkroll`, travaille depuis ce dossier ou remonte les fichiers.

Mise a jour :

```bash
cd /opt/zkroll
git pull --ff-only origin main
```

## 4. DNS

Cree un enregistrement `A` :

```text
zkroll.naamahdaemon.eu -> IP_V4_DU_SERVEUR
```

Attends la propagation :

```bash
dig +short zkroll.naamahdaemon.eu
```

## 5. Environnement De Production

Cree `/opt/zkroll/.env.production` :

```env
DOMAIN=zkroll.naamahdaemon.eu
LETSENCRYPT_EMAIL=you@example.com

ZKROLL_CONTRACT_ADDRESS=B62_REMPLACER_PAR_ADRESSE_ZKROLL_DEPLOYEE
ZKROLL_DB_PATH=/data/zkroll-mainnet.db
ZKROLL_ONCHAIN_ROOT_CACHE_MS=60000
ZKROLL_CURRENT_SLOT_CACHE_MS=60000
ZKROLL_CHAIN_REQUEST_TIMEOUT_MS=8000

VITE_API_URL=https://zkroll.naamahdaemon.eu/api
VITE_ONCHAIN_ENABLED=true
VITE_ZKROLL_CONTRACT_ADDRESS=B62_REMPLACER_PAR_ADRESSE_ZKROLL_DEPLOYEE
VITE_FEE_NANOMINA=100000000
VITE_WALLET_RESPONSE_TIMEOUT_MS=120000
VITE_REFUND_TIMEOUT_SLOTS=120
VITE_O1JS_BROWSER_CACHE_ENABLED=false
VITE_TX_POLL_INTERVAL_MS=120000
VITE_SLOT_POLL_INTERVAL_MS=120000
```

Important :

- `ZKROLL_CONTRACT_ADDRESS` et `VITE_ZKROLL_CONTRACT_ADDRESS` doivent etre identiques.
- La base SQLite doit correspondre a la racine du contrat deploye.
- Pour un contrat neuf, utilise une base neuve.
- Les variables `VITE_*` sont injectees dans l'image web au build. Il faut rebuilder `web` apres modification.

## 6. Dossiers Persistants

Cree les dossiers :

```bash
mkdir -p data/api
mkdir -p deploy/nginx
mkdir -p deploy/certbot/www
mkdir -p deploy/certbot/conf
```

La base API doit etre montee avec :

```text
./data/api:/data
```

## 7. Reverse Proxy Nginx

Cree `deploy/nginx/reverse.conf`.

Le nginx public doit ajouter les headers COOP/COEP une seule fois. Ils sont necessaires pour o1js dans le navigateur.

```nginx
server {
  listen 80;
  server_name zkroll.naamahdaemon.eu;

  location /.well-known/acme-challenge/ {
    root /var/www/certbot;
  }

  location / {
    return 301 https://$host$request_uri;
  }
}

server {
  listen 443 ssl http2;
  server_name zkroll.naamahdaemon.eu;

  ssl_certificate /etc/letsencrypt/live/zkroll.naamahdaemon.eu/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/zkroll.naamahdaemon.eu/privkey.pem;

  location /api/ {
    rewrite ^/api/(.*)$ /$1 break;
    proxy_pass http://api:4000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto https;
  }

  location / {
    proxy_pass http://web:80;
    proxy_http_version 1.1;
    proxy_set_header Host $host;

    add_header Cross-Origin-Opener-Policy same-origin always;
    add_header Cross-Origin-Embedder-Policy require-corp always;
    add_header Cross-Origin-Resource-Policy same-origin always;
  }
}
```

Si tu montes un fichier seul, recree le container nginx apres chaque modification. Docker peut garder l'ancien inode apres un `git pull`.

## 8. Premier Certificat

Si nginx ne peut pas demarrer car les certificats n'existent pas encore, utilise une config temporaire HTTP uniquement ou certbot standalone avec le port `80` libre.

Option standalone :

```bash
sudo systemctl stop nginx || true
docker run --rm \
  -p 80:80 \
  -v "$PWD/deploy/certbot/conf:/etc/letsencrypt" \
  -v "$PWD/deploy/certbot/www:/var/www/certbot" \
  certbot/certbot certonly \
  --standalone \
  --email "$LETSENCRYPT_EMAIL" \
  --agree-tos \
  --no-eff-email \
  -d zkroll.naamahdaemon.eu
```

Puis demarre la stack Docker.

## 9. Demarrer La Production

Build et lancement :

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```

Apres rebuild de `web` ou `api`, recree nginx pour eviter les anciennes resolutions/upstreams Docker :

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --force-recreate nginx
```

Verification :

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml ps
curl -I https://zkroll.naamahdaemon.eu/
```

Headers attendus :

```text
cross-origin-opener-policy: same-origin
cross-origin-embedder-policy: require-corp
cross-origin-resource-policy: same-origin
```

Dans la console du navigateur :

```js
window.crossOriginIsolated
```

doit renvoyer :

```text
true
```

## 10. Mise A Jour Et Rebuild

Mise a jour normale :

```bash
cd /opt/zkroll
git pull --ff-only origin main
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build api web
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --force-recreate nginx
```

Rebuild complet sans cache :

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml build --no-cache api web
docker compose --env-file .env.production -f docker-compose.prod.yml up -d
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --force-recreate nginx
```

Redemarrer seulement l'API :

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml restart api
```

Redemarrer seulement le front :

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build web
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --force-recreate nginx
```

Redemarrer seulement nginx public :

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --force-recreate nginx
```

## 11. Logs Et Diagnostic

Etat des containers :

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml ps
```

Logs API :

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml logs -f api
```

Logs nginx :

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml logs -f nginx
```

Configuration nginx effective :

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml exec nginx nginx -T
```

Verifier les headers COOP/COEP :

```bash
curl -I https://zkroll.naamahdaemon.eu/
```

Tester le front depuis nginx :

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml exec nginx wget -S -O - http://web:80/ 2>&1 | head -40
```

Tester l'API depuis nginx :

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml exec nginx wget -S -O - http://api:4000/health 2>&1 | head -40
```

Tester l'API publique :

```bash
curl -sS https://zkroll.naamahdaemon.eu/api/health
curl -sS https://zkroll.naamahdaemon.eu/api/networks/devnet/current-slot
```

Tester un placeholder local. Il doit repondre immediatement :

```bash
curl -sS "https://zkroll.naamahdaemon.eu/api/transactions/devnet/pending:123/status"
```

## 12. Operations SQLite

Ouvrir la base depuis l'hote :

```bash
sqlite3 data/api/zkroll-mainnet.db
```

Si la base est en lecture seule :

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml stop api
sudo chown -R "$USER":"$USER" data/api
sqlite3 data/api/zkroll-mainnet.db
docker compose --env-file .env.production -f docker-compose.prod.yml start api
```

Sauvegarde :

```bash
mkdir -p backups
cp data/api/zkroll-mainnet.db "backups/zkroll-mainnet-$(date +%Y%m%d-%H%M%S).db"
```

Dump SQL :

```bash
sqlite3 data/api/zkroll-mainnet.db ".dump" > "backups/zkroll-mainnet-$(date +%Y%m%d-%H%M%S).sql"
```

Restaurer un fichier DB :

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml stop api
cp backups/zkroll-mainnet-YYYYMMDD-HHMMSS.db data/api/zkroll-mainnet.db
docker compose --env-file .env.production -f docker-compose.prod.yml start api
```

## 13. Renouvellement Certificat

Renouvellement manuel :

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml run --rm certbot renew
docker compose --env-file .env.production -f docker-compose.prod.yml exec nginx nginx -s reload
```

Exemple cron :

```cron
0 3 * * * cd /opt/zkroll && docker compose --env-file .env.production -f docker-compose.prod.yml run --rm certbot renew --quiet && docker compose --env-file .env.production -f docker-compose.prod.yml exec nginx nginx -s reload
```

## 14. Problemes Courants

### 502 Bad Gateway Sur `/`

Nginx ne joint pas `web:80`.

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml ps
docker compose --env-file .env.production -f docker-compose.prod.yml logs --tail=100 web
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build web
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --force-recreate nginx
```

### 504 Gateway Timeout Sur `/api/...`

L'API n'a pas repondu avant le timeout nginx. Elle attend souvent un endpoint GraphQL Mina externe.

Utilise des valeurs conservatrices :

```env
VITE_TX_POLL_INTERVAL_MS=120000
VITE_SLOT_POLL_INTERVAL_MS=120000
ZKROLL_CHAIN_REQUEST_TIMEOUT_MS=8000
ZKROLL_CURRENT_SLOT_CACHE_MS=60000
ZKROLL_ONCHAIN_ROOT_CACHE_MS=60000
```

Puis rebuild `api` et `web`.

### `window.crossOriginIsolated` Vaut `false`

Verifier :

```bash
curl -I https://zkroll.naamahdaemon.eu/
docker compose --env-file .env.production -f docker-compose.prod.yml exec nginx nginx -T | grep -i -n "cross-origin"
```

Les headers doivent etre emis une seule fois par le nginx public. S'ils manquent, corrige `deploy/nginx/reverse.conf` puis recree nginx.

### Headers En Double Ou Absents Apres Rebuild

Recree nginx :

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --force-recreate nginx
```

### Racine Locale Differente De La Racine On-chain

La base SQLite et l'etat du contrat sont desynchronises. Avec le contrat actuel, la base doit correspondre a la racine Merkle du contrat.

Options :

- restaurer la sauvegarde SQLite correspondante ;
- reimporter exactement les lignes des jeux ;
- deployer un nouveau contrat avec une base neuve.
