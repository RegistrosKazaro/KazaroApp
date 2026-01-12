module.exports = {
  apps: [
    {
      name: "kazaro-api",
      cwd: "/var/www/kazaroapp/server",
      script: "src/index.js",

      // PM2 solo define el entorno. El resto viene del sistema (.env o export)
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
