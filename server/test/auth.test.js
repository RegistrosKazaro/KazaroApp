import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import argon2 from "argon2";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { runInThisContext } from "node:vm";


const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kazaro-test-"));
const dbPath = path.join(tmpDir, "test.db");
fs.writeFileSync(dbPath, "");
process.env.DB_PATH = dbPath;
process.env.JWT_SECRET = "initial-secret";

const { verifyPassword } = await import("../src/routes/auth.js");
const { signToken } = await import("../src/middleware/auth.js");
const { env } = await import("../src/utils/env.js");

test("acepta hash Argon2 valido", async () =>{
    const password = "Contraseña-segura";
    const hash = await argon2.hash(password, { type: argon2.argon2id});
    const result = await verifyPassword(password, {password_hash: hash});
    assert.equal(result.ok, true);
    assert.equal(result.algorithm, "argon2");
    assert.equal(result.needsUpgrade, undefined);
});

test("acepta hash bcrypt valido", async()=> {
    const password = "otra-clave";
    const hash = await bcrypt.hash(password, 10);
    const result = await verifyPassword(password, { password_hash:hash});

    assert.equal(result.ok, true);
    assert.equal(result.algorithm, "bcrypt");
});

test("identifica hash legacy y solicita migracion", async()=>{
    const password = "clave-legacy";
    const result = await verifyPassword(password, { password_plain:password});

    assert.equal(result.ok, true);
    assert.equal(result.needsUpgrade, true);
    assert.equal(result.algorithm, "plain");
});

test("rechaza hash desconocido", async()=>{
    const password = "no-importa";
    const result = await verifyPassword( password, { password_hash:"$x$desconocido"});

    assert.equal(result.ok, false);
    assert.equal(result.reason, "unknown-hash");
});

test("signToken firma el uid cuando hay secreto", ()=>{
    const prev = env.JWT_SECRET;
    env.JWT_SECRET = "jwt-test-secret";

    const token = signToken(123);
    const decoded = jwt.verify(token, env.JWT_SECRET);

    assert.equal(decoded.uid, 123);
    env.JWT_SECRET = prev;
});

test("signToken lleva la empresa cuando se la pasan", ()=>{
    // Kazaro y Pazar comparten la base: el token tiene que decir cuál es.
    const prev = env.JWT_SECRET;
    env.JWT_SECRET = "jwt-test-secret";

    const decoded = jwt.verify(signToken(123, 2), env.JWT_SECRET);

    assert.equal(decoded.uid, 123);
    assert.equal(decoded.eid, 2);
    env.JWT_SECRET = prev;
});

test("signToken falla si falta JWT_SECRET", ()=>{
    // Antes caía en el literal "dev-secret" y firmaba igual: cualquiera que
    // supiera esa palabra podía fabricarse un token con el uid que quisiera.
    const prev = env.JWT_SECRET;
    env.JWT_SECRET = undefined;

    assert.throws(() => signToken(999), /JWT_SECRET/);

    env.JWT_SECRET= prev;
});