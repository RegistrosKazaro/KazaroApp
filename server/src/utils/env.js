const bool = (v, d = false) => v == null ? d : /^(1|true|yes|on)$/i.test(String(v).trim());
const num  = (v, d) => Number.isFinite(Number(v)) ? Number(v) : d;
const list = (v) => String(v || "")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);
export const env = {
  NODE_ENV: process.env.NODE_ENV || "development",

  APP_BASE_URL: process.env.APP_BASE_URL || "http://localhost:4000",
  PORT: num(process.env.PORT, 4000),

  DB_PATH: process.env.DB_PATH,

  MAIL_DISABLE: bool(process.env.MAIL_DISABLE, false),
  SMTP_HOST: process.env.SMTP_HOST || "smtp.gmail.com",
  SMTP_PORT: num(process.env.SMTP_PORT, 587),
  SMTP_SECURE: /^(465|true)$/i.test(String(process.env.SMTP_SECURE || "")),
  SMTP_USER: process.env.SMTP_USER || "",
  SMTP_PASS: process.env.SMTP_PASS || "",

  // Remitente y destinatarios
  MAIL_FROM: process.env.MAIL_FROM || process.env.SMTP_USER || "",
  MAIL_TO: process.env.MAIL_TO || "",
  MAIL_CC: process.env.MAIL_CC || "",
  MAIL_BCC: process.env.MAIL_BCC || "",
  MAIL_BLOCKLIST: process.env.MAIL_BLOCKLIST || "",

  // Permitir (o no) usar el mail del usuario en el "From"
  MAIL_ALLOW_USER_FROM: bool(process.env.MAIL_ALLOW_USER_FROM, false),

  DEBUG_AUTH: bool(process.env.DEBUG_AUTH, false),
  JWT_SECRET: process.env.JWT_SECRET,
};
