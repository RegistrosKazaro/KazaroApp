module.exports = {
  apps: [
    {
      name: "kazaro-api",
      script: "server/index.js",
      env: {
        NODE_ENV: "production",
        JWT_SECRET: "super-secret-kazaro-prod",
      }
    }
  ]
}
