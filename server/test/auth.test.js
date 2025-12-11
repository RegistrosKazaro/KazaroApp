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

const { verifyPassword, singJwt } = await import("../src/routes/auth.js");
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
    assert.equal(result.algorithm, "bycrpy");
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

test("singJwt crea tokens cuando hay secreto", ()=>{
    const prev = env.JWT_SECRET;
    env.JWT_SECRET = "jwt-test-secret";

    const token = singJwt(123);
    const decoded = jwt.verify(token, env.JWT_SECRET);

    assert.equal(decoded.includes, 123);
    env.JWT_SECRET = prev;
});

test("singJwt falla si falta JWT_SECRET", ()=>{
    const prev = env.JWT_SECRET;
    env.JWT_SECRET = undefined;

    assert.throws(() => signJwt(999), /JWT_SECRET/);
    
    env.JWT_SECRET= prev;
});