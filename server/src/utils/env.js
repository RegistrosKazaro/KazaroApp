// server/src/utils/env.js
export const env = {
  // Server
  PORT: process.env.PORT,
  NODE_ENV: process.env.NODE_ENV,
  APP_URL: process.env.APP_URL,
  APP_BASE_URL: process.env.APP_BASE_URL,

  // DB
  DB_PATH: process.env.DB_PATH,

  // Auth / Cookies
  JWT_SECRET: process.env.JWT_SECRET,
  JWT_EXPIRES: process.env.JWT_EXPIRES,
  COOKIE_NAME: process.env.COOKIE_NAME,
  COOKIE_SECURE: process.env.COOKIE_SECURE,

  // Catálogo (si los usás)
  CAT_PRODUCTS_TABLE: process.env.CAT_PRODUCTS_TABLE,
  CAT_PRODUCTS_NAME_COL: process.env.CAT_PRODUCTS_NAME_COL,
  CAT_PRODUCTS_CAT_ID_COL: process.env.CAT_PRODUCTS_CAT_ID_COL,
  CAT_TABLE: process.env.CAT_TABLE,
  CAT_ID_COL: process.env.CAT_ID_COL,
  CAT_NAME_COL: process.env.CAT_NAME_COL,

  // Mail
  SMTP_HOST: process.env.SMTP_HOST,
  SMTP_PORT: process.env.SMTP_PORT,
  SMTP_SECURE: process.env.SMTP_SECURE,
  SMTP_USER: process.env.SMTP_USER,
  SMTP_PASS: process.env.SMTP_PASS,
  MAIL_FROM: process.env.MAIL_FROM,
  MAIL_TO: process.env.MAIL_TO,
};
