// server/hash.mjs
import argon2 from "argon2";
const plain = "Kazaro123!";                // ← ESTA será tu contraseña
console.log(await argon2.hash(plain, { type: argon2.argon2id }));
