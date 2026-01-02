#!/bin/bash
set -euo pipefail

# Cargar NVM (necesario para que node/npm estén en PATH dentro del script)
export NVM_DIR="$HOME/.nvm"
# shellcheck source=/dev/null
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

cd /var/www/kazaroapp

echo "== git fetch & pull =="
git fetch --all
git pull --rebase

echo "== server =="
cd server
if [ -f package-lock.json ]; then
  npm ci
else
  npm install
fi
# Si cambiaste variables de entorno, usa --update-env
pm2 restart kazaro-api --update-env

echo "== client =="
cd ../client
if [ -f package-lock.json ]; then
  npm ci
else
  npm install
fi
npm run build

echo "== nginx reload =="
sudo systemctl reload nginx || true

echo "✅ Redeploy completo: $(date)"
