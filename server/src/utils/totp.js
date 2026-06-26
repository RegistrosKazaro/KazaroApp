import pkg from "otplib";
const { authenticator } = pkg;
import QRCode from "qrcode";

export function generateSecret() {
  return authenticator.generateSecret();
}

export function verifyToken(token, secret) {
  try { return authenticator.verify({ token: String(token).trim(), secret }); }
  catch { return false; }
}

export async function generateQR(secret, label, issuer = "KazaroApp") {
  const uri = authenticator.keyuri(label, issuer, secret);
  return QRCode.toDataURL(uri);
}