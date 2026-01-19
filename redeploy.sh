#!/bin/bash
set -euo pipefail

echo "==> Redeploy iniciado: $(date)"

# ========================
# Cargar NVM (Node/NPM)
# ========================
export NVM_DIR="$HOME/.nvm"
# shellcheck source=/dev/null
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

echo "==> User: $(whoami)"
echo "==> PWD:  $(pwd)"
echo "==> Node: $(node -v)"
echo "==> NPM:  $(npm -v)"

# ========================
# Proyecto
# ========================
APP_DIR="/home/ec2-user/apps/KazaroApp"
WEB_ROOT="/var/www/insumos"
DOMAIN="insumos.kazaro.com.ar"
API_PORT="4000"
PM2_NAME="kazaro-server"
BRANCH="main"

cd "$APP_DIR"

# ========================
# Git (deploy seguro: deja el repo EXACTO como origin/main)
# ========================
echo "==> Git fetch + reset"
git fetch origin
git checkout "$BRANCH"
git reset --hard "origin/$BRANCH"

# ========================
# Backend
# ========================
echo "==> Backend install + restart"
cd server

if [ -f package-lock.json ]; then
  npm ci
else
  npm install
fi

# Asegura que PM2 tome .env (si tu pm2 start ya lo hace, esto igual no molesta)
pm2 restart "$PM2_NAME" --update-env

# ========================
# Frontend build
# ========================
echo "==> Frontend install + build"
cd ../client

if [ -f package-lock.json ]; then
  npm ci
else
  npm install
fi

npm run build

# ========================
# Publicar build en Nginx web root
# ========================
echo "==> Sync dist to web root: $WEB_ROOT"
sudo rsync -a --delete dist/ "$WEB_ROOT"/
sudo chown -R nginx:nginx "$WEB_ROOT"
sudo chmod -R 755 "$WEB_ROOT"

# ========================
# Reload Nginx
# ========================
echo "==> Reload nginx"
sudo nginx -t
sudo systemctl reload nginx || true

# ========================
# Healthchecks
# ========================
echo "==> Healthcheck localhost API"
curl -fsS "http://127.0.0.1:${API_PORT}/_health" >/dev/null

echo "==> Healthcheck public API"
curl -fsS "https://${DOMAIN}/api/_health" >/dev/null

echo "✅ Redeploy completo: $(date)"
#!/bin/bash
set -euo pipefail

echo "==> Redeploy iniciado: $(date)"

# ========================
# Cargar NVM (Node/NPM)
# ========================
export NVM_DIR="$HOME/.nvm"
# shellcheck source=/dev/null
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

echo "==> User: $(whoami)"
echo "==> PWD:  $(pwd)"
echo "==> Node: $(node -v)"
echo "==> NPM:  $(npm -v)"

# ========================
# Proyecto
# ========================
APP_DIR="/home/ec2-user/apps/KazaroApp"
WEB_ROOT="/var/www/insumos"
DOMAIN="insumos.kazaro.com.ar"
API_PORT="4000"
PM2_NAME="kazaro-server"
BRANCH="main"

cd "$APP_DIR"

# ========================
# Git (deploy seguro: deja el repo EXACTO como origin/main)
# ========================
echo "==> Git fetch + reset"
git fetch origin
git checkout "$BRANCH"
git reset --hard "origin/$BRANCH"

# ========================
# Backend
# ========================
echo "==> Backend install + restart"
cd server

if [ -f package-lock.json ]; then
  npm ci
else
  npm install
fi

# Asegura que PM2 tome .env (si tu pm2 start ya lo hace, esto igual no molesta)
pm2 restart "$PM2_NAME" --update-env

# ========================
# Frontend build
# ========================
echo "==> Frontend install + build"
cd ../client

if [ -f package-lock.json ]; then
  npm ci
else
  npm install
fi

npm run build

# ========================
# Publicar build en Nginx web root
# ========================
echo "==> Sync dist to web root: $WEB_ROOT"
sudo rsync -a --delete dist/ "$WEB_ROOT"/
sudo chown -R nginx:nginx "$WEB_ROOT"
sudo chmod -R 755 "$WEB_ROOT"

# ========================
# Reload Nginx
# ========================
echo "==> Reload nginx"
sudo nginx -t
sudo systemctl reload nginx || true

# ========================
# Healthchecks
# ========================
echo "==> Healthcheck localhost API"
curl -fsS "http://127.0.0.1:${API_PORT}/_health" >/dev/null

echo "==> Healthcheck public API"
curl -fsS "https://${DOMAIN}/api/_health" >/dev/null

echo "✅ Redeploy completo: $(date)"

