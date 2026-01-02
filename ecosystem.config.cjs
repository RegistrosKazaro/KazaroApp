module.exports = {
  apps: [
    {
      name: "kazaro-api",
      cwd: "/var/www/kazaroapp/server",
      script: "src/index.js",
      env: {
        NODE_ENV: "production",

        // 🔐 AUTH
        JWT_SECRET: "kazaro-prod-super-secret-2025",

        // 🌐 APP
        APP_BASE_URL: "http://insumos.kazaro.com.ar",
        PORT: "4000",

        // 🗄️ DB
        DB_PATH: "/var/www/kazaroapp/server/Kazaro.db",

        // 📧 MAIL
        SMTP_HOST: "smtp.gmail.com",
        SMTP_PORT: "465",
        SMTP_SECURE: "true",
        SMTP_USER: "nicolas.barcena@kazaro.com.ar",
        SMTP_PASS: "jepjrcwfuvjizonu",
        MAIL_FROM: "Kazaro Pedidos <nicolas.barcena@kazaro.com.ar>",
        MAIL_TO: "nicolas.barcena@kazaro.com.ar, nicobarcena676@gmail.com",
        MAIL_DISABLE: "0",
        MAIL_ALLOW_USER_FROM: "0"
      }
    }
  ]
};

