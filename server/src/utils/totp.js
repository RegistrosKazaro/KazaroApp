import { generateSecret as genSecret, generateURI, verifySync } from "otplib";
import QRCode from "qrcode";

export function generateSecret() {
  return genSecret();
}

export function verifyToken(token, secret) {
  try {
    const res = verifySync({ token: String(token).trim(), secret });
    return res?.valid ?? res === true;
  } catch { return false; }
}

export async function generateQR(secret, label, issuer = "KazaroApp") {
  const uri = generateURI({ secret, label, issuer });
  return QRCode.toDataURL(uri);
}