import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);

// server/lib/http.ts
import { randomUUID } from "node:crypto";
function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  if (!res.hasHeader("Cache-Control")) {
    res.setHeader("Cache-Control", "no-store");
  }
  res.end(JSON.stringify(body));
}
function badRequest(res, errors) {
  json(res, 400, { error: "Invalid data", details: errors });
}
function unauthorized(res) {
  json(res, 401, { error: "Not signed in" });
}
function notFound(res) {
  json(res, 404, { error: "Not found" });
}
function methodNotAllowed(res, allowed) {
  res.setHeader("Allow", allowed.join(", "));
  json(res, 405, { error: "Method not allowed" });
}
async function readJson(req) {
  const MAX_BYTES = 4e5;
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BYTES) throw new Error("Request body too large");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("Malformed JSON");
  }
}
function newId() {
  return randomUUID();
}

// server/lib/crypto.ts
import {
  createHmac,
  randomBytes,
  randomUUID as randomUUID2,
  scrypt as scryptCallback,
  timingSafeEqual
} from "node:crypto";
import { promisify } from "node:util";
var scrypt = promisify(scryptCallback);
var SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
var TOKEN_TTL_DAYS = 30;
var TOKEN_MAX_AGE_SECONDS = TOKEN_TTL_DAYS * 86400;
async function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, SCRYPT.keylen, SCRYPT);
  return `scrypt$${salt.toString("base64")}$${derived.toString("base64")}`;
}
async function verifyPassword(password, stored) {
  const [scheme, saltB64, hashB64] = stored.split("$");
  if (scheme !== "scrypt" || !saltB64 || !hashB64) return false;
  const salt = Buffer.from(saltB64, "base64");
  const expected = Buffer.from(hashB64, "base64");
  let derived;
  try {
    derived = await scrypt(password, salt, expected.length, SCRYPT);
  } catch {
    return false;
  }
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}
function secret() {
  const value = process.env["AUTH_SECRET"];
  if (!value || value.length < 32) {
    throw new Error(
      "AUTH_SECRET is missing or too short (32 characters minimum). Generate one with: openssl rand -base64 48"
    );
  }
  return value;
}
function base64url(input) {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function sign(data) {
  return base64url(createHmac("sha256", secret()).update(data).digest());
}
function issueToken(userId) {
  const now = Math.floor(Date.now() / 1e3);
  const payload = {
    sub: userId,
    iat: now,
    exp: now + TOKEN_TTL_DAYS * 86400
  };
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64url(JSON.stringify(payload));
  return `${header}.${body}.${sign(`${header}.${body}`)}`;
}
function verifyToken(token) {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, body, signature] = parts;
  const expected = sign(`${header}.${body}`);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(body.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString()
    );
    if (!payload.sub || payload.exp < Math.floor(Date.now() / 1e3)) return null;
    return payload.sub;
  } catch {
    return null;
  }
}
function newId2() {
  return randomUUID2();
}

// server/lib/store.ts
var pool = null;
var schemaReady = false;
function sslFor(url) {
  const isLocal = /@(localhost|127\.0\.0\.1|\[::1\])(:\d+)?\//.test(url);
  const wantsNoSsl = /[?&]sslmode=disable/.test(url);
  return isLocal || wantsNoSsl ? false : { rejectUnauthorized: false };
}
function connectionString(url) {
  return url.replace(/([?&])sslmode=(require|prefer|verify-ca)\b/, "$1sslmode=no-verify");
}
async function getPool() {
  const url = process.env["POSTGRES_URL"];
  if (!url) {
    throw new Error(
      "POSTGRES_URL is missing. The application needs a database for accounts."
    );
  }
  if (!pool) {
    const { Pool } = await import("pg");
    pool = new Pool({
      connectionString: connectionString(url),
      ssl: sslFor(url),
      max: 1
    });
  }
  if (!schemaReady) {
    await ensureSchema(pool);
    schemaReady = true;
  }
  return pool;
}
async function ensureSchema(p) {
  await p.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- El email identifica la cuenta: se compara siempre en min\xFAsculas, as\xED
    -- que el \xEDndice \xFAnico va sobre su versi\xF3n normalizada.
    CREATE UNIQUE INDEX IF NOT EXISTS users_email_key ON users (lower(email));

    CREATE TABLE IF NOT EXISTS vehicles (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      data JSONB NOT NULL
    );

    CREATE TABLE IF NOT EXISTS records (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      vehicle_id TEXT NOT NULL REFERENCES vehicles (id) ON DELETE CASCADE,
      data JSONB NOT NULL
    );

    CREATE TABLE IF NOT EXISTS plans (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      vehicle_id TEXT NOT NULL REFERENCES vehicles (id) ON DELETE CASCADE,
      data JSONB NOT NULL
    );

    CREATE INDEX IF NOT EXISTS vehicles_user ON vehicles (user_id);
    CREATE INDEX IF NOT EXISTS records_user ON records (user_id);
    CREATE INDEX IF NOT EXISTS plans_user ON plans (user_id);
  `);
}
async function createUser(user) {
  const p = await getPool();
  await p.query(
    `INSERT INTO users (id, email, password_hash, name) VALUES ($1, $2, $3, $4)`,
    [user.id, user.email, user.passwordHash, user.name]
  );
}
async function findUserByEmail(email) {
  const p = await getPool();
  const result = await p.query(
    `SELECT id, email, password_hash, name, created_at
     FROM users WHERE lower(email) = lower($1)`,
    [email]
  );
  return result.rows[0] ? toUser(result.rows[0]) : null;
}
async function findUserById(id) {
  const p = await getPool();
  const result = await p.query(
    `SELECT id, email, password_hash, name, created_at FROM users WHERE id = $1`,
    [id]
  );
  return result.rows[0] ? toUser(result.rows[0]) : null;
}
async function deleteUser(id) {
  const p = await getPool();
  await p.query("DELETE FROM users WHERE id = $1", [id]);
}
function toUser(row) {
  return {
    id: row["id"],
    email: row["email"],
    passwordHash: row["password_hash"],
    name: row["name"],
    createdAt: row["created_at"].toISOString()
  };
}
async function loadSnapshot(userId) {
  const p = await getPool();
  const [vehicles, records, plans] = await Promise.all([
    p.query("SELECT data FROM vehicles WHERE user_id = $1", [userId]),
    p.query("SELECT data FROM records WHERE user_id = $1", [userId]),
    p.query("SELECT data FROM plans WHERE user_id = $1", [userId])
  ]);
  return {
    vehicles: vehicles.rows.map((r) => r["data"]),
    records: records.rows.map((r) => r["data"]),
    plans: plans.rows.map((r) => r["data"])
  };
}
async function findById(table, userId, id) {
  const p = await getPool();
  const result = await p.query(
    `SELECT data FROM ${table} WHERE id = $1 AND user_id = $2`,
    [id, userId]
  );
  return result.rows[0]?.["data"] ?? null;
}
async function upsert(table, userId, id, data, vehicleId) {
  const p = await getPool();
  if (table === "vehicles") {
    await p.query(
      `INSERT INTO vehicles (id, user_id, data) VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`,
      [id, userId, JSON.stringify(data)]
    );
    return;
  }
  await p.query(
    `INSERT INTO ${table} (id, user_id, vehicle_id, data) VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`,
    [id, userId, vehicleId, JSON.stringify(data)]
  );
}
async function remove(table, userId, id) {
  const p = await getPool();
  const result = await p.query(
    `DELETE FROM ${table} WHERE id = $1 AND user_id = $2`,
    [id, userId]
  );
  return (result.rowCount ?? 0) > 0;
}
async function removeVehicleCascade(userId, vehicleId) {
  return remove("vehicles", userId, vehicleId);
}

// server/lib/auth.ts
var COOKIE = "garaje_session";
function sessionCookie(token, maxAge) {
  const parts = [
    `${COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`
  ];
  if (process.env["NODE_ENV"] === "production") parts.push("Secure");
  return parts.join("; ");
}
function tokenFrom(req) {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === COOKIE) return rest.join("=");
  }
  return null;
}
function userIdFrom(req) {
  const token = tokenFrom(req);
  return token ? verifyToken(token) : null;
}
function toPublic(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    createdAt: user.createdAt
  };
}
var EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
var MIN_PASSWORD = 8;
function readCredentials(body, withName) {
  const data = typeof body === "object" && body ? body : {};
  const errors = [];
  const email = typeof data["email"] === "string" ? data["email"].trim() : "";
  const password = typeof data["password"] === "string" ? data["password"] : "";
  const name = typeof data["name"] === "string" ? data["name"].trim() : "";
  if (!EMAIL.test(email) || email.length > 254) {
    errors.push("Invalid email address");
  }
  if (password.length < MIN_PASSWORD) {
    errors.push(`Password must be at least ${MIN_PASSWORD} characters`);
  }
  if (password.length > 200) {
    errors.push("Password is too long");
  }
  if (withName && (name.length < 2 || name.length > 60)) {
    errors.push("Name must be between 2 and 60 characters");
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { email, password, name: name || void 0 } };
}
async function handleRegister(req, res) {
  let body;
  try {
    body = await readJson(req);
  } catch (error) {
    return badRequest(res, [error.message]);
  }
  const parsed = readCredentials(body, true);
  if (!parsed.ok) return badRequest(res, parsed.errors);
  const { email, password, name } = parsed.value;
  if (await findUserByEmail(email)) {
    return json(res, 409, { error: "An account with that email already exists" });
  }
  const user = {
    id: newId2(),
    email,
    passwordHash: await hashPassword(password),
    name,
    createdAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  try {
    await createUser(user);
  } catch {
    return json(res, 409, { error: "An account with that email already exists" });
  }
  res.setHeader("Set-Cookie", sessionCookie(issueToken(user.id), TOKEN_MAX_AGE_SECONDS));
  json(res, 201, { user: toPublic(user) });
}
async function handleLogin(req, res) {
  let body;
  try {
    body = await readJson(req);
  } catch (error) {
    return badRequest(res, [error.message]);
  }
  const parsed = readCredentials(body, false);
  if (!parsed.ok) return badRequest(res, parsed.errors);
  const user = await findUserByEmail(parsed.value.email);
  const invalid = () => json(res, 401, { error: "Incorrect email or password" });
  if (!user) {
    await hashPassword(parsed.value.password);
    return invalid();
  }
  if (!await verifyPassword(parsed.value.password, user.passwordHash)) {
    return invalid();
  }
  res.setHeader("Set-Cookie", sessionCookie(issueToken(user.id), TOKEN_MAX_AGE_SECONDS));
  json(res, 200, { user: toPublic(user) });
}
function handleLogout(res) {
  res.setHeader("Set-Cookie", sessionCookie("", 0));
  json(res, 200, { ok: true });
}
async function handleMe(req, res) {
  const userId = userIdFrom(req);
  if (!userId) return json(res, 401, { error: "Not signed in" });
  const user = await findUserById(userId);
  if (!user) {
    res.setHeader("Set-Cookie", sessionCookie("", 0));
    return json(res, 401, { error: "This account no longer exists" });
  }
  json(res, 200, { user: toPublic(user) });
}

// server/data/open-vehicle-db.json
var open_vehicle_db_default = { source: "https://raw.githubusercontent.com/plowman/open-vehicle-db/master/data", fetchedAt: "2026-09-07T15:53:48.760Z", makes: [{ slug: "acura", name: "ACURA", firstYear: 1985, lastYear: 2027, models: [{ name: "ADX", type: "car", years: "2025-2027" }, { name: "CL", type: "car", years: "1987-1999,2001-2003" }, { name: "ILX", type: "car", years: "2013-2027" }, { name: "Integra", type: "car", years: "1985-2001,2023-2027" }, { name: "Legend", type: "car", years: "1986-1995" }, { name: "MDX", type: "car", years: "2001-2027" }, { name: "NSX", type: "car", years: "1987-2005,2016-2022" }, { name: "RDX", type: "car", years: "2007-2027" }, { name: "RL", type: "car", years: "1987-2012" }, { name: "RLX", type: "car", years: "2014-2027" }, { name: "RSX", type: "car", years: "2002-2006" }, { name: "SLX", type: "car", years: "1996-1999" }, { name: "TL", type: "car", years: "1987-2014" }, { name: "TLX", type: "car", years: "2015-2027" }, { name: "TSX", type: "car", years: "2004-2014" }, { name: "Vigor", type: "car", years: "1992-1994" }, { name: "ZDX", type: "car", years: "2010-2013,2024-2027" }] }, { slug: "alfa_romeo", name: "ALFA ROMEO", firstYear: 1981, lastYear: 2027, models: [{ name: "164", type: "car", years: "1985-1987,1990-1995" }, { name: "4C", type: "car", years: "2014-2020" }, { name: "8C Competizione Spider", type: "car", years: "2000-2013" }, { name: "Giulia (952)", type: "car", years: "2016-2027" }, { name: "GTV6", type: "car", years: "1981-1986" }, { name: "Milano", type: "car", years: "1985-1990" }, { name: "Spider", type: "car", years: "1981-1994" }, { name: "Stelvio", type: "car", years: "2018-2027" }, { name: "Tonale", type: "car", years: "2024-2027" }] }, { slug: "am_general", name: "AM GENERAL", firstYear: 2013, lastYear: 2027, models: [{ name: "MV-1", type: "car", years: "2013-2027" }] }, { slug: "aston_martin", name: "ASTON MARTIN", firstYear: 1981, lastYear: 2027, models: [{ name: "DB11", type: "car", years: "2017-2024" }, { name: "DB12", type: "car", years: "2024-2027" }, { name: "DB7", type: "car", years: "1994-2003" }, { name: "DB9", type: "car", years: "2005-2016" }, { name: "DBS", type: "car", years: "2009-2012,2019-2024" }, { name: "DBX", type: "car", years: "2021-2027" }, { name: "Lagonda", type: "car", years: "1981-1989,1991-1994" }, { name: "Rapide", type: "car", years: "2010-2012,2014-2019" }, { name: "V12 Vantage", type: "car", years: "2011-2013,2015-2018" }, { name: "V8", type: "car", years: "1981-1989" }, { name: "V8 Vantage", type: "car", years: "1981-1989,2009-2018" }, { name: "Valhalla", type: "car", years: "2026-2027" }, { name: "Valiant", type: "car", years: "2024-2026" }, { name: "Valour", type: "car", years: "2024" }, { name: "Vanquish", type: "car", years: "2001-2007,2014-2018,2025-2027" }, { name: "Vanquish Zagato", type: "car", years: "2018-2019" }, { name: "Vantage", type: "car", years: "2006-2008,2019-2027" }, { name: "Virage", type: "car", years: "1990-1994,2012" }] }, { slug: "audi", name: "AUDI", firstYear: 1981, lastYear: 2027, models: [{ name: "100", type: "car", years: "1989-1994" }, { name: "200", type: "car", years: "1989-1991" }, { name: "4000", type: "car", years: "1981-1987" }, { name: "5000", type: "car", years: "1981-1988" }, { name: "80", type: "car", years: "1988-1991" }, { name: "90", type: "car", years: "1988-1995" }, { name: "A3", type: "car", years: "2006-2013,2015-2020,2022-2027" }, { name: "A4", type: "car", years: "1996-2027" }, { name: "A4 allroad", type: "car", years: "2013-2027" }, { name: "A5", type: "car", years: "2008-2027" }, { name: "A6", type: "car", years: "1995-2027" }, { name: "A6 allroad", type: "car", years: "2020-2026" }, { name: "A7", type: "car", years: "2012-2025" }, { name: "A7 e", type: "car", years: "2021-2022" }, { name: "A8", type: "car", years: "1997-2020" }, { name: "A8 e", type: "car", years: "2020" }, { name: "A8 L", type: "car", years: "2021-2027" }, { name: "A8 L e", type: "car", years: "2021" }, { name: "allroad", type: "car", years: "2001-2005" }, { name: "Cabriolet", type: "car", years: "1992-1998" }, { name: "Coupe", type: "car", years: "1990-1991" }, { name: "e-tron", type: "car", years: "2019,2021-2023" }, { name: "e-tron GT", type: "car", years: "2022-2027" }, { name: "e-tron Sportback", type: "car", years: "2020-2022" }, { name: "Q3", type: "car", years: "2015-2027" }, { name: "Q4", type: "car", years: "2022-2027" }, { name: "Q5", type: "car", years: "2009-2027" }, { name: "Q5 e", type: "car", years: "2020-2021,2023-2025" }, { name: "Q6", type: "car", years: "2025-2027" }, { name: "Q7", type: "car", years: "2007-2015,2017-2027" }, { name: "Q8", type: "car", years: "2019-2027" }, { name: "R8", type: "car", years: "2008-2012,2014-2018,2020-2023" }, { name: "RS 3", type: "car", years: "2017-2020,2022-2027" }, { name: "RS 4", type: "car", years: "2007-2008" }, { name: "RS 5", type: "car", years: "2013-2015,2018-2019,2021-2025" }, { name: "RS 6", type: "car", years: "2003-2004" }, { name: "RS 6 Avant", type: "car", years: "2021-2026" }, { name: "RS 7", type: "car", years: "2014-2018,2021-2027" }, { name: "RS e-tron GT", type: "car", years: "2022-2027" }, { name: "RS Q8", type: "car", years: "2020-2027" }, { name: "S e-tron GT", type: "car", years: "2025-2027" }, { name: "S3", type: "car", years: "2015-2020,2022-2027" }, { name: "S4", type: "car", years: "1992-1994,2000-2002,2004-2016,2018-2027" }, { name: "S5", type: "car", years: "2008-2027" }, { name: "S6", type: "car", years: "1995-1997,2002-2003,2007-2011,2013-2018,2020-2025,2027" }, { name: "S7", type: "car", years: "2013-2018,2020-2025" }, { name: "S8", type: "car", years: "2001-2003,2007-2009,2013-2018,2020-2027" }, { name: "SQ5", type: "car", years: "2014-2027" }, { name: "SQ6", type: "car", years: "2025-2027" }, { name: "SQ7", type: "car", years: "2020-2027" }, { name: "SQ8", type: "car", years: "2020-2027" }, { name: "TT", type: "car", years: "2000-2006,2008-2023" }, { name: "TT RS", type: "car", years: "2013-2014,2018-2022" }, { name: "TTS", type: "car", years: "2009-2023" }, { name: "V8", type: "car", years: "1991-1994" }] }, { slug: "bentley", name: "BENTLEY", firstYear: 1984, lastYear: 2027, models: [{ name: "ARMOURED ARNAGE", type: "car", years: "2004-2009" }, { name: "Arnage", type: "car", years: "1999-2009" }, { name: "Azure", type: "car", years: "1996-2010" }, { name: "Bentayga", type: "car", years: "2017-2027" }, { name: "Brooklands", type: "car", years: "1993-1998,2009-2010" }, { name: "Continental", type: "car", years: "1984-2027" }, { name: "Eight", type: "car", years: "1987-1992" }, { name: "Flying Spur", type: "car", years: "2014-2027" }, { name: "Mulsanne", type: "car", years: "1984-1992,2011-2020" }, { name: "Roll Royce Silver Seraph", type: "car", years: "2009" }, { name: "Rolls-Royce Park Ward", type: "car", years: "2009" }, { name: "Turbo", type: "car", years: "1989-1998" }] }, { slug: "bmw", name: "BMW", firstYear: 1981, lastYear: 2027, models: [{ name: "128i", type: "car", years: "2008-2014" }, { name: "135i", type: "car", years: "2008-2014" }, { name: "1M", type: "car", years: "2011" }, { name: "228", type: "car", years: "2026-2027" }, { name: "228i", type: "car", years: "2014-2018,2020-2025" }, { name: "230i", type: "car", years: "2017-2026" }, { name: "318i", type: "car", years: "1981-1985,1990-1998" }, { name: "318iC", type: "car", years: "1981-1985,1990-1996" }, { name: "318iS", type: "car", years: "1981-1985,1990-1996" }, { name: "318ti", type: "car", years: "1981-1987,1990-1996,1999-2000" }, { name: "320i", type: "car", years: "1981-1983,1987,2013-2018" }, { name: "323i", type: "car", years: "1999-2000" }, { name: "323iC", type: "car", years: "1998-2000" }, { name: "323is", type: "car", years: "1998-2000" }, { name: "325/325e", type: "car", years: "1985-1988" }, { name: "325/325eS", type: "car", years: "1986-1988" }, { name: "325Ci", type: "car", years: "2000-2006" }, { name: "325i", type: "car", years: "1987-1995,2001-2006" }, { name: "325i/325is", type: "car", years: "1989" }, { name: "325iC", type: "car", years: "1987-1995" }, { name: "325iS", type: "car", years: "1987-1988,1990-1995" }, { name: "325ix", type: "car", years: "1986,1988-1991" }, { name: "325xi", type: "car", years: "2002-2006" }, { name: "328Ci", type: "car", years: "1999-2000" }, { name: "328d", type: "car", years: "2014-2018" }, { name: "328i", type: "car", years: "1996-2000,2007-2016" }, { name: "328iC", type: "car", years: "1996-2000" }, { name: "328iS", type: "car", years: "1996-2000" }, { name: "328xi", type: "car", years: "2007-2008" }, { name: "330Ci", type: "car", years: "2001-2006" }, { name: "330e", type: "car", years: "2016-2018,2021-2024" }, { name: "330i", type: "car", years: "2001-2006,2017-2026" }, { name: "330xi", type: "car", years: "2002-2006" }, { name: "335", type: "car", years: "2014" }, { name: "335d", type: "car", years: "2009-2011" }, { name: "335i", type: "car", years: "2007-2017" }, { name: "335is", type: "car", years: "2011-2015" }, { name: "335xi", type: "car", years: "2007-2008" }, { name: "340i", type: "car", years: "2016-2019,2023-2024" }, { name: "428i", type: "car", years: "2014-2016" }, { name: "430i", type: "car", years: "2017-2027" }, { name: "435i", type: "car", years: "2014-2016" }, { name: "440i", type: "car", years: "2017-2020" }, { name: "524td", type: "car", years: "1981-1986" }, { name: "525i", type: "car", years: "1989-1995,2001-2007" }, { name: "525iA", type: "car", years: "2003" }, { name: "525xi", type: "car", years: "2006-2007" }, { name: "528e", type: "car", years: "1981-1988" }, { name: "528i", type: "car", years: "1981,1997-2000,2008-2016" }, { name: "528xi", type: "car", years: "2008,2012-2013" }, { name: "530e", type: "car", years: "2018-2023" }, { name: "530i", type: "car", years: "1994-1995,2001-2007,2017-2027" }, { name: "530iA", type: "car", years: "2003" }, { name: "530xi", type: "car", years: "2006-2007" }, { name: "533i", type: "car", years: "1981-1984" }, { name: "535d", type: "car", years: "2014-2016" }, { name: "535i", type: "car", years: "1985,1987-1993,2008-2017" }, { name: "535i/535is", type: "car", years: "1986-1988" }, { name: "535xi", type: "car", years: "2008" }, { name: "540d", type: "car", years: "2018-2019" }, { name: "540i", type: "car", years: "1994-1995,1997-2003,2017-2027" }, { name: "540iA", type: "car", years: "2003" }, { name: "545i", type: "car", years: "2004-2005" }, { name: "550e", type: "car", years: "2025-2027" }, { name: "550i", type: "car", years: "2006-2017" }, { name: "633 csi", type: "car", years: "1981-1984" }, { name: "635CSi", type: "car", years: "1981-1989" }, { name: "640i", type: "car", years: "2012-2019" }, { name: "640xi", type: "car", years: "2018-2019" }, { name: "645Ci", type: "car", years: "2004-2005" }, { name: "645i", type: "car", years: "2004" }, { name: "650i", type: "car", years: "2006-2010,2012-2019" }, { name: "650i, Alpina B6", type: "car", years: "2015-2016" }, { name: "650i, B6", type: "car", years: "2017-2019" }, { name: "650xi", type: "car", years: "2012-2015" }, { name: "730i", type: "car", years: "1994" }, { name: "733i", type: "car", years: "1981-1984" }, { name: "735i", type: "car", years: "1981-1992" }, { name: "735iL", type: "car", years: "1981-1986,1988-1992" }, { name: "740e", type: "car", years: "2017-2019" }, { name: "740i", type: "car", years: "1993-1995,1997-2001,2011-2021,2023-2027" }, { name: "740iL", type: "car", years: "1993-2001" }, { name: "740Li", type: "car", years: "2011-2015,2022" }, { name: "745e", type: "car", years: "2020-2021" }, { name: "745i", type: "car", years: "2002-2005" }, { name: "745Le", type: "car", years: "2022" }, { name: "745Li", type: "car", years: "2002-2005" }, { name: "750e", type: "car", years: "2024-2026" }, { name: "750i", type: "car", years: "2001,2006-2016,2018-2022" }, { name: "750i, Alpina B7", type: "car", years: "2012-2015" }, { name: "750i, B7", type: "car", years: "2017-2019" }, { name: "750iL", type: "car", years: "1988-1999" }, { name: "750Li", type: "car", years: "2000,2006-2015,2022" }, { name: "750Li, Alpina B7", type: "car", years: "2012-2015" }, { name: "750Lxi", type: "car", years: "2010-2011,2013-2015" }, { name: "750Lxi, Alpina B7", type: "car", years: "2012" }, { name: "750xi", type: "car", years: "2010-2011,2013-2015" }, { name: "750xi, Alpina B7", type: "car", years: "2012" }, { name: "760i", type: "car", years: "2005-2006,2023-2026" }, { name: "760Li", type: "car", years: "2003-2008,2010-2015" }, { name: "840Ci", type: "car", years: "1981-1996" }, { name: "840i", type: "car", years: "2020-2026" }, { name: "850Ci", type: "car", years: "1981-1996" }, { name: "850CSi", type: "car", years: "1981-1995" }, { name: "850i", type: "car", years: "1991-1992,2019" }, { name: "ActiveE", type: "car", years: "2012" }, { name: "ActiveHybrid 3", type: "car", years: "2014-2015" }, { name: "ActiveHybrid 5", type: "car", years: "2012-2016,2018" }, { name: "ActiveHybrid 7", type: "car", years: "2014-2015" }, { name: "Alpina", type: "car", years: "2003" }, { name: "Alpina B8", type: "car", years: "2022-2025" }, { name: "B7", type: "car", years: "2019-2022" }, { name: "i3", type: "car", years: "2014-2021" }, { name: "i4", type: "car", years: "2022-2026" }, { name: "i5", type: "car", years: "2024-2027" }, { name: "i7", type: "car", years: "2023-2027" }, { name: "i8", type: "car", years: "2014-2017,2019-2020" }, { name: "iX", type: "car", years: "2022-2027" }, { name: "L7", type: "car", years: "1981-1988" }, { name: "M2", type: "car", years: "2016-2027" }, { name: "M235", type: "car", years: "2025-2027" }, { name: "M235i", type: "car", years: "2014-2016,2020-2024" }, { name: "M240i", type: "car", years: "2017-2027" }, { name: "M3", type: "car", years: "1988-1991,1995-1999,2001-2006,2008-2013,2015-2018,2021-2027" }, { name: "M340i", type: "car", years: "2020-2026" }, { name: "M3Ci", type: "car", years: "2001-2006" }, { name: "M4", type: "car", years: "2015-2027" }, { name: "M440i", type: "car", years: "2021-2027" }, { name: "M5", type: "car", years: "1988,1991-1993,2000-2003,2006-2010,2013-2023,2025-2027" }, { name: "M550i", type: "car", years: "2018-2023" }, { name: "M6", type: "car", years: "1981-1988,2006-2010,2012-2019" }, { name: "M760i", type: "car", years: "2017-2021" }, { name: "M760Li", type: "car", years: "2022" }, { name: "M8", type: "car", years: "2020-2025" }, { name: "M850i", type: "car", years: "2020-2026" }, { name: "X1", type: "car", years: "2012-2027" }, { name: "X2", type: "car", years: "2018-2027" }, { name: "X3", type: "car", years: "2004-2027" }, { name: "X4", type: "car", years: "2015-2025" }, { name: "X5", type: "car", years: "2000-2026" }, { name: "X6", type: "car", years: "2008-2027" }, { name: "X7", type: "car", years: "2019-2027" }, { name: "XM", type: "car", years: "2023-2027" }, { name: "Z3", type: "car", years: "1996-2002" }, { name: "Z4", type: "car", years: "2003-2016,2019-2026" }, { name: "Z8", type: "car", years: "2001-2003" }] }, { slug: "bugatti", name: "BUGATTI", firstYear: 1994, lastYear: 2027, models: [{ name: "Chiron", type: "car", years: "2018-2024" }, { name: "Chiron Pur Sport", type: "car", years: "2020-2024" }, { name: "Chiron Supersport", type: "car", years: "2020-2024" }, { name: "EB110", type: "car", years: "1994-2027" }, { name: "Mistral", type: "car", years: "2025-2027" }, { name: "Veyron", type: "car", years: "2005-2017" }] }, { slug: "buick", name: "BUICK", firstYear: 1981, lastYear: 2027, models: [{ name: "Allure", type: "car", years: "2005-2009" }, { name: "Cascada", type: "car", years: "2016-2019" }, { name: "Century", type: "car", years: "1981-2005" }, { name: "Coachbuilder", type: "car", years: "1990-1996" }, { name: "Electra", type: "car", years: "1981-1990" }, { name: "Enclave", type: "car", years: "2007-2027" }, { name: "Encore", type: "car", years: "2013-2027" }, { name: "Encore GX", type: "car", years: "2020-2027" }, { name: "Envision", type: "car", years: "2016-2027" }, { name: "Envista", type: "car", years: "2024-2027" }, { name: "Incomplete", type: "car", years: "2001" }, { name: "LaCrosse", type: "car", years: "2005-2019" }, { name: "LeSabre", type: "car", years: "1981-2005" }, { name: "Lucerne", type: "car", years: "2006-2011" }, { name: "Park Avenue", type: "car", years: "1991-2005" }, { name: "Rainier", type: "car", years: "2004-2007" }, { name: "Reatta", type: "car", years: "1988-1991" }, { name: "Regal", type: "car", years: "1981-2004,2011-2020" }, { name: "Regal TourX", type: "car", years: "2018-2020" }, { name: "Rendezvous", type: "car", years: "2001-2007" }, { name: "Riviera", type: "car", years: "1981-1993,1995-1999" }, { name: "Roadmaster", type: "car", years: "1990-1996" }, { name: "Skyhawk", type: "car", years: "1981-1990" }, { name: "Skylark", type: "car", years: "1981-1998" }, { name: "Somerset", type: "car", years: "1985-1987" }, { name: "Terraza", type: "car", years: "2005-2007" }, { name: "Verano", type: "car", years: "2012-2017" }] }, { slug: "cadillac", name: "CADILLAC", firstYear: 1981, lastYear: 2027, models: [{ name: "60 Special", type: "car", years: "1991-1993" }, { name: "Allante", type: "car", years: "1987-1993" }, { name: "ATS", type: "car", years: "2013-2019" }, { name: "Brougham", type: "car", years: "1987-1992" }, { name: "Catera", type: "car", years: "1997-2001" }, { name: "Celestiq", type: "car", years: "2025-2027" }, { name: "Cimarron", type: "car", years: "1981-1988" }, { name: "Commercial Chassis", type: "car", years: "1985,1989-2001" }, { name: "CT4", type: "car", years: "2020-2027" }, { name: "CT5", type: "car", years: "2020-2027" }, { name: "CT6", type: "car", years: "2016-2020" }, { name: "CTS", type: "car", years: "2003-2019" }, { name: "Deville", type: "car", years: "1981-2005" }, { name: "DTS", type: "car", years: "2006-2011" }, { name: "Eldorado", type: "car", years: "1981-2002" }, { name: "ELR", type: "car", years: "2014-2027" }, { name: "Escalade", type: "car", years: "1999-2027" }, { name: "Escalade ESV", type: "car", years: "2017-2027" }, { name: "Escalade IQ", type: "car", years: "2025-2027" }, { name: "Escalade IQL", type: "car", years: "2026-2027" }, { name: "Fleetwood", type: "car", years: "1981-1996" }, { name: "Hearse", type: "car", years: "1997-2011" }, { name: "Limousine", type: "car", years: "1998-2011" }, { name: "Lyriq", type: "car", years: "2023-2027" }, { name: "Optiq", type: "car", years: "2025-2027" }, { name: "Seville", type: "car", years: "1981-2004" }, { name: "SRX", type: "car", years: "2004-2027" }, { name: "STS", type: "car", years: "2005-2011" }, { name: "Vistiq", type: "car", years: "2026-2027" }, { name: "XLR", type: "car", years: "2003-2009" }, { name: "XT4", type: "car", years: "2019-2027" }, { name: "XT5", type: "car", years: "2017-2027" }, { name: "XT6", type: "car", years: "2020-2027" }, { name: "XTS", type: "car", years: "2013-2019" }] }, { slug: "chevrolet", name: "CHEVROLET", firstYear: 1981, lastYear: 2027, models: [{ name: "3 ton", type: "car", years: "2001-2004" }, { name: "Alero", type: "car", years: "1999" }, { name: "Aluminum Tilt", type: "van", years: "1981-1988" }, { name: "Astro Van", type: "car", years: "1985-2005" }, { name: "Avalanche", type: "car", years: "2002-2013" }, { name: "Aveo", type: "car", years: "2004-2027" }, { name: "B7", type: "van", years: "1991-2002" }, { name: "Beretta", type: "car", years: "1985-1996" }, { name: "Blazer", type: "car", years: "1981-2005,2019-2027" }, { name: "Bolt", type: "car", years: "2027" }, { name: "Bolt EUV", type: "car", years: "2022-2023" }, { name: "Bolt EV", type: "car", years: "2017-2023" }, { name: "BrightDrop", type: "van", years: "2025-2027" }, { name: "Bus Chassis", type: "van", years: "1981-1988" }, { name: "C/K Pickup", type: "van", years: "1981-1986,2003-2006" }, { name: "C5", type: "van", years: "1981-1996,2003-2009" }, { name: "C6", type: "van", years: "1981-2009" }, { name: "C7", type: "van", years: "1981-2009" }, { name: "Camaro", type: "car", years: "1981-2002,2010-2027" }, { name: "Caprice", type: "car", years: "1981-1996" }, { name: "Caprice Police Vehicle", type: "car", years: "2011-2027" }, { name: "Captiva Sport", type: "car", years: "2010-2027" }, { name: "Cavalier", type: "car", years: "1981-2005" }, { name: "Celebrity", type: "car", years: "1984-1990" }, { name: "Chevette", type: "car", years: "1981-1987" }, { name: "Citation", type: "car", years: "1981-1985" }, { name: "City Express", type: "van", years: "2015-2018" }, { name: "Cobalt", type: "car", years: "2005-2010" }, { name: "Colorado", type: "van", years: "2004-2012,2015-2027" }, { name: "Corsica", type: "car", years: "1985-1996" }, { name: "Corvette", type: "car", years: "1981-1982,1984-2027" }, { name: "Cruze", type: "car", years: "2010-2027" }, { name: "Cruze Limited", type: "car", years: "2016" }, { name: "Cutaway Chassis", type: "van", years: "1990-1997" }, { name: "El Camino", type: "van", years: "1981-1988" }, { name: "Epica", type: "car", years: "2004-2006" }, { name: "Equinox", type: "car", years: "2005-2027" }, { name: "Express", type: "car", years: "1997-2027" }, { name: "Forward Control", type: "van", years: "1981-1990" }, { name: "G-Series", type: "car", years: "1981-1996" }, { name: "Geo Prizm", type: "car", years: "1998-2027" }, { name: "Geo Spectrum", type: "car", years: "1985-1989" }, { name: "Geo Sprint", type: "car", years: "1985-1988" }, { name: "GMT-400", type: "car", years: "1987-2002" }, { name: "Hearse/Limo", type: "car", years: "1995" }, { name: "Hearse/Limo Commercial Chassis", type: "car", years: "1985-1993" }, { name: "Heavy Conventional", type: "van", years: "1981-1988" }, { name: "HHR", type: "car", years: "2006-2011" }, { name: "Hi-Cube", type: "van", years: "1992-1994" }, { name: "Impala", type: "car", years: "1981-1985,2000-2027" }, { name: "Impala Limited", type: "car", years: "2014-2016" }, { name: "Kalos", type: "car", years: "2008" }, { name: "Lumina", type: "car", years: "1990-2001" }, { name: "Lumina APV", type: "car", years: "1990-1996" }, { name: "LUV", type: "van", years: "1981-1982" }, { name: "Malibu", type: "car", years: "1981-1983,1997-2027" }, { name: "Malibu Classic", type: "car", years: "2004-2005" }, { name: "Malibu Limited", type: "car", years: "2016" }, { name: "Matiz", type: "car", years: "2004-2006,2008,2012" }, { name: "Metro", type: "car", years: "1998-2001" }, { name: "Military Truck", type: "van", years: "1983-1987" }, { name: "Monte Carlo", type: "car", years: "1981-1988,1995-2007" }, { name: "Motorhome Chassis", type: "van", years: "1990-1999" }, { name: "Nova", type: "car", years: "1985-1988" }, { name: "Onix", type: "car", years: "2021-2027" }, { name: "Optra", type: "car", years: "2004-2009" }, { name: "Orlando", type: "car", years: "2009-2027" }, { name: "P - Series", type: "car", years: "1981-1994" }, { name: "P6S", type: "van", years: "1991-1996" }, { name: "R Conventional", type: "car", years: "1987-1991" }, { name: "S-10 Blazer", type: "van", years: "1982-1995,1999-2000" }, { name: "S-10 Pickup", type: "car", years: "1982-2005" }, { name: "S6", type: "van", years: "1989-1991" }, { name: "S7", type: "van", years: "1989-1993" }, { name: "Silverado", type: "car", years: "1999-2027" }, { name: "Silverado HD", type: "van", years: "2019-2027" }, { name: "Silverado LD", type: "van", years: "2019-2027" }, { name: "Silverado LTD", type: "van", years: "2022-2027" }, { name: "Sonic", type: "car", years: "2012-2027" }, { name: "Spark", type: "car", years: "2008,2011-2027" }, { name: "SS", type: "car", years: "2014-2027" }, { name: "SSR", type: "van", years: "2003-2006" }, { name: "Suburban", type: "car", years: "1981-2027" }, { name: "Suburban HD", type: "car", years: "2024-2027" }, { name: "Tahoe", type: "car", years: "1995-2027" }, { name: "Tracker", type: "car", years: "1995-2004,2016-2020" }, { name: "Trailblazer", type: "car", years: "2002-2009,2021-2027" }, { name: "Traverse", type: "car", years: "2009-2027" }, { name: "Traverse Limited", type: "car", years: "2024-2027" }, { name: "Trax", type: "car", years: "2013-2027" }, { name: "U100", type: "car", years: "2004-2005" }, { name: "Uplander", type: "car", years: "2005-2009" }, { name: "V Conventional", type: "car", years: "1987-1991" }, { name: "Venture", type: "car", years: "1997-2005" }, { name: "Volt", type: "car", years: "2011-2027" }] }, { slug: "chrysler", name: "CHRYSLER", firstYear: 1981, lastYear: 2027, models: [{ name: "200", type: "car", years: "2011-2017" }, { name: "300", type: "car", years: "1999-2027" }, { name: "300C", type: "car", years: "2005-2011" }, { name: "Aspen", type: "car", years: "2007-2009" }, { name: "Cirrus", type: "car", years: "1995-2000,2006" }, { name: "Concorde", type: "car", years: "1993-2004" }, { name: "Concorde/LHS", type: "car", years: "1995" }, { name: "Conquest", type: "car", years: "1987-1989" }, { name: "Cordoba", type: "car", years: "1981-1983" }, { name: "Crossfire", type: "car", years: "2004-2008" }, { name: "Daytona", type: "car", years: "1984-1993" }, { name: "Dynasty", type: "car", years: "1981-1986,1989-1993" }, { name: "E-CLASS", type: "car", years: "1981-1984" }, { name: "EXECUTIVE", type: "car", years: "1981-1984" }, { name: "FIFTH AVENUE", type: "car", years: "1984-1989" }, { name: "Grand Caravan", type: "car", years: "2021-2027" }, { name: "Grand Voyager", type: "car", years: "2000" }, { name: "Imperial", type: "car", years: "1981-1983,1990-1993" }, { name: "Intrepid", type: "car", years: "1993-2003" }, { name: "Laser", type: "car", years: "1981-1986" }, { name: "LeBaron", type: "car", years: "1981-1995" }, { name: "LHS", type: "car", years: "1994-1997,1999-2001" }, { name: "Neon", type: "car", years: "1995-2002" }, { name: "New Yorker", type: "car", years: "1981-1997" }, { name: "NEWPORT", type: "car", years: "1981-1988" }, { name: "Pacifica", type: "car", years: "2004-2009,2017-2027" }, { name: "Prowler", type: "car", years: "2001-2002" }, { name: "PT Cruiser", type: "car", years: "1995-2010" }, { name: "SALON", type: "car", years: "1981,1983-1988,1990" }, { name: "Sebring", type: "car", years: "1995-2010" }, { name: "Shadow", type: "car", years: "1987-1988,1991-1994" }, { name: "Stratus", type: "car", years: "1984-1986,1995-1997" }, { name: "TC", type: "car", years: "1989-1991" }, { name: "Town and Country", type: "car", years: "1990-2016" }, { name: "Viper", type: "car", years: "1984-1988,1991-1997" }, { name: "Vision", type: "car", years: "1984-1988,1991-1997" }, { name: "Voyager", type: "car", years: "1995-2003,2008-2009,2020-2026" }] }, { slug: "daewoo", name: "DAEWOO", firstYear: 1997, lastYear: 2008, models: [{ name: "G2X", type: "car", years: "2008" }, { name: "Laganza V-car", type: "car", years: "2003-2007" }, { name: "LANOS", type: "car", years: "1997-2002" }, { name: "LEGANZA", type: "car", years: "1997-2002" }, { name: "Leganza V-200 & variants/derivatives", type: "car", years: "2003-2007" }, { name: "NUBIRA", type: "car", years: "1997-2002" }] }, { slug: "daihatsu", name: "DAIHATSU", firstYear: 1985, lastYear: 2027, models: [{ name: "Charade", type: "car", years: "1985-2027" }, { name: "Rocky", type: "car", years: "1989-2027" }] }, { slug: "daimler", name: "DAIMLER", firstYear: 2019, lastYear: 2027, models: [{ name: "DS", type: "van", years: "2019-2027" }, { name: "DT", type: "van", years: "2019-2027" }] }, { slug: "datsun", name: "DATSUN", firstYear: 1981, lastYear: 1983, models: [{ name: "210", type: "car", years: "1981-1982" }, { name: "280ZX", type: "car", years: "1981-1983" }, { name: "310", type: "car", years: "1981-1982" }, { name: "510", type: "car", years: "1981" }] }, { slug: "delorean", name: "DELOREAN", firstYear: 1981, lastYear: 1986, models: [{ name: "DMC-12", type: "car", years: "1981-1986" }] }, { slug: "dodge", name: "DODGE", firstYear: 1981, lastYear: 2027, models: [{ name: "400", type: "car", years: "1981-1983" }, { name: "600", type: "car", years: "1981-1988" }, { name: "ARIES", type: "car", years: "1981-1989" }, { name: "Avenger", type: "car", years: "1995-2000,2007-2014" }, { name: "Caliber", type: "car", years: "2006-2012" }, { name: "Caravan", type: "car", years: "1984-1995,2002,2004" }, { name: "Caravan/Grand Caravan", type: "car", years: "1995-2001,2003,2005-2008" }, { name: "Challenger", type: "car", years: "1981-1983,2008-2027" }, { name: "Charger", type: "car", years: "1983-1987,2006-2027" }, { name: "Colt", type: "car", years: "1981-1983,1985-1995" }, { name: "Conquest", type: "car", years: "1981-1983,1985-1988" }, { name: "D-Series", type: "car", years: "1981-1993" }, { name: "D50", type: "van", years: "1981-1986" }, { name: "Dakota", type: "car", years: "1987-2012" }, { name: "Dart", type: "car", years: "2013-2016" }, { name: "Daytona", type: "car", years: "1984-1993" }, { name: "DIPLOMAT", type: "car", years: "1981-1989" }, { name: "Durango", type: "car", years: "1995-2009,2011-2027" }, { name: "Dynasty", type: "car", years: "1981-1993" }, { name: "Grand Caravan", type: "car", years: "1988-1994,2002,2004,2009-2023" }, { name: "Hornet", type: "car", years: "2023-2027" }, { name: "Intrepid", type: "car", years: "1993-2004" }, { name: "Journey", type: "car", years: "2009-2023" }, { name: "LANCER", type: "car", years: "1981,1984-1989" }, { name: "Magnum", type: "car", years: "2005-2008" }, { name: "Mini Ram", type: "car", years: "1984-1988" }, { name: "Mirada", type: "car", years: "1981-1983" }, { name: "Monaco", type: "car", years: "1981-1988,1990-1992" }, { name: "Neon", type: "car", years: "1994-2005" }, { name: "Nitro", type: "car", years: "2007-2012" }, { name: "OMNI", type: "car", years: "1981-1990" }, { name: "Raider", type: "car", years: "1985-1989" }, { name: "Ram", type: "car", years: "1994-2012" }, { name: "RAM 50", type: "van", years: "1987-1993" }, { name: "Ram Chassis Cab", type: "car", years: "1981-2002,2007-2012" }, { name: "Ram Van", type: "car", years: "1981-2003" }, { name: "Ram Wagon", type: "car", years: "1981-2003" }, { name: "Ramcharger", type: "car", years: "1981-1993,1996-1997" }, { name: "Rampage", type: "van", years: "1982-1984" }, { name: "RD200 / RD250", type: "van", years: "1981" }, { name: "Royal Mini Ram Van", type: "van", years: "1984-1987" }, { name: "Shadow", type: "car", years: "1987-1994" }, { name: "Shelby Charger", type: "car", years: "1983-1988" }, { name: "Spirit", type: "car", years: "1989-1995" }, { name: "Sprinter", type: "car", years: "2005-2009" }, { name: "ST.REGIS", type: "car", years: "1981" }, { name: "Stealth", type: "car", years: "1991-1996" }, { name: "Stratus", type: "car", years: "1995-2006" }, { name: "Viper", type: "car", years: "1992-2006,2008-2010,2013-2017" }, { name: "W-Series", type: "car", years: "1981-1993" }] }, { slug: "ferrari", name: "FERRARI", firstYear: 1981, lastYear: 2027, models: [{ name: "12Cilindri", type: "car", years: "2025-2027" }, { name: "296", type: "car", years: "2022-2026" }, { name: "296 Speciale", type: "car", years: "2026-2027" }, { name: "296 Speciale A", type: "car", years: "2026-2027" }, { name: "3.2 Mondial", type: "car", years: "1985-1989" }, { name: "308 Convertible", type: "car", years: "1985" }, { name: "308GTB", type: "car", years: "1981" }, { name: "308GTB Quattrovalvole", type: "car", years: "1985" }, { name: "308GTBi", type: "car", years: "1981-1984" }, { name: "308GTS", type: "car", years: "1981" }, { name: "308GTS Quattrovalvole", type: "car", years: "1985" }, { name: "308GTSi", type: "car", years: "1981-1984" }, { name: "328", type: "car", years: "1986-1989" }, { name: "328 GTB", type: "car", years: "1986-1989" }, { name: "328 GTS", type: "car", years: "1986-1989" }, { name: "348 Spider", type: "car", years: "1994-1995" }, { name: "348 tb", type: "car", years: "1990-1995" }, { name: "348 ts", type: "car", years: "1990-1995" }, { name: "355 Berlinetta", type: "car", years: "1995,1997" }, { name: "355 GTS", type: "car", years: "1995,1997" }, { name: "355 Spider", type: "car", years: "1995,1997" }, { name: "360", type: "car", years: "2000-2005" }, { name: "430", type: "car", years: "2007-2009" }, { name: "456", type: "car", years: "1995-1999" }, { name: "456M", type: "car", years: "2000-2003" }, { name: "458", type: "car", years: "2010-2017" }, { name: "458 Italia", type: "car", years: "2010-2017" }, { name: "488", type: "car", years: "2016-2020" }, { name: "512 TR", type: "car", years: "1993-1995" }, { name: "550 Barchetta", type: "car", years: "2001" }, { name: "550 Maranello", type: "car", years: "1997-2001" }, { name: "575M Maranello", type: "car", years: "2002-2005" }, { name: "599", type: "car", years: "2006,2010-2011" }, { name: "599 GTB Fiorano", type: "car", years: "2007-2011" }, { name: "612 Scaglietti", type: "car", years: "2005-2011" }, { name: "812", type: "car", years: "2017-2024" }, { name: "849 Testarossa", type: "car", years: "2026-2027" }, { name: "Amalfi", type: "car", years: "2027" }, { name: "California", type: "car", years: "2010-2014" }, { name: "California T", type: "car", years: "2010-2018" }, { name: "Challenge Stradale", type: "car", years: "2004" }, { name: "Daytona SP3", type: "car", years: "2023-2025" }, { name: "Enzo", type: "car", years: "2003" }, { name: "F12 Berlinetta", type: "car", years: "2010-2017" }, { name: "F12 Special Series", type: "car", years: "2016" }, { name: "F12 tdf (Tour de France)", type: "car", years: "2017" }, { name: "F355", type: "car", years: "1996,1998-1999" }, { name: "F40", type: "car", years: "1991-1992" }, { name: "F430", type: "car", years: "2006-2009" }, { name: "F50", type: "car", years: "1996" }, { name: "F60 America", type: "car", years: "2016" }, { name: "F8", type: "car", years: "2020-2023" }, { name: "F80", type: "car", years: "2026-2027" }, { name: "FF", type: "car", years: "2010-2016" }, { name: "GTC4Lusso", type: "car", years: "2017-2020" }, { name: "La Ferrari", type: "car", years: "2010-2017" }, { name: "Luce", type: "car", years: "2027" }, { name: "Mondial 8", type: "car", years: "1981-1985" }, { name: "Mondial T", type: "car", years: "1986-1994" }, { name: "Monza SP1/SP2", type: "car", years: "2023" }, { name: "Portofino", type: "car", years: "2019-2021" }, { name: "Portofino M", type: "car", years: "2021-2023" }, { name: "Purosangue", type: "car", years: "2023-2027" }, { name: "Roma", type: "car", years: "2021-2026" }, { name: "SF90", type: "car", years: "2021-2025" }, { name: "Testarossa", type: "car", years: "1985-1992" }] }, { slug: "fiat", name: "FIAT", firstYear: 1981, lastYear: 2027, models: [{ name: "124 Spider", type: "car", years: "2017-2027" }, { name: "500", type: "car", years: "2012-2019" }, { name: "500e", type: "car", years: "2024-2027" }, { name: "500L", type: "car", years: "2014-2020" }, { name: "500X", type: "car", years: "2016-2027" }, { name: "Brava", type: "car", years: "1981-1982" }, { name: "Ducato", type: "car", years: "2019-2023" }, { name: "Freemont", type: "car", years: "2011-2016" }, { name: "Spider 2000", type: "car", years: "1981-1982" }, { name: "Strada", type: "car", years: "1981-1982" }, { name: "X 1/9", type: "car", years: "1981-1982" }] }, { slug: "fisker", name: "FISKER", firstYear: 2011, lastYear: 2027, models: [{ name: "Karma", type: "car", years: "2011-2027" }, { name: "Nina", type: "car", years: "2011-2027" }, { name: "Ocean", type: "car", years: "2023-2027" }] }, { slug: "ford", name: "FORD", firstYear: 1981, lastYear: 2027, models: [{ name: "'34", type: "car", years: "1985-2027" }, { name: "A8513", type: "car", years: "1990-1998" }, { name: "A9513", type: "car", years: "1981-1998" }, { name: "A9522", type: "car", years: "1988-1998" }, { name: "Aerostar", type: "car", years: "1984-1997" }, { name: "Aspire", type: "car", years: "1994-1997" }, { name: "AT8513", type: "car", years: "1981-1998" }, { name: "AT9513", type: "car", years: "1981-1998" }, { name: "AT9522", type: "car", years: "1981-1998" }, { name: "B-750", type: "van", years: "2002" }, { name: "B600", type: "car", years: "1981-1994" }, { name: "B6000", type: "car", years: "1986" }, { name: "B700", type: "car", years: "1981-1994" }, { name: "B7000", type: "car", years: "1981-1987" }, { name: "B800", type: "car", years: "1995-1997" }, { name: "Bronco", type: "car", years: "1981-1996,2021-2027" }, { name: "Bronco II", type: "car", years: "1983-1990" }, { name: "Bronco Sport", type: "car", years: "2021-2027" }, { name: "C-Max", type: "car", years: "2013-2018" }, { name: "C600", type: "car", years: "1981-1986" }, { name: "C700", type: "car", years: "1981-1986" }, { name: "C7000", type: "car", years: "1981-1987" }, { name: "C800", type: "car", years: "1981-1990" }, { name: "C8000", type: "car", years: "1981-1990" }, { name: "CF6000", type: "car", years: "1981-1990" }, { name: "CF7000", type: "car", years: "1981-1996" }, { name: "CF8000", type: "car", years: "1981-1997" }, { name: "CFT8000", type: "car", years: "1981-1997" }, { name: "CL9000", type: "car", years: "1981-1992" }, { name: "CLT9000", type: "car", years: "1981-1990" }, { name: "Contour", type: "car", years: "1995-2000" }, { name: "Courier", type: "van", years: "1981-1988" }, { name: "Crown Victoria", type: "car", years: "1987-2011" }, { name: "CT800", type: "car", years: "1981-1983" }, { name: "CT8000", type: "car", years: "1981-1990" }, { name: "E-100", type: "car", years: "1981-1983" }, { name: "E-150", type: "car", years: "1981-2014" }, { name: "E-250", type: "car", years: "1981-2014" }, { name: "E-350", type: "car", years: "1981-2027" }, { name: "E-450", type: "car", years: "1995-2027" }, { name: "E-550", type: "car", years: "2002-2003,2015" }, { name: "Ecosport", type: "car", years: "2018-2027" }, { name: "Edge", type: "car", years: "2007-2027" }, { name: "Escape", type: "car", years: "2001-2027" }, { name: "Escort", type: "car", years: "1981-2002" }, { name: "Excursion", type: "car", years: "2000-2005" }, { name: "Expedition", type: "car", years: "1997-2027" }, { name: "Expedition EL", type: "car", years: "2017" }, { name: "Expedition MAX", type: "car", years: "2007-2009,2015-2016,2018-2027" }, { name: "Explorer", type: "car", years: "1991-2027" }, { name: "Explorer Sport", type: "car", years: "2003" }, { name: "Explorer Sport Trac", type: "car", years: "2001-2005,2007-2010" }, { name: "F-100", type: "car", years: "1981-1983" }, { name: "F-150", type: "car", years: "1981-2027" }, { name: "F-150 Heritage", type: "van", years: "2004" }, { name: "F-250", type: "car", years: "1981-2027" }, { name: "F-350", type: "car", years: "1981-1997,1999-2027" }, { name: "F-450", type: "car", years: "1999-2027" }, { name: "F-550", type: "car", years: "1999-2027" }, { name: "F-590", type: "car", years: "1981-1994" }, { name: "F-600", type: "car", years: "1981-1994,2020-2027" }, { name: "F-650", type: "van", years: "2000-2027" }, { name: "F-700", type: "car", years: "1981-1998" }, { name: "F-750", type: "van", years: "2000-2027" }, { name: "F-800", type: "car", years: "1981-2002" }, { name: "F-Super Duty", type: "car", years: "1981-1997" }, { name: "F6000", type: "car", years: "1981-1985" }, { name: "F7000", type: "car", years: "1981-1987" }, { name: "F8000", type: "car", years: "1981-1987" }, { name: "Fairmont", type: "car", years: "1981-1983" }, { name: "Festiva", type: "car", years: "1988-1994" }, { name: "Fiesta", type: "car", years: "2011-2027" }, { name: "Five Hundred", type: "car", years: "2005-2007" }, { name: "Flex", type: "car", years: "2009-2027" }, { name: "Focus", type: "car", years: "2000-2027" }, { name: "Freestar", type: "car", years: "2004-2007" }, { name: "Freestyle", type: "car", years: "2005-2007" }, { name: "FT800", type: "car", years: "1981-1990" }, { name: "FT8000", type: "car", years: "1981-1987" }, { name: "FT900", type: "car", years: "1981-1998" }, { name: "Fusion", type: "car", years: "2006-2020" }, { name: "Granada", type: "car", years: "1981-1982" }, { name: "GT", type: "car", years: "2004-2006,2017-2022" }, { name: "GT MKII", type: "car", years: "2023-2027" }, { name: "L800", type: "car", years: "1981-1984" }, { name: "L8000", type: "car", years: "1981-1997" }, { name: "L8501", type: "car", years: "1997-1998" }, { name: "L8511", type: "car", years: "1998" }, { name: "L8513", type: "car", years: "1990-1998" }, { name: "L9000", type: "car", years: "1981-1997" }, { name: "L9501", type: "car", years: "1997-1998" }, { name: "L9511", type: "car", years: "1998" }, { name: "L9513", type: "car", years: "1981-1998" }, { name: "L9522", type: "car", years: "1998" }, { name: "LA8000", type: "car", years: "1981-1997" }, { name: "LA9000", type: "car", years: "1981-1997" }, { name: "Laser", type: "car", years: "1981-1987" }, { name: "LL9000", type: "car", years: "1981-1997" }, { name: "LLA9000", type: "car", years: "1981-1997" }, { name: "LLS9000", type: "car", years: "1981-1997" }, { name: "LN600", type: "car", years: "1981-1985" }, { name: "LN700", type: "car", years: "1981-1986" }, { name: "LN7000", type: "car", years: "1981-1997" }, { name: "LN800", type: "car", years: "1981-1984" }, { name: "LN8000", type: "car", years: "1981-1997" }, { name: "LN9000", type: "car", years: "1981-1997" }, { name: "LNT800", type: "car", years: "1981-1984" }, { name: "LNT8000", type: "car", years: "1981-1997" }, { name: "LNT9000", type: "car", years: "1981-1997" }, { name: "LS8000", type: "car", years: "1981-1997" }, { name: "LS9000", type: "car", years: "1981-1997" }, { name: "LT800", type: "car", years: "1981-1984" }, { name: "LT8000", type: "car", years: "1981-1997" }, { name: "LT8501", type: "car", years: "1981-1998" }, { name: "LT8511", type: "car", years: "1998" }, { name: "LT8513", type: "car", years: "1981-1998" }, { name: "LT9000", type: "car", years: "1981-1997" }, { name: "LT9501", type: "car", years: "1981-1998" }, { name: "LT9511", type: "car", years: "1998" }, { name: "LT9513", type: "car", years: "1981-1998" }, { name: "LT9522", type: "car", years: "1981-1998" }, { name: "LTA9000", type: "car", years: "1981-1997" }, { name: "LTD", type: "car", years: "1981-1986" }, { name: "LTL9000", type: "car", years: "1981-1997" }, { name: "LTLA9000", type: "car", years: "1981-1997" }, { name: "LTLS9000", type: "car", years: "1981-1997" }, { name: "LTS8000", type: "car", years: "1981-1997" }, { name: "LTS9000", type: "car", years: "1981-1997" }, { name: "Maverick", type: "van", years: "2022-2027" }, { name: "Motorhome Chassis", type: "car", years: "1999-2002,2004,2006-2027" }, { name: "Mustang", type: "car", years: "1981-2027" }, { name: "Mustang GTD", type: "car", years: "2025-2027" }, { name: "Mustang Mach-E", type: "car", years: "2021-2027" }, { name: "P600", type: "car", years: "1981-1994" }, { name: "P700", type: "car", years: "1995-1997" }, { name: "P800", type: "car", years: "1995-1997" }, { name: "Probe", type: "car", years: "1988-1997" }, { name: "Ranger", type: "car", years: "1982-2011,2019-2027" }, { name: "Recreational Vehicle", type: "car", years: "1981-1994" }, { name: "Taurus", type: "car", years: "1986-2019" }, { name: "Taurus X", type: "car", years: "2008-2009" }, { name: "Tempo", type: "car", years: "1984-1994" }, { name: "Thunderbird", type: "car", years: "1981-1997,2002-2005" }, { name: "Transit", type: "car", years: "2015-2027" }, { name: "Transit Connect", type: "van", years: "2010-2027" }, { name: "Windstar", type: "car", years: "1995-2003" }, { name: "ZX2", type: "car", years: "1999-2003" }] }, { slug: "geo", name: "GEO", firstYear: 1985, lastYear: 1997, models: [{ name: "Metro", type: "car", years: "1989-1997" }, { name: "Prizm", type: "car", years: "1989-1997" }, { name: "Spectrum", type: "car", years: "1989" }, { name: "Sprint", type: "car", years: "1989-1993" }, { name: "Storm", type: "car", years: "1985-1993" }, { name: "Tracker", type: "car", years: "1990-1994" }] }, { slug: "gmc", name: "GMC", firstYear: 1981, lastYear: 2027, models: [{ name: "Acadia", type: "car", years: "2007-2027" }, { name: "Aluminum Tilt", type: "van", years: "1981-1988" }, { name: "Bus Chassis", type: "van", years: "1981-1988" }, { name: "C/K Pickup", type: "car", years: "1981-1986" }, { name: "C5", type: "van", years: "1981-1996,2003-2009" }, { name: "C6", type: "van", years: "1981-2009" }, { name: "C7", type: "van", years: "1981-2009" }, { name: "Caballero", type: "van", years: "1981-1987" }, { name: "Canyon", type: "car", years: "2004-2027" }, { name: "Cruise Origin AV", type: "car", years: "2024-2027" }, { name: "Electric Vehicle", type: "car", years: "1997-2000" }, { name: "Envoy", type: "car", years: "2002-2009" }, { name: "Forward Control", type: "van", years: "1981-1990" }, { name: "Geo Tracker", type: "van", years: "1989-1990" }, { name: "GMT-400", type: "car", years: "1987-1988" }, { name: "Heavy Conventional", type: "van", years: "1981-1988" }, { name: "Hi-Cube", type: "car", years: "1981-1994" }, { name: "Hummer EV Pickup", type: "van", years: "2022-2027" }, { name: "Hummer EV SUV", type: "car", years: "2024-2027" }, { name: "Jimmy", type: "car", years: "1987-1991" }, { name: "Jimmy Utility", type: "car", years: "1981-1986,1995-2005" }, { name: "Magna Van", type: "van", years: "1990-1993" }, { name: "Motorhome Chassis", type: "car", years: "1981-1999" }, { name: "P Truck Forward", type: "car", years: "1981-1999" }, { name: "R Conventional", type: "car", years: "1987-1991" }, { name: "Rally", type: "car", years: "1981-1996" }, { name: "S15 Pickup", type: "van", years: "1982-1990" }, { name: "S15 Utility", type: "car", years: "1981-1994" }, { name: "S6", type: "van", years: "1989-1991" }, { name: "Safari", type: "car", years: "1985-2005" }, { name: "Savana", type: "car", years: "1996-2027" }, { name: "Sierra", type: "car", years: "1989-2027" }, { name: "Sierra HD", type: "van", years: "2019,2022-2027" }, { name: "Sierra Limited", type: "van", years: "2019-2027" }, { name: "Sonoma", type: "car", years: "1991-2004" }, { name: "Suburban", type: "car", years: "1981-2000" }, { name: "Terrain", type: "car", years: "2009-2027" }, { name: "V Conventional", type: "car", years: "1987-1991" }, { name: "Value Van", type: "van", years: "1981-1993" }, { name: "Vandura", type: "van", years: "1981-1996" }, { name: "Yukon", type: "car", years: "1992-2027" }, { name: "Yukon XL", type: "car", years: "1995,2000-2011,2015-2027" }] }, { slug: "honda", name: "HONDA", firstYear: 1981, lastYear: 2027, models: [{ name: "Accord", type: "car", years: "1981-2027" }, { name: "Accord Crosstour", type: "car", years: "2010-2011" }, { name: "Civic", type: "car", years: "1981-1983,1985-2027" }, { name: "Civic Si", type: "car", years: "1990,2022-2027" }, { name: "Civic Type R", type: "car", years: "2017-2021,2023-2027" }, { name: "Clarity", type: "car", years: "2017-2021" }, { name: "CR-V", type: "car", years: "1997-2027" }, { name: "CR-Z", type: "car", years: "2011-2016" }, { name: "Crosstour", type: "car", years: "2012-2015" }, { name: "del Sol", type: "car", years: "1994-1997" }, { name: "Element", type: "car", years: "2003-2011" }, { name: "EV Plus", type: "car", years: "1997-1999" }, { name: "FCX Clarity", type: "car", years: "2004-2014" }, { name: "Fit", type: "car", years: "2007-2020" }, { name: "HR-V", type: "car", years: "2016-2027" }, { name: "Insight", type: "car", years: "2000-2014,2019-2022" }, { name: "Odyssey", type: "car", years: "1995-2027" }, { name: "Passport", type: "car", years: "1994-2002,2019-2027" }, { name: "Pilot", type: "car", years: "2003-2027" }, { name: "Prelude", type: "car", years: "1981-2001,2026-2027" }, { name: "Prologue", type: "car", years: "2024-2027" }, { name: "Ridgeline", type: "van", years: "2006-2027" }, { name: "S2000", type: "car", years: "2000-2009" }] }, { slug: "hummer", name: "HUMMER", firstYear: 1991, lastYear: 2011, models: [{ name: "H1", type: "car", years: "1991-2006" }, { name: "H2", type: "car", years: "2003-2011" }, { name: "H3", type: "car", years: "2006-2011" }, { name: "H3T", type: "van", years: "2009" }] }, { slug: "hyundai", name: "HYUNDAI", firstYear: 1986, lastYear: 2027, models: [{ name: "Accent", type: "car", years: "1995-2027" }, { name: "Azera", type: "car", years: "2006-2018" }, { name: "Elantra", type: "car", years: "1992-2027" }, { name: "Elantra GT", type: "car", years: "2017-2020" }, { name: "Elantra N", type: "car", years: "2022-2027" }, { name: "Elantra Touring", type: "car", years: "2010" }, { name: "Entourage", type: "car", years: "2006-2014" }, { name: "Equus", type: "car", years: "2011-2016" }, { name: "Excel", type: "car", years: "1986-1994" }, { name: "Genesis", type: "car", years: "2009-2016" }, { name: "Genesis Coupe", type: "car", years: "2010-2016" }, { name: "Ioniq", type: "car", years: "2017-2022" }, { name: "Ioniq 5", type: "car", years: "2022-2027" }, { name: "Ioniq 5 N", type: "car", years: "2025-2027" }, { name: "Ioniq 6", type: "car", years: "2023-2027" }, { name: "Ioniq 6 N", type: "car", years: "2026-2027" }, { name: "Ioniq 9", type: "car", years: "2026-2027" }, { name: "Kona", type: "car", years: "2018-2027" }, { name: "Kona N", type: "car", years: "2022-2027" }, { name: "Nexo", type: "car", years: "2019-2027" }, { name: "Palisade", type: "car", years: "2020-2027" }, { name: "Pony", type: "car", years: "1986-1989" }, { name: "Santa Cruz", type: "van", years: "2022-2027" }, { name: "Santa Fe", type: "car", years: "2001-2027" }, { name: "Santa Fe Sport", type: "car", years: "2013-2018" }, { name: "Santa Fe XL", type: "car", years: "2019-2027" }, { name: "Scoupe", type: "car", years: "1991-1995" }, { name: "Sonata", type: "car", years: "1989-2027" }, { name: "Stellar", type: "car", years: "1986-1989" }, { name: "Tiburon", type: "car", years: "1997-2008" }, { name: "Tucson", type: "car", years: "2005-2027" }, { name: "Veloster", type: "car", years: "2012-2021" }, { name: "Veloster N", type: "car", years: "2019-2022" }, { name: "Venue", type: "car", years: "2020-2027" }, { name: "Veracruz", type: "car", years: "2007-2013" }, { name: "Xcient", type: "van", years: "2023-2027" }, { name: "XG300", type: "car", years: "2001" }, { name: "XG350", type: "car", years: "2002-2005" }] }, { slug: "infiniti", name: "INFINITI", firstYear: 1990, lastYear: 2027, models: [{ name: "EX35", type: "car", years: "2008-2013" }, { name: "FX35", type: "car", years: "2003-2010,2012" }, { name: "FX37", type: "car", years: "2013" }, { name: "FX45", type: "car", years: "2003-2008" }, { name: "FX50", type: "car", years: "2009-2013" }, { name: "G20", type: "car", years: "1991-1996,1999-2002" }, { name: "G25", type: "car", years: "2011-2012" }, { name: "G35", type: "car", years: "2003-2009" }, { name: "G37", type: "car", years: "2008-2013" }, { name: "I30", type: "car", years: "1996-2001" }, { name: "I35", type: "car", years: "2002-2004" }, { name: "J30", type: "car", years: "1993-1997" }, { name: "JX35", type: "car", years: "2013" }, { name: "M30", type: "car", years: "1990-1992" }, { name: "M35", type: "car", years: "2006-2010" }, { name: "M35h", type: "car", years: "2012-2013" }, { name: "M37", type: "car", years: "2011-2013" }, { name: "M45", type: "car", years: "2003-2004,2006-2010" }, { name: "M56", type: "car", years: "2011-2013" }, { name: "Q40", type: "car", years: "2015-2016" }, { name: "Q45", type: "car", years: "1990-2007" }, { name: "Q50", type: "car", years: "2014-2027" }, { name: "Q60", type: "car", years: "2014-2015,2017-2022" }, { name: "Q70", type: "car", years: "2014-2022" }, { name: "Q70L", type: "car", years: "2015-2022" }, { name: "QX30", type: "car", years: "2017-2019" }, { name: "QX4", type: "car", years: "1997-2003" }, { name: "QX50", type: "car", years: "2014-2017,2019-2027" }, { name: "QX55", type: "car", years: "2022-2027" }, { name: "QX56", type: "car", years: "2003-2013" }, { name: "QX60", type: "car", years: "2014-2027" }, { name: "QX65", type: "car", years: "2027" }, { name: "QX70", type: "car", years: "2014-2018" }, { name: "QX80", type: "car", years: "2014-2027" }] }, { slug: "isuzu", name: "ISUZU", firstYear: 1981, lastYear: 2027, models: [{ name: "Amigo", type: "car", years: "1989-1994" }, { name: "Ascender", type: "car", years: "2003-2008" }, { name: "Axiom", type: "car", years: "2002-2004" }, { name: "F6", type: "van", years: "1997-2002" }, { name: "F7", type: "van", years: "1997-2002" }, { name: "FRR", type: "van", years: "1995-1998,2000-2004" }, { name: "FSR", type: "van", years: "1989-1996" }, { name: "FTR/FVR", type: "van", years: "1996" }, { name: "FTR/FVR/EVR", type: "van", years: "1989-1995" }, { name: "H-Series", type: "van", years: "2005-2008" }, { name: "Hombre", type: "van", years: "1996-2000" }, { name: "i-280", type: "van", years: "2006" }, { name: "i-290", type: "van", years: "2007-2008" }, { name: "i-350", type: "van", years: "2006" }, { name: "i-370", type: "van", years: "2007-2008" }, { name: "I-Mark", type: "car", years: "1981-1989" }, { name: "IMPULSE", type: "car", years: "1981-1992" }, { name: "NPR", type: "van", years: "1987,1989-1999,2006-2010,2016-2020,2022-2024,2027" }, { name: "NPR/NPR-HD", type: "van", years: "2000-2005,2009-2019,2021,2025-2027" }, { name: "NQR", type: "van", years: "1999-2004,2016-2027" }, { name: "NQR/NRR", type: "van", years: "2005-2015" }, { name: "NRR", type: "van", years: "1989-1994,2016-2027" }, { name: "Oasis", type: "car", years: "1996-1999" }, { name: "Pickup", type: "car", years: "1981-1995" }, { name: "Rodeo", type: "car", years: "1989-1997,1999-2004" }, { name: "Rodeo/Amigo", type: "car", years: "1998-1999" }, { name: "Stylus", type: "car", years: "1987-1992" }, { name: "T6F", type: "van", years: "2003-2010" }, { name: "T7F", type: "van", years: "2003-2010" }, { name: "T8F", type: "van", years: "2003-2010" }, { name: "Trooper", type: "car", years: "1984-2002" }, { name: "Trooper II", type: "car", years: "1987-1991" }, { name: "VehiCross", type: "car", years: "1999-2002" }] }, { slug: "jaguar", name: "JAGUAR", firstYear: 1981, lastYear: 2027, models: [{ name: "E-PACE", type: "car", years: "2018-2024" }, { name: "F-PACE", type: "car", years: "2017-2027" }, { name: "F-TYPE", type: "car", years: "2014-2024" }, { name: "I-PACE", type: "car", years: "2019-2024" }, { name: "S-Type", type: "car", years: "2000-2008" }, { name: "Vanden Plas", type: "car", years: "1988-2004" }, { name: "X-Type", type: "car", years: "2002-2008" }, { name: "XE", type: "car", years: "2017-2021" }, { name: "XF", type: "car", years: "2009-2024" }, { name: "XJ", type: "car", years: "2002-2019" }, { name: "XJ12", type: "car", years: "1991-1997" }, { name: "XJ6", type: "car", years: "1981-1997" }, { name: "XJ8", type: "car", years: "1998-2003" }, { name: "XJR", type: "car", years: "1995-2007" }, { name: "XJS", type: "car", years: "1981-1997" }, { name: "XK", type: "car", years: "2000-2015" }, { name: "XK8", type: "car", years: "1997-2004" }] }, { slug: "jeep", name: "JEEP", firstYear: 1981, lastYear: 2027, models: [{ name: "Cherokee", type: "car", years: "1981-2011,2014-2023,2026-2027" }, { name: "CJ-5", type: "car", years: "1981-1983" }, { name: "CJ-6", type: "car", years: "1981-1982" }, { name: "CJ-7", type: "car", years: "1981-1986" }, { name: "CJ-8 Scrambler", type: "car", years: "1981-1985" }, { name: "Comanche", type: "car", years: "1986-1992" }, { name: "Commander", type: "car", years: "2006-2010" }, { name: "Compass", type: "car", years: "2006-2027" }, { name: "Gladiator", type: "van", years: "2020-2027" }, { name: "Grand Cherokee", type: "car", years: "1993-2027" }, { name: "Grand Cherokee L", type: "car", years: "2021-2027" }, { name: "Grand Wagoneer", type: "car", years: "1984-1993,2022-2027" }, { name: "Grand Wagoneer L", type: "car", years: "2024-2027" }, { name: "J-10", type: "car", years: "1981-1988" }, { name: "J-20", type: "car", years: "1981-1988" }, { name: "Liberty", type: "car", years: "1993-2013" }, { name: "Patriot", type: "car", years: "2007-2018" }, { name: "Recon", type: "car", years: "2026-2027" }, { name: "Renegade", type: "car", years: "2015-2027" }, { name: "Wagoneer", type: "car", years: "1981-1990,2022-2025" }, { name: "Wagoneer L", type: "car", years: "2024-2025" }, { name: "Wagoneer S", type: "car", years: "2024-2027" }, { name: "Wrangler", type: "car", years: "1986-2027" }, { name: "Wrangler JK", type: "car", years: "2018" }] }, { slug: "karma", name: "KARMA", firstYear: 2015, lastYear: 2027, models: [{ name: "Atlantic", type: "car", years: "2015-2016" }, { name: "GS-6", type: "car", years: "2021-2027" }, { name: "Gyesera", type: "car", years: "2025-2027" }, { name: "Karma", type: "car", years: "2015" }, { name: "Kaveya", type: "car", years: "2025-2027" }, { name: "Revero", type: "car", years: "2016-2020,2025-2027" }, { name: "Revero GT", type: "car", years: "2021-2024" }] }, { slug: "kia", name: "KIA", firstYear: 1993, lastYear: 2027, models: [{ name: "Amanti", type: "car", years: "2004-2009" }, { name: "Borrego", type: "car", years: "2009-2011" }, { name: "Cadenza", type: "car", years: "2014-2020" }, { name: "Carnival", type: "car", years: "2022-2027" }, { name: "EV3", type: "car", years: "2027" }, { name: "EV6", type: "car", years: "2022-2027" }, { name: "EV9", type: "car", years: "2024-2027" }, { name: "Forte", type: "car", years: "2010-2027" }, { name: "Forte Koup", type: "car", years: "2016-2017" }, { name: "K4", type: "car", years: "2025-2027" }, { name: "K5", type: "car", years: "2021-2027" }, { name: "K900", type: "car", years: "2015-2020" }, { name: "Niro", type: "car", years: "2017-2027" }, { name: "Optima", type: "car", years: "2001-2020" }, { name: "Rio", type: "car", years: "2001-2023" }, { name: "Rondo", type: "car", years: "2007-2016" }, { name: "Sedona", type: "car", years: "2001-2021" }, { name: "Seltos", type: "car", years: "2021-2027" }, { name: "Sephia", type: "car", years: "1993-2001" }, { name: "Sorento", type: "car", years: "2001-2009,2011-2027" }, { name: "Soul", type: "car", years: "2010-2027" }, { name: "Spectra", type: "car", years: "2000-2009" }, { name: "Sportage", type: "car", years: "1995-2027" }, { name: "Stinger", type: "car", years: "2018-2023" }, { name: "Telluride", type: "car", years: "2020-2027" }] }, { slug: "lamborghini", name: "LAMBORGHINI", firstYear: 1989, lastYear: 2027, models: [{ name: "147", type: "car", years: "2002" }, { name: "Aventador", type: "car", years: "2011-2022" }, { name: "Diablo", type: "car", years: "1989-2001" }, { name: "Gallardo", type: "car", years: "2004-2014" }, { name: "Huracan", type: "car", years: "2015-2027" }, { name: "Murcielago", type: "car", years: "2004-2010" }, { name: "Revuelto", type: "car", years: "2024-2027" }, { name: "Roadster", type: "car", years: "1989-2000" }, { name: "Temerario", type: "car", years: "2026-2027" }, { name: "URUS", type: "car", years: "2019-2027" }] }, { slug: "land_rover", name: "LAND ROVER", firstYear: 1985, lastYear: 2027, models: [{ name: "Defender", type: "car", years: "1993-1995,1997,2020-2027" }, { name: "Discovery", type: "car", years: "1994-2004,2017-2027" }, { name: "Discovery Sport", type: "car", years: "2015-2027" }, { name: "Freelander", type: "car", years: "2002-2005" }, { name: "LR2", type: "car", years: "2008-2015" }, { name: "LR3", type: "car", years: "2005-2009" }, { name: "LR4", type: "car", years: "2010-2016" }, { name: "New Range Rover", type: "car", years: "2022" }, { name: "Range Rover", type: "car", years: "1985-2027" }, { name: "Range Rover Evoque", type: "car", years: "2012-2027" }, { name: "Range Rover Sport", type: "car", years: "2006-2027" }, { name: "Range Rover Velar", type: "car", years: "2018-2027" }] }, { slug: "lexus", name: "LEXUS", firstYear: 1990, lastYear: 2027, models: [{ name: "CT", type: "car", years: "2011-2017" }, { name: "ES", type: "car", years: "1990-2027" }, { name: "GS", type: "car", years: "1993-2027" }, { name: "GX", type: "car", years: "2003-2027" }, { name: "HS", type: "car", years: "2010-2012" }, { name: "IS", type: "car", years: "2001-2027" }, { name: "LC", type: "car", years: "2018-2027" }, { name: "LFA", type: "car", years: "2012-2013" }, { name: "LS", type: "car", years: "1990-2027" }, { name: "LX", type: "car", years: "1996-2027" }, { name: "NX", type: "car", years: "2015-2027" }, { name: "RC", type: "car", years: "2015-2027" }, { name: "RX", type: "car", years: "1999-2027" }, { name: "RZ", type: "car", years: "2023-2027" }, { name: "SC", type: "car", years: "1992-2027" }, { name: "TX", type: "car", years: "2024-2027" }, { name: "UX", type: "car", years: "2019-2027" }] }, { slug: "lincoln", name: "LINCOLN", firstYear: 1981, lastYear: 2027, models: [{ name: "Aviator", type: "car", years: "2003-2005,2020-2027" }, { name: "Blackwood", type: "van", years: "2002-2003" }, { name: "Continental", type: "car", years: "1981-2002,2017-2027" }, { name: "Corsair", type: "car", years: "2020-2027" }, { name: "LS", type: "car", years: "2000-2006" }, { name: "Mark", type: "car", years: "1981-1998" }, { name: "Mark LT", type: "van", years: "2006-2008" }, { name: "MKC", type: "car", years: "2015-2019" }, { name: "MKS", type: "car", years: "2009-2016" }, { name: "MKT", type: "car", years: "2010-2019" }, { name: "MKX", type: "car", years: "2007-2018" }, { name: "MKZ", type: "car", years: "2007-2020" }, { name: "Nautilus", type: "car", years: "2019-2027" }, { name: "Navigator", type: "car", years: "1998-2027" }, { name: "Navigator L", type: "car", years: "2017-2027" }, { name: "Town Car", type: "car", years: "1981-2011" }, { name: "Zephyr", type: "car", years: "2006" }] }, { slug: "lotus", name: "LOTUS", firstYear: 1981, lastYear: 2027, models: [{ name: "2-Eleven", type: "car", years: "2008-2009,2011-2012" }, { name: "340R", type: "car", years: "2007-2008" }, { name: "Eagle", type: "car", years: "2008-2009" }, { name: "Eclat", type: "car", years: "1981-1984,1990,1992-1997,2007-2008" }, { name: "Elan", type: "car", years: "1990-1997,2007-2009" }, { name: "ELETRE", type: "car", years: "2025-2027" }, { name: "Eleven", type: "car", years: "2007,2010" }, { name: "Elise", type: "car", years: "2005-2012" }, { name: "Elite", type: "car", years: "1981-1984,1990,1992-1997,2007-2008" }, { name: "Emira", type: "car", years: "2024-2027" }, { name: "Esprit", type: "car", years: "1981-1990,1992-1997,2001-2004,2007-2009" }, { name: "Europa", type: "car", years: "2007-2009" }, { name: "Evora", type: "car", years: "2010-2027" }, { name: "Exige", type: "car", years: "2008,2010-2012" }, { name: "MEL", type: "car", years: "2007-2009" }, { name: "Monaco", type: "car", years: "2007-2008" }, { name: "Monza", type: "car", years: "2007-2008" }, { name: "Spa", type: "car", years: "2007-2008" }, { name: "Turbo Esprit", type: "car", years: "1981-1984,1990-2000" }] }, { slug: "lucid", name: "LUCID", firstYear: 2022, lastYear: 2026, models: [{ name: "Air", type: "car", years: "2022-2026" }, { name: "Gravity", type: "car", years: "2025-2026" }] }, { slug: "maserati", name: "MASERATI", firstYear: 1981, lastYear: 2027, models: [{ name: "228", type: "car", years: "1981-1991" }, { name: "430", type: "car", years: "1981-1991" }, { name: "Biturbo", type: "car", years: "1981-1991" }, { name: "Coupe", type: "car", years: "2002-2004,2006" }, { name: "Ghibli", type: "car", years: "2014-2024" }, { name: "Grancabrio", type: "car", years: "2024-2027" }, { name: "Granturismo", type: "car", years: "2008-2027" }, { name: "Grecale", type: "car", years: "2023-2027" }, { name: "Levante", type: "car", years: "2017-2027" }, { name: "MC20", type: "car", years: "2022-2025" }, { name: "MCPura", type: "car", years: "2026-2027" }, { name: "Merak", type: "car", years: "1981-1991" }, { name: "Quattroporte", type: "car", years: "1981-1991,2005-2024" }, { name: "Spyder", type: "car", years: "1981-1991,2002-2004,2006" }, { name: "TC", type: "car", years: "1981-1991" }] }, { slug: "maybach", name: "MAYBACH", firstYear: 2003, lastYear: 2012, models: [{ name: "57", type: "car", years: "2003-2012" }, { name: "62", type: "car", years: "2003-2012" }] }, { slug: "mazda", name: "MAZDA", firstYear: 1981, lastYear: 2027, models: [{ name: "323", type: "car", years: "1986-1994" }, { name: "626", type: "car", years: "1981-2002" }, { name: "929", type: "car", years: "1988-1996" }, { name: "B-Series", type: "car", years: "1981-2010" }, { name: "CX-3", type: "car", years: "2016-2022" }, { name: "CX-30", type: "car", years: "2020-2027" }, { name: "CX-5", type: "car", years: "2013-2027" }, { name: "CX-50", type: "car", years: "2023-2027" }, { name: "CX-7", type: "car", years: "2007-2012" }, { name: "CX-70", type: "car", years: "2025-2027" }, { name: "CX-9", type: "car", years: "2007-2027" }, { name: "CX-90", type: "car", years: "2024-2027" }, { name: "GLC", type: "car", years: "1981-1986" }, { name: "Mazda2", type: "car", years: "2011-2021" }, { name: "Mazda3", type: "car", years: "2004-2027" }, { name: "Mazda5", type: "car", years: "2006-2015" }, { name: "Mazda6", type: "car", years: "2003-2021" }, { name: "Millenia", type: "car", years: "1995-2002" }, { name: "MPV", type: "car", years: "1989-2006" }, { name: "MX-3", type: "car", years: "1989-1996" }, { name: "MX-30", type: "car", years: "2022-2027" }, { name: "MX-5", type: "car", years: "1990-1997,1999-2027" }, { name: "MX-6", type: "car", years: "1988-1994,1996-1997" }, { name: "Navajo", type: "car", years: "1991-1994" }, { name: "Protege", type: "car", years: "1990-2003" }, { name: "RX-7", type: "car", years: "1981-1991,1993-1996" }, { name: "RX-8", type: "car", years: "2004-2012" }, { name: "Tribute", type: "car", years: "2001-2006,2008-2011" }] }, { slug: "mclaren", name: "MCLAREN", firstYear: 2009, lastYear: 2027, models: [{ name: "540C", type: "car", years: "2009-2021" }, { name: "570GT", type: "car", years: "2009-2021" }, { name: "570S", type: "car", years: "2009-2021" }, { name: "600LT", type: "car", years: "2017-2021" }, { name: "620R", type: "car", years: "2020-2021" }, { name: "625C", type: "car", years: "2009-2016,2020-2021" }, { name: "650S", type: "car", years: "2009-2016,2020-2021" }, { name: "675LT", type: "car", years: "2009-2016,2020-2021" }, { name: "720S", type: "car", years: "2017-2023" }, { name: "750S", type: "car", years: "2024-2027" }, { name: "765LT", type: "car", years: "2022" }, { name: "ARTURA", type: "car", years: "2023-2027" }, { name: "ELVA", type: "car", years: "2022" }, { name: "GT", type: "car", years: "2017-2023" }, { name: "GTS", type: "car", years: "2025-2027" }, { name: "MP4-12C", type: "car", years: "2009-2016,2020-2021" }, { name: "P1", type: "car", years: "2009-2016,2020-2021" }, { name: "SENNA", type: "car", years: "2017-2021" }, { name: "SENNA GTR", type: "car", years: "2017-2021" }] }, { slug: "mercedes_benz", name: "MERCEDES-BENZ", firstYear: 1981, lastYear: 2027, models: [{ name: "190", type: "car", years: "1983-1993" }, { name: "240", type: "car", years: "1981-1983" }, { name: "260", type: "car", years: "1983-1989" }, { name: "280", type: "car", years: "1981-1982" }, { name: "300", type: "car", years: "1981-1993" }, { name: "350", type: "car", years: "1983-1991" }, { name: "380", type: "car", years: "1981-1985" }, { name: "400", type: "car", years: "1992-1993" }, { name: "420", type: "car", years: "1983-1991" }, { name: "500", type: "car", years: "1983-1993" }, { name: "560", type: "car", years: "1986-1991" }, { name: "600", type: "car", years: "1992-1993" }, { name: "A-Class", type: "car", years: "2019-2022" }, { name: "AMG GT", type: "car", years: "2016-2026" }, { name: "B-Class", type: "car", years: "2011-2012,2014-2022" }, { name: "C-Class", type: "car", years: "1994-2026" }, { name: "CL-Class", type: "car", years: "1998-2014" }, { name: "CLA-Class", type: "car", years: "2014-2027" }, { name: "CLE", type: "car", years: "2024-2027" }, { name: "CLK-Class", type: "car", years: "1998-2009" }, { name: "CLS-Class", type: "car", years: "2005-2023" }, { name: "E-Class", type: "car", years: "1994-2027" }, { name: "EQB-Class", type: "car", years: "2022-2025" }, { name: "EQE-Class Sedan", type: "car", years: "2023-2026" }, { name: "EQE-Class SUV", type: "car", years: "2023-2027" }, { name: "EQS-Class Sedan", type: "car", years: "2022-2026" }, { name: "EQS-Class SUV", type: "car", years: "2023-2027" }, { name: "eSprinter", type: "car", years: "2024-2027" }, { name: "G-Class", type: "car", years: "1999,2002-2027" }, { name: "GL-Class", type: "car", years: "2006-2016" }, { name: "GLA-Class", type: "car", years: "2015-2026" }, { name: "GLB-Class", type: "car", years: "2020-2026" }, { name: "GLC-Class", type: "car", years: "2016-2026" }, { name: "GLE-Class", type: "car", years: "2016-2026" }, { name: "GLK-Class", type: "car", years: "2010-2020" }, { name: "GLS-Class", type: "car", years: "2016-2026" }, { name: "L1013", type: "van", years: "1981-1990" }, { name: "L1113", type: "van", years: "1981-1990" }, { name: "L1116", type: "van", years: "1981-1990" }, { name: "L1117", type: "van", years: "1981-1990" }, { name: "L1316", type: "van", years: "1981-1990" }, { name: "L1317", type: "van", years: "1981-1990" }, { name: "L1319", type: "van", years: "1981-1990" }, { name: "L1418", type: "van", years: "1981-1990" }, { name: "L1419", type: "van", years: "1981-1990" }, { name: "LP1219", type: "van", years: "1981-1990" }, { name: "LP1419", type: "van", years: "1981-1990" }, { name: "LPS1525", type: "van", years: "1981-1990" }, { name: "M-Class", type: "car", years: "1995-2011,2016-2019" }, { name: "Metris", type: "car", years: "2016-2023" }, { name: "ML-Class", type: "car", years: "2012-2015" }, { name: "R-Class", type: "car", years: "2006-2013" }, { name: "S-Class", type: "car", years: "1994-2026" }, { name: "SL-Class", type: "car", years: "1994-2009,2011-2027" }, { name: "SLC-Class", type: "car", years: "2017-2020" }, { name: "SLK-Class", type: "car", years: "1998-2016" }, { name: "SLR McLaren", type: "car", years: "2004-2009" }, { name: "SLS-Class", type: "car", years: "2011-2022" }, { name: "Sprinter", type: "car", years: "2010-2027" }] }, { slug: "mercury", name: "MERCURY", firstYear: 1981, lastYear: 2011, models: [{ name: "Capri", type: "car", years: "1981-1986,1989-1994" }, { name: "Cougar", type: "car", years: "1981-1997,1999-2002" }, { name: "Grand Marquis", type: "car", years: "1981-2011" }, { name: "Lynx", type: "car", years: "1981-1987" }, { name: "Marauder", type: "car", years: "2004" }, { name: "Mariner", type: "car", years: "2005-2011" }, { name: "MARQUIS", type: "car", years: "1981-1986" }, { name: "Milan", type: "car", years: "2006-2011" }, { name: "Montego", type: "car", years: "2005-2007" }, { name: "Monterey", type: "car", years: "2004-2007" }, { name: "Mountaineer", type: "car", years: "1997-2010" }, { name: "Mystique", type: "car", years: "1995-2000" }, { name: "Sable", type: "car", years: "1986-2005,2008-2009" }, { name: "Topaz", type: "car", years: "1984-1994" }, { name: "Tracer", type: "car", years: "1988-1999" }, { name: "Villager", type: "car", years: "1993-2002" }, { name: "Zephyr", type: "car", years: "1981-1983" }] }, { slug: "mini", name: "MINI", firstYear: 2002, lastYear: 2027, models: [{ name: "Clubman", type: "car", years: "2008-2014,2016-2024" }, { name: "Cooper", type: "car", years: "2002-2010" }, { name: "Cooper Convertible", type: "car", years: "2004-2027" }, { name: "Cooper Coupe", type: "car", years: "2012-2015" }, { name: "Cooper Roadster", type: "car", years: "2012-2015" }, { name: "Countryman", type: "car", years: "2011-2027" }, { name: "Hardtop", type: "car", years: "2009-2027" }, { name: "Paceman", type: "car", years: "2013-2019" }] }, { slug: "mitsubishi", name: "MITSUBISHI", firstYear: 1983, lastYear: 2027, models: [{ name: "3000GT", type: "car", years: "1991-1999" }, { name: "Cordia", type: "car", years: "1983-1988" }, { name: "Diamante", type: "car", years: "1992-2027" }, { name: "Eclipse", type: "car", years: "1990-2012" }, { name: "Eclipse Cross", type: "car", years: "2018-2026" }, { name: "Endeavor", type: "car", years: "2004-2011" }, { name: "Expo", type: "car", years: "1992-1996" }, { name: "Galant", type: "car", years: "1985-2012" }, { name: "i-MiEV", type: "car", years: "2012-2018" }, { name: "Lancer", type: "car", years: "2002-2017" }, { name: "Lancer Evolution", type: "car", years: "2003-2006,2008-2015" }, { name: "Lancer SportBack", type: "car", years: "2004-2005,2009-2017" }, { name: "Mighty Max", type: "car", years: "1985-1996" }, { name: "Mirage", type: "car", years: "1985-2002,2014-2027" }, { name: "Mirage G4", type: "car", years: "2017-2027" }, { name: "Montero", type: "car", years: "1985-1990,1994-2006" }, { name: "Montero Sport", type: "car", years: "1991-1993,1997-2004" }, { name: "Outlander", type: "car", years: "2003-2026" }, { name: "Outlander Sport", type: "car", years: "2011-2027" }, { name: "Precis", type: "car", years: "1988-1994" }, { name: "Raider", type: "car", years: "1993-2010" }, { name: "RVR", type: "car", years: "2011-2022" }, { name: "Sigma", type: "car", years: "1989-1990" }, { name: "SP", type: "car", years: "1985-1986" }, { name: "Space Wagon", type: "car", years: "1987-1988" }, { name: "SPX", type: "car", years: "1987-1990" }, { name: "Starion", type: "car", years: "1983-1990" }, { name: "Tredia", type: "car", years: "1983-1988" }, { name: "Van", type: "car", years: "1987-1990" }, { name: "Wagon", type: "car", years: "1989-1990" }] }, { slug: "nissan", name: "NISSAN", firstYear: 1981, lastYear: 2027, models: [{ name: "200SX", type: "car", years: "1981-1988,1995-1998" }, { name: "240SX", type: "car", years: "1989-2001" }, { name: "300ZX", type: "car", years: "1983-1996" }, { name: "350Z", type: "car", years: "2003-2009" }, { name: "370Z", type: "car", years: "2009-2022" }, { name: "Altima", type: "car", years: "1993-2027" }, { name: "Altra", type: "car", years: "1998" }, { name: "Altra-EV", type: "car", years: "1999-2002,2004" }, { name: "Ariya Hatchback", type: "car", years: "2023-2024" }, { name: "Ariya MPV", type: "car", years: "2025-2027" }, { name: "Armada", type: "car", years: "2002-2015,2017-2027" }, { name: "Axxess", type: "car", years: "1990-1991" }, { name: "Cube", type: "car", years: "2009-2014" }, { name: "Frontier", type: "car", years: "1998-2027" }, { name: "GT-R", type: "car", years: "2009-2027" }, { name: "Juke", type: "car", years: "2011-2018" }, { name: "Kicks", type: "car", years: "2018-2024" }, { name: "Kicks MPV", type: "car", years: "2025-2027" }, { name: "Kicks Play", type: "car", years: "2025-2027" }, { name: "Leaf", type: "car", years: "2011-2027" }, { name: "Maxima", type: "car", years: "1981-2014,2016-2023" }, { name: "Micra", type: "car", years: "1985-1991" }, { name: "Murano", type: "car", years: "2002-2007,2009-2027" }, { name: "Nissan Z", type: "car", years: "2023-2027" }, { name: "NV", type: "van", years: "2011-2027" }, { name: "NV200", type: "car", years: "2013-2027" }, { name: "NX", type: "car", years: "1991-1993" }, { name: "Pathfinder", type: "car", years: "1986-2027" }, { name: "Pickup", type: "car", years: "1981-1997" }, { name: "PULSAR", type: "car", years: "1981-1990" }, { name: "Quest", type: "car", years: "1993-2009,2011-2017" }, { name: "Rogue", type: "car", years: "2008-2027" }, { name: "Rogue Select", type: "car", years: "2014" }, { name: "Rogue Sport", type: "car", years: "2017-2022" }, { name: "Sentra", type: "car", years: "1982-2027" }, { name: "Sentra Classic", type: "car", years: "1991-1992,1995" }, { name: "Stanza", type: "car", years: "1981-1992" }, { name: "Stanza Wagon", type: "car", years: "1986-1989" }, { name: "Titan", type: "car", years: "2002-2027" }, { name: "Van", type: "car", years: "1987-1990" }, { name: "Versa", type: "car", years: "2007-2027" }, { name: "Versa Note", type: "car", years: "2014-2020" }, { name: "X-Trail", type: "car", years: "2005-2006" }, { name: "Xterra", type: "car", years: "2000-2015" }] }, { slug: "oldsmobile", name: "OLDSMOBILE", firstYear: 1981, lastYear: 2004, models: [{ name: "Achieva", type: "car", years: "1992-1998" }, { name: "Alero", type: "car", years: "1999-2004" }, { name: "Aurora", type: "car", years: "1995-1999,2001-2003" }, { name: "Bravada", type: "car", years: "1991-2004" }, { name: "Custom Cruiser", type: "car", years: "1981-1993" }, { name: "Cutlass", type: "car", years: "1981,1997-1999" }, { name: "Cutlass Calais", type: "car", years: "1981-1991" }, { name: "Cutlass Ciera", type: "car", years: "1982-1996" }, { name: "Cutlass Cruiser", type: "car", years: "1981-1983" }, { name: "Cutlass Salon", type: "car", years: "1985-1987" }, { name: "Cutlass Supreme", type: "car", years: "1981-1997" }, { name: "Delta 88", type: "car", years: "1981-1988" }, { name: "Eighty Eight (88)", type: "car", years: "1989-1999" }, { name: "Firenza", type: "car", years: "1982-1988" }, { name: "Intrigue", type: "car", years: "1998-2002" }, { name: "LSS", type: "car", years: "1996-1999" }, { name: "Ninety Eight (98)", type: "car", years: "1981-1996" }, { name: "Omega", type: "car", years: "1981-1984" }, { name: "Regency", type: "car", years: "1997-1999" }, { name: "Silhouette", type: "car", years: "1990-2004" }, { name: "Toronado", type: "car", years: "1981-1993" }] }, { slug: "peterbilt", name: "PETERBILT", firstYear: 1981, lastYear: 2027, models: [{ name: "200", type: "van", years: "1992-1996" }, { name: "210", type: "van", years: "1997-2023" }, { name: "220", type: "van", years: "1997-2027" }, { name: "250", type: "van", years: "1992-1996" }, { name: "310", type: "van", years: "1981-1996" }, { name: "320", type: "van", years: "1986-2023" }, { name: "325", type: "van", years: "1997-2027" }, { name: "330", type: "van", years: "1997-2027" }, { name: "335", type: "van", years: "1997-2027" }, { name: "337", type: "van", years: "1997-2027" }, { name: "340", type: "van", years: "1997-2023" }, { name: "348", type: "van", years: "1981-2027" }, { name: "349", type: "van", years: "1981-1996" }, { name: "352", type: "van", years: "1981-1996" }, { name: "353", type: "van", years: "1981-1996" }, { name: "357", type: "van", years: "1986-2023" }, { name: "359", type: "van", years: "1981-1996" }, { name: "362", type: "van", years: "1981-2023" }, { name: "363", type: "van", years: "1997-2023" }, { name: "365", type: "van", years: "1997-2027" }, { name: "367", type: "van", years: "1997-2027" }, { name: "372", type: "van", years: "1981-1984,1988-1996" }, { name: "375", type: "van", years: "1986-1996" }, { name: "376", type: "van", years: "1988-1996" }, { name: "377", type: "van", years: "1986-1996" }, { name: "378", type: "van", years: "1988-2023" }, { name: "379", type: "van", years: "1985-2016,2022-2023" }, { name: "382", type: "van", years: "1997-2023" }, { name: "384", type: "van", years: "1997-2023" }, { name: "385", type: "van", years: "1992-2023" }, { name: "386", type: "van", years: "1997-2023" }, { name: "387", type: "van", years: "1981-2023" }, { name: "388", type: "van", years: "1992,1997-2023" }, { name: "389", type: "van", years: "1997-2027" }, { name: "397", type: "van", years: "1981-1996" }, { name: "476", type: "van", years: "1996" }, { name: "477", type: "van", years: "1996" }, { name: "520", type: "van", years: "2017-2027" }, { name: "535", type: "van", years: "2022-2027" }, { name: "536", type: "van", years: "2022-2027" }, { name: "537", type: "van", years: "2023-2027" }, { name: "548", type: "van", years: "2024-2027" }, { name: "567", type: "van", years: "1997-2027" }, { name: "579", type: "van", years: "1997-2027" }, { name: "587", type: "van", years: "1997-2023" }, { name: "589", type: "van", years: "2022-2027" }, { name: "Medium Duty COE", type: "van", years: "1997-2023" }] }, { slug: "peugeot", name: "PEUGEOT", firstYear: 1981, lastYear: 2027, models: [{ name: "405", type: "car", years: "1984-2027" }, { name: "504", type: "car", years: "1981-1983" }, { name: "505", type: "car", years: "1981-2027" }, { name: "604", type: "car", years: "1981-1983" }] }, { slug: "plymouth", name: "PLYMOUTH", firstYear: 1981, lastYear: 2027, models: [{ name: "Acclaim", type: "car", years: "1981-1995" }, { name: "Arrow", type: "van", years: "1981-1982" }, { name: "Breeze", type: "car", years: "1996-2000" }, { name: "CARAVELLE", type: "car", years: "1981-1988" }, { name: "Champ", type: "car", years: "1981-1982" }, { name: "Colt", type: "car", years: "1983-1994" }, { name: "Conquest", type: "car", years: "1984-1986" }, { name: "GRAN FURY", type: "car", years: "1981-1989" }, { name: "Grand Voyager", type: "car", years: "1988-2027" }, { name: "HORIZON", type: "car", years: "1981-1990" }, { name: "Laser", type: "car", years: "1990-1994" }, { name: "Neon", type: "car", years: "1994-2027" }, { name: "Prowler", type: "car", years: "1997,1999-2027" }, { name: "Reliant", type: "car", years: "1981-1989" }, { name: "Sapporo", type: "car", years: "1981-1983" }, { name: "Scamp", type: "van", years: "1983" }, { name: "Sundance", type: "car", years: "1987-1994" }, { name: "Trailduster", type: "car", years: "1981-1983" }, { name: "TURISMO", type: "car", years: "1985-1988" }, { name: "Voyager", type: "car", years: "1981-2027" }] }, { slug: "pontiac", name: "PONTIAC", firstYear: 1981, lastYear: 2010, models: [{ name: "6000", type: "car", years: "1981-1991" }, { name: "Acadian", type: "car", years: "1981-1987" }, { name: "Aztek", type: "car", years: "2000-2005" }, { name: "Bonneville", type: "car", years: "1981-2005" }, { name: "Catalina", type: "car", years: "1981" }, { name: "Fiero", type: "car", years: "1984-1988" }, { name: "Firebird", type: "car", years: "1981-2002" }, { name: "Firefly", type: "car", years: "1985-2000" }, { name: "G3", type: "car", years: "2008-2010" }, { name: "G5", type: "car", years: "2007-2010" }, { name: "G6", type: "car", years: "2005-2010" }, { name: "G8", type: "car", years: "2008-2010" }, { name: "Grand AM", type: "car", years: "1985-2005" }, { name: "Grand Lemans", type: "car", years: "1981-1983" }, { name: "Grand Prix", type: "car", years: "1981-2008" }, { name: "GTO", type: "car", years: "2004-2006" }, { name: "J2000", type: "car", years: "1982-1983" }, { name: "Laurentian", type: "car", years: "1981" }, { name: "Lemans", type: "car", years: "1981,1985-1993" }, { name: "Matiz", type: "car", years: "2007,2010" }, { name: "Montana", type: "car", years: "1999-2004" }, { name: "Montana SV6", type: "car", years: "2005-2009" }, { name: "Parisienne", type: "car", years: "1981-1989" }, { name: "Phoenix", type: "car", years: "1981-1984" }, { name: "Pursuit", type: "car", years: "2005-2006" }, { name: "Safari", type: "car", years: "1987-1989" }, { name: "Solstice", type: "car", years: "2006-2010" }, { name: "Sunbird", type: "car", years: "1985-1995" }, { name: "Sunbird 2000", type: "car", years: "1981,1984" }, { name: "Sunburst", type: "car", years: "1985-1987" }, { name: "Sunfire", type: "car", years: "1996-2005" }, { name: "T1000", type: "car", years: "1981-1987" }, { name: "Tempest", type: "car", years: "1987-1991" }, { name: "Torrent", type: "car", years: "2006-2009" }, { name: "Trans Sport", type: "car", years: "1990-1998" }, { name: "Vibe", type: "car", years: "2003-2010" }, { name: "Wave", type: "car", years: "2005-2008" }] }, { slug: "porsche", name: "PORSCHE", firstYear: 1981, lastYear: 2027, models: [{ name: "718 Boxster", type: "car", years: "2017-2025" }, { name: "718 Cayman", type: "car", years: "2017-2025" }, { name: "718 Spyder", type: "car", years: "2020,2022-2025" }, { name: "911", type: "car", years: "1981-2027" }, { name: "918", type: "car", years: "2015" }, { name: "924", type: "car", years: "1981-1982,1985-1988" }, { name: "928", type: "car", years: "1981-1984,1989-1994" }, { name: "944", type: "car", years: "1981-1991" }, { name: "968", type: "car", years: "1992-1994" }, { name: "Boxster", type: "car", years: "1997-2016" }, { name: "Cayenne", type: "car", years: "2003-2027" }, { name: "Cayman", type: "car", years: "2006-2016" }, { name: "Macan", type: "car", years: "2015-2027" }, { name: "Panamera", type: "car", years: "2010-2027" }, { name: "Taycan", type: "car", years: "2020-2027" }] }, { slug: "ram", name: "RAM", firstYear: 2012, lastYear: 2027, models: [{ name: "1500", type: "car", years: "2013-2027" }, { name: "2500", type: "car", years: "2013-2027" }, { name: "3500", type: "car", years: "2012-2027" }, { name: "4000", type: "car", years: "2013-2023" }, { name: "4500", type: "car", years: "2013-2027" }, { name: "5500", type: "car", years: "2013-2027" }, { name: "Cargo Van", type: "car", years: "2013-2016" }, { name: "ProMaster 1500", type: "car", years: "2014-2027" }, { name: "ProMaster 2500", type: "car", years: "2014-2027" }, { name: "ProMaster 3500", type: "car", years: "2014-2027" }, { name: "Promaster City", type: "car", years: "2015-2027" }] }, { slug: "renault", name: "RENAULT", firstYear: 1981, lastYear: 1987, models: [{ name: "18i", type: "car", years: "1981-1986" }, { name: "Alliance", type: "car", years: "1983-1987" }, { name: "Encore", type: "car", years: "1984-1987" }, { name: "Fuego", type: "car", years: "1983-1986" }, { name: "LeCar", type: "car", years: "1981-1983" }] }, { slug: "rivian", name: "RIVIAN", firstYear: 2022, lastYear: 2026, models: [{ name: "EDV", type: "van", years: "2022-2026" }, { name: "R1S", type: "car", years: "2022-2026" }, { name: "R1T", type: "van", years: "2022-2026" }, { name: "RCV", type: "van", years: "2022,2024-2026" }] }, { slug: "rolls_royce", name: "ROLLS-ROYCE", firstYear: 1981, lastYear: 2027, models: [{ name: "Camargue", type: "car", years: "1981-1987" }, { name: "Corniche", type: "car", years: "1981-1995,2000-2002" }, { name: "Cullinan", type: "car", years: "2019-2027" }, { name: "Dawn", type: "car", years: "2016-2021" }, { name: "Flying Spur", type: "car", years: "1995" }, { name: "Ghost", type: "car", years: "2010-2027" }, { name: "Park Ward", type: "car", years: "1998-1999,2001-2002" }, { name: "Phantom", type: "car", years: "2004-2027" }, { name: "Silver Dawn", type: "car", years: "1995-1997" }, { name: "Silver Seraph", type: "car", years: "1999-2002" }, { name: "Silver Spirit", type: "car", years: "1981-1996" }, { name: "Silver Spur", type: "car", years: "1981-1999" }, { name: "Spectre", type: "car", years: "2024-2027" }, { name: "Touring Limousine", type: "car", years: "1993-1998" }, { name: "Wraith", type: "car", years: "2014-2021" }] }, { slug: "saab", name: "SAAB", firstYear: 1981, lastYear: 2027, models: [{ name: "9-2X", type: "car", years: "2005-2009" }, { name: "9-3", type: "car", years: "1999-2027" }, { name: "9-4x", type: "car", years: "2011-2012" }, { name: "9-5", type: "car", years: "1999-2027" }, { name: "9-7X", type: "car", years: "2005-2009" }, { name: "900", type: "car", years: "1981-1998" }, { name: "9000", type: "car", years: "1984-1985,1987-1998" }] }, { slug: "saturn", name: "SATURN", firstYear: 1991, lastYear: 2010, models: [{ name: "Astra", type: "car", years: "2008-2009" }, { name: "Aura", type: "car", years: "2007-2010" }, { name: "Ion", type: "car", years: "2003-2007" }, { name: "L200", type: "car", years: "2003" }, { name: "L300", type: "car", years: "2003-2005" }, { name: "LS", type: "car", years: "2000-2002" }, { name: "LS1", type: "car", years: "2000-2002" }, { name: "LS2", type: "car", years: "2000-2002" }, { name: "LW1", type: "car", years: "2000-2002" }, { name: "LW2", type: "car", years: "2000-2002" }, { name: "LW200", type: "car", years: "2003" }, { name: "LW300", type: "car", years: "2003-2004" }, { name: "Outlook", type: "car", years: "2007-2010" }, { name: "Relay", type: "car", years: "2005-2007" }, { name: "SC1", type: "car", years: "1991-2002" }, { name: "SC2", type: "car", years: "1991-2002" }, { name: "Sky", type: "car", years: "2007-2010" }, { name: "SL", type: "car", years: "1994-1996,1998-2002" }, { name: "SL1", type: "car", years: "1991-2002" }, { name: "SL2", type: "car", years: "1991-2002" }, { name: "SL3", type: "car", years: "1991-1993" }, { name: "SW1", type: "car", years: "1993-2001" }, { name: "SW2", type: "car", years: "1993-2001" }, { name: "Vue", type: "car", years: "2002-2010" }] }, { slug: "shelby", name: "SHELBY", firstYear: 2022, lastYear: 2026, models: [{ name: "Cobra", type: "car", years: "2023-2026" }, { name: "GT", type: "car", years: "2022-2026" }] }, { slug: "smart", name: "SMART", firstYear: 2e3, lastYear: 2027, models: [{ name: "EQ Fortwo", type: "car", years: "2018-2027" }, { name: "Fortwo", type: "car", years: "2008-2027" }, { name: "Fortwo Electric Drive", type: "car", years: "2013-2015" }, { name: "smart", type: "car", years: "2000-2004" }] }, { slug: "spyker", name: "SPYKER", firstYear: 2002, lastYear: 2027, models: [{ name: "C12", type: "car", years: "2002-2027" }, { name: "C8", type: "car", years: "2002-2027" }, { name: "D8/D12", type: "car", years: "2002-2027" }] }, { slug: "subaru", name: "SUBARU", firstYear: 1981, lastYear: 2027, models: [{ name: "Ascent", type: "car", years: "2019-2027" }, { name: "B9 Tribeca", type: "car", years: "2006-2014" }, { name: "Baja", type: "car", years: "2003-2006" }, { name: "Brat", type: "car", years: "1981-1986" }, { name: "BRZ", type: "car", years: "2013-2027" }, { name: "Crosstrek", type: "car", years: "2016-2027" }, { name: "DL", type: "car", years: "1981-1989" }, { name: "Forester", type: "car", years: "1998-2027" }, { name: "GL", type: "car", years: "1981-1989" }, { name: "GL-10", type: "car", years: "1985-1989" }, { name: "GLF", type: "car", years: "1981-1982" }, { name: "Impreza", type: "car", years: "1993-2027" }, { name: "Justy", type: "car", years: "1987-1994" }, { name: "Legacy", type: "car", years: "1990-2027" }, { name: "Loyale", type: "car", years: "1990-1994" }, { name: "Outback", type: "car", years: "2005-2027" }, { name: "RX", type: "car", years: "1986-1989" }, { name: "Solterra", type: "car", years: "2023-2027" }, { name: "Standard", type: "car", years: "1981-1987" }, { name: "SVX", type: "car", years: "1992-1997" }, { name: "Trailseeker", type: "car", years: "2026-2027" }, { name: "Uncharted", type: "car", years: "2026-2027" }, { name: "WRX", type: "car", years: "2015-2027" }, { name: "XT", type: "car", years: "1985-1991" }, { name: "XT6", type: "car", years: "1988-1991" }, { name: "XV CrossTrek", type: "car", years: "2012-2015" }] }, { slug: "suzuki", name: "SUZUKI", firstYear: 1981, lastYear: 2027, models: [{ name: "Aerio", type: "car", years: "2002-2007" }, { name: "Equator", type: "van", years: "2009-2027" }, { name: "Esteem", type: "car", years: "1995-2002" }, { name: "Forenza", type: "car", years: "2004-2008" }, { name: "Forsa", type: "car", years: "1985-1988" }, { name: "Grand Vitara", type: "car", years: "1999-2027" }, { name: "Grand Vitara XL-7", type: "car", years: "2002,2006-2008" }, { name: "Kizashi", type: "car", years: "2010-2027" }, { name: "Reno", type: "car", years: "2005-2008" }, { name: "Samurai", type: "car", years: "1986-1996" }, { name: "Sidekick", type: "car", years: "1989-1998" }, { name: "Sidekick Sport", type: "car", years: "1989-1998" }, { name: "Swift", type: "car", years: "1989-2001,2004-2008" }, { name: "SX4", type: "car", years: "2007-2027" }, { name: "Verona", type: "car", years: "2004-2008" }, { name: "Vitara", type: "car", years: "1999-2004" }, { name: "X-90", type: "car", years: "1996-1998" }, { name: "XL7", type: "car", years: "2003-2005,2007-2027" }] }, { slug: "tesla", name: "TESLA", firstYear: 2008, lastYear: 2027, models: [{ name: "Cybercab", type: "car", years: "2026-2027" }, { name: "Cybertruck", type: "van", years: "2024-2027" }, { name: "Model 3", type: "car", years: "2017-2027" }, { name: "Model S", type: "car", years: "2012-2027" }, { name: "Model X", type: "car", years: "2016-2027" }, { name: "Model Y", type: "car", years: "2020-2027" }, { name: "Roadster", type: "car", years: "2008-2012" }, { name: "Semi", type: "van", years: "2023-2027" }] }, { slug: "toyota", name: "TOYOTA", firstYear: 1981, lastYear: 2027, models: [{ name: "4Runner", type: "car", years: "1984-2027" }, { name: "86", type: "car", years: "2017-2020" }, { name: "Avalon", type: "car", years: "1995-2022" }, { name: "bZ", type: "car", years: "2026-2027" }, { name: "bZ Woodland", type: "car", years: "2026-2027" }, { name: "bZ4X", type: "car", years: "2023-2025" }, { name: "C-HR", type: "car", years: "2018-2022,2026-2027" }, { name: "Camry", type: "car", years: "1983-2027" }, { name: "Camry Solara", type: "car", years: "1999-2009" }, { name: "Cargo Van", type: "van", years: "1987-1989" }, { name: "Celica", type: "car", years: "1981-2006" }, { name: "Corolla", type: "car", years: "1981-2027" }, { name: "Corolla Cross", type: "car", years: "2022-2027" }, { name: "COROLLA iM", type: "car", years: "2017-2018" }, { name: "Corolla Matrix", type: "car", years: "2003-2013" }, { name: "Corona", type: "car", years: "1981-1982" }, { name: "Cressida", type: "car", years: "1981-1992" }, { name: "Crown", type: "car", years: "2023-2027" }, { name: "Crown Signia", type: "car", years: "2025-2027" }, { name: "Echo", type: "car", years: "2000-2005" }, { name: "FCHV-adv", type: "car", years: "2009-2010" }, { name: "FJ Cruiser", type: "car", years: "2007-2014" }, { name: "GR Corolla", type: "car", years: "2023-2027" }, { name: "GR86", type: "car", years: "2022-2027" }, { name: "Grand Highlander", type: "car", years: "2024-2027" }, { name: "Highlander", type: "car", years: "2001-2027" }, { name: "Land Cruiser", type: "car", years: "1981-2021,2024-2027" }, { name: "Mirai", type: "car", years: "2016-2027" }, { name: "MR2", type: "car", years: "1985-1989,1991-1995,2000-2007" }, { name: "Paseo", type: "car", years: "1992-1999" }, { name: "Pick-Up", type: "car", years: "1981-1995" }, { name: "Previa", type: "car", years: "1991-1998" }, { name: "Prius", type: "car", years: "2001-2027" }, { name: "Prius C", type: "car", years: "2012-2020" }, { name: "Prius Prime (PHEV)", type: "car", years: "2017-2027" }, { name: "Prius V", type: "car", years: "2012-2017" }, { name: "RAV4", type: "car", years: "1996-2027" }, { name: "RAV4 Prime (PHEV)", type: "car", years: "2021-2027" }, { name: "Scion FR-S", type: "car", years: "2013-2016" }, { name: "Scion iA", type: "car", years: "2016" }, { name: "Scion iM", type: "car", years: "2016" }, { name: "Scion iQ", type: "car", years: "2011-2015" }, { name: "Scion tC", type: "car", years: "2005-2016" }, { name: "Scion xA", type: "car", years: "2004-2006" }, { name: "Scion xB", type: "car", years: "2004-2015" }, { name: "Scion xD", type: "car", years: "2008-2014" }, { name: "Sequoia", type: "car", years: "2000-2027" }, { name: "Sienna", type: "car", years: "1995-2027" }, { name: "Starlet", type: "car", years: "1981-1984" }, { name: "Supra", type: "car", years: "1981-1998,2020-2027" }, { name: "T100", type: "van", years: "1993-1998" }, { name: "Tacoma", type: "van", years: "1995-2027" }, { name: "Tercel", type: "car", years: "1981-1999" }, { name: "Tundra", type: "van", years: "1995-2027" }, { name: "Van", type: "car", years: "1984-1989,1991" }, { name: "Venza", type: "car", years: "2009-2017,2021-2024" }, { name: "Yaris", type: "car", years: "2007-2020" }, { name: "Yaris iA", type: "car", years: "2017-2019" }] }, { slug: "triumph", name: "TRIUMPH", firstYear: 1981, lastYear: 2027, models: [{ name: "TR7", type: "car", years: "1981" }, { name: "TR8", type: "car", years: "1981" }] }, { slug: "volvo", name: "VOLVO", firstYear: 1981, lastYear: 2027, models: [{ name: "240 Series", type: "car", years: "1981-1993" }, { name: "260 Series", type: "car", years: "1981-1982" }, { name: "740 Series", type: "car", years: "1981-1992" }, { name: "760 Series", type: "car", years: "1981-1990" }, { name: "780 Series", type: "car", years: "1981-1991" }, { name: "850 Series", type: "car", years: "1993-1997" }, { name: "940 Series", type: "car", years: "1991-1995" }, { name: "960 Series", type: "car", years: "1991-1997" }, { name: "C30", type: "car", years: "2007-2013" }, { name: "C40", type: "car", years: "2022-2024" }, { name: "C70", type: "car", years: "1998-2004,2006-2013" }, { name: "C70 / C30", type: "car", years: "2012" }, { name: "Cab Behind Engine", type: "van", years: "1986-2027" }, { name: "Cab Over Engine HT", type: "van", years: "1986-2027" }, { name: "Cab Over Engine LT", type: "van", years: "1986-2027" }, { name: "EC40", type: "car", years: "2025-2027" }, { name: "EX30", type: "car", years: "2025-2027" }, { name: "EX30 CC", type: "car", years: "2026-2027" }, { name: "EX40", type: "car", years: "2025-2027" }, { name: "EX60", type: "car", years: "2027" }, { name: "EX90", type: "car", years: "2025-2027" }, { name: "F12 w/F7 Cab", type: "van", years: "1986-2027" }, { name: "F6 w/F7 Cab", type: "van", years: "1986-2027" }, { name: "S40", type: "car", years: "1999-2011" }, { name: "S60", type: "car", years: "2001-2009,2011-2027" }, { name: "S60 Cross Country", type: "car", years: "2016-2018" }, { name: "S70", type: "car", years: "1998-2000" }, { name: "S80", type: "car", years: "1999-2016" }, { name: "S90", type: "car", years: "1998,2017-2027" }, { name: "V40", type: "car", years: "2000-2004" }, { name: "V50", type: "car", years: "2005-2011" }, { name: "V60", type: "car", years: "2015-2027" }, { name: "V60CC", type: "car", years: "2015-2027" }, { name: "V70", type: "car", years: "1998-2010" }, { name: "V90", type: "car", years: "1998,2017-2021" }, { name: "V90CC", type: "car", years: "2017-2027" }, { name: "VS", type: "van", years: "2019-2027" }, { name: "VT", type: "van", years: "2019-2027" }, { name: "XC40", type: "car", years: "2019-2027" }, { name: "XC60", type: "car", years: "2010-2027" }, { name: "XC70", type: "car", years: "2004-2016" }, { name: "XC90", type: "car", years: "2003-2014,2016-2027" }] }, { slug: "yugo", name: "YUGO", firstYear: 1985, lastYear: 2027, models: [{ name: "102, GV", type: "car", years: "1986-2027" }, { name: "Yugo 45", type: "car", years: "1985" }, { name: "Yugo 55", type: "car", years: "1985" }, { name: "Yugo 65", type: "car", years: "1985" }] }] };

// server/lib/catalog.ts
var SPAIN = [
  { name: "SEAT", type: "car", models: ["Ibiza", "Le\xF3n", "Arona", "Ateca", "Tarraco", "Toledo", "Altea", "C\xF3rdoba", "Exeo", "Mii"] },
  { name: "Cupra", type: "car", models: ["Formentor", "Le\xF3n", "Ateca", "Born", "Terramar", "Tavascan"] },
  { name: "Volkswagen", type: "car", models: ["Golf", "Polo", "Passat", "Tiguan", "T-Roc", "T-Cross", "Touran", "Arteon", "ID.3", "ID.4", "Caddy", "Transporter", "Crafter"] },
  { name: "\u0160koda", type: "car", models: ["Octavia", "Fabia", "Karoq", "Kodiaq", "Superb", "Scala", "Kamiq", "Enyaq"] },
  { name: "Dacia", type: "car", models: ["Sandero", "Duster", "Jogger", "Logan", "Spring", "Bigster"] },
  { name: "Citro\xEBn", type: "car", models: ["C3", "C3 Aircross", "C4", "C5 Aircross", "C5 X", "Berlingo", "Jumpy", "Jumper", "Ami"] },
  { name: "Opel", type: "car", models: ["Corsa", "Astra", "Mokka", "Crossland", "Grandland", "Combo", "Vivaro", "Movano"] },
  { name: "MG", type: "car", models: ["MG3", "ZS", "HS", "MG4", "MG5", "Marvel R"] },
  { name: "Renault", type: "car", models: ["Clio", "M\xE9gane", "Captur", "Kadjar", "Sc\xE9nic", "Austral", "Arkana", "Zoe", "Twingo", "Kangoo", "Trafic", "Master"] },
  { name: "Peugeot", type: "car", models: ["208", "2008", "308", "3008", "408", "5008", "508", "Partner", "Rifter", "Expert", "Boxer"] },
  { name: "Iveco", type: "van", models: ["Daily"] },
  { name: "Honda", type: "motorcycle", models: ["CB125R", "CB500F", "CB650R", "CBR600RR", "CRF300L", "Africa Twin", "Forza 125", "PCX 125", "NC750X", "Transalp"] },
  { name: "Yamaha", type: "motorcycle", models: ["MT-03", "MT-07", "MT-09", "R1", "R7", "Tracer 7", "T\xE9n\xE9r\xE9 700", "XMAX 125", "NMAX 125", "TMAX"] },
  { name: "Kawasaki", type: "motorcycle", models: ["Z650", "Z900", "Ninja 400", "Ninja 650", "Versys 650", "Vulcan S", "Eliminator"] },
  { name: "Suzuki", type: "motorcycle", models: ["GSX-S750", "GSX-R600", "V-Strom 650", "V-Strom 800", "SV650", "Burgman 125"] },
  { name: "BMW", type: "motorcycle", models: ["R 1250 GS", "F 900 R", "S 1000 RR", "G 310 R", "C 400 X", "R nineT"] },
  { name: "KTM", type: "motorcycle", models: ["Duke 125", "Duke 390", "Duke 790", "890 Adventure", "1290 Super Duke", "RC 390"] },
  { name: "Ducati", type: "motorcycle", models: ["Monster", "Panigale V2", "Panigale V4", "Multistrada", "Scrambler", "DesertX"] },
  { name: "Triumph", type: "motorcycle", models: ["Street Triple", "Speed Triple", "Bonneville", "Tiger 900", "Trident 660"] },
  { name: "Piaggio", type: "motorcycle", models: ["Vespa Primavera", "Vespa GTS", "Liberty 125", "Beverly 300", "MP3"] },
  { name: "Aprilia", type: "motorcycle", models: ["RS 660", "Tuono 660", "SR GT 125", "RSV4"] },
  { name: "SYM", type: "motorcycle", models: ["Symphony 125", "Jet 14", "Cruisym 300"] },
  { name: "Kymco", type: "motorcycle", models: ["Agility 125", "People S 125", "AK 550", "X-Town 300"] },
  { name: "Royal Enfield", type: "motorcycle", models: ["Classic 350", "Meteor 350", "Himalayan", "Interceptor 650"] },
  { name: "Harley-Davidson", type: "motorcycle", models: ["Sportster S", "Nightster", "Street Bob", "Pan America"] }
];
function slugify(name) {
  return name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}
var cache = null;
function loadCatalog() {
  if (cache) return cache;
  const merged = /* @__PURE__ */ new Map();
  {
    const external = open_vehicle_db_default;
    for (const make of external.makes) {
      merged.set(make.slug, {
        slug: make.slug,
        name: titleCase(make.name),
        models: make.models,
        sources: ["open-vehicle-db"]
      });
    }
  }
  for (const entry of SPAIN) {
    const slug = slugify(entry.name);
    const existing = merged.get(slug);
    const models = entry.models.map((name) => ({
      name,
      type: entry.type
    }));
    if (!existing) {
      merged.set(slug, { slug, name: entry.name, models, sources: ["local"] });
      continue;
    }
    const known = new Set(existing.models.map((m) => m.name.toLowerCase()));
    for (const model of models) {
      if (!known.has(model.name.toLowerCase())) {
        existing.models.push(model);
      }
    }
    existing.models.sort((a, b) => a.name.localeCompare(b.name, "es"));
    if (!existing.sources.includes("local")) existing.sources.push("local");
    existing.name = entry.name;
  }
  cache = [...merged.values()].sort((a, b) => a.name.localeCompare(b.name, "es"));
  return cache;
}
function titleCase(name) {
  return name.toLowerCase().replace(/(^|[\s\-/])([a-záéíóúñ])/g, (_, sep, ch) => sep + ch.toUpperCase());
}
function makesForType(type) {
  return loadCatalog().map((make) => ({
    ...make,
    models: make.models.filter((m) => m.type === type)
  })).filter((make) => make.models.length > 0);
}

// server/lib/vehicle-image.ts
var cache2 = /* @__PURE__ */ new Map();
var CACHE_TTL_MS = 6 * 60 * 60 * 1e3;
var MISS_TTL_MS = 24 * 60 * 60 * 1e3;
var REQUEST_TIMEOUT_MS = 6e3;
function keyOf(q) {
  return `${q.type}|${q.make}|${q.model}|${q.year}`.toLowerCase();
}
async function stockImageUrl(q) {
  const apiKey = process.env["CAR_IMAGES_API_KEY"];
  if (!apiKey) return null;
  const key = keyOf(q);
  const hit = cache2.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.url;
  const params = new URLSearchParams({
    api_key: apiKey,
    make: q.make,
    model: q.model,
    year: String(q.year),
    type: q.type === "motorcycle" ? "moto" : "car"
  });
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const res = await fetch(
      `https://carimagesapi.com/api/v1/signed-url?${params}`,
      { signal: controller.signal }
    );
    clearTimeout(timer);
    if (!res.ok) {
      cache2.set(key, { url: null, expiresAt: Date.now() + MISS_TTL_MS });
      return null;
    }
    const body = await res.json();
    const url = typeof body.url === "string" ? body.url : null;
    cache2.set(key, {
      url,
      expiresAt: Date.now() + (url ? CACHE_TTL_MS : MISS_TTL_MS)
    });
    return url;
  } catch {
    cache2.set(key, { url: null, expiresAt: Date.now() + MISS_TTL_MS });
    return null;
  }
}

// server/lib/validate.ts
var VEHICLE_TYPES = ["car", "motorcycle", "van"];
var FUEL_TYPES = ["gasoline", "diesel", "electric", "hybrid"];
var CATEGORIES = [
  "oil",
  "filters",
  "brakes",
  "tires",
  "battery",
  "coolant",
  "timing-belt",
  "inspection",
  "insurance",
  "other"
];
var MAX_PHOTO_BYTES = 3e5;
function asRecord(input) {
  return typeof input === "object" && input !== null ? input : {};
}
function str(value, max = 120) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= max ? trimmed : null;
}
function num(value, min, max) {
  if (value === null || value === void 0 || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}
function isoDate(value) {
  if (typeof value !== "string") return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
function photoOrNull(value, errors) {
  if (value === null || value === void 0 || value === "") return null;
  if (typeof value !== "string") {
    errors.push("The photo is not valid");
    return null;
  }
  if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(value)) {
    errors.push("The photo format is not supported");
    return null;
  }
  if (value.length > MAX_PHOTO_BYTES) {
    errors.push("The photo is too large");
    return null;
  }
  return value;
}
function validateVehicle(input) {
  const body = asRecord(input);
  const errors = [];
  const maxYear = (/* @__PURE__ */ new Date()).getFullYear() + 1;
  const nickname = str(body["nickname"], 60);
  const make = str(body["make"], 60);
  const model = str(body["model"], 60);
  const year = num(body["year"], 1900, maxYear);
  const mileage = num(body["mileage"], 0, 3e6);
  const type = str(body["type"], 20);
  const fuel = str(body["fuel"], 20);
  if (!nickname) errors.push("Name is required");
  if (!make) errors.push("Make is required");
  if (!model) errors.push("Model is required");
  if (year === null) errors.push(`Year must be between 1900 and ${maxYear}`);
  if (mileage === null) errors.push("Mileage must be a positive number");
  if (!type || !VEHICLE_TYPES.includes(type)) errors.push("Invalid vehicle type");
  if (!fuel || !FUEL_TYPES.includes(fuel)) errors.push("Invalid fuel type");
  const photo = photoOrNull(body["photo"], errors);
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      nickname,
      make,
      model,
      year,
      type,
      fuel,
      mileage,
      plate: str(body["plate"], 15) ?? void 0,
      monthlyMileage: num(body["monthlyMileage"], 0, 2e4) ?? void 0,
      color: str(body["color"], 30) ?? void 0,
      photo: photo ?? void 0,
      notes: str(body["notes"], 1e3) ?? void 0
    }
  };
}
function validateRecord(input) {
  const body = asRecord(input);
  const errors = [];
  const vehicleId = str(body["vehicleId"], 64);
  const title = str(body["title"], 120);
  const date = isoDate(body["date"]);
  const mileage = num(body["mileage"], 0, 3e6);
  const category = str(body["category"], 20);
  if (!vehicleId) errors.push("Vehicle is required");
  if (!title) errors.push("Title is required");
  if (!date) errors.push("Invalid date");
  if (mileage === null) errors.push("Mileage must be a positive number");
  if (!category || !CATEGORIES.includes(category)) errors.push("Invalid category");
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      vehicleId,
      category,
      title,
      date,
      mileage,
      cost: num(body["cost"], 0, 1e6) ?? void 0,
      workshop: str(body["workshop"], 80) ?? void 0,
      notes: str(body["notes"], 1e3) ?? void 0,
      planId: str(body["planId"], 64) ?? void 0
    }
  };
}
function validatePlan(input) {
  const body = asRecord(input);
  const errors = [];
  const vehicleId = str(body["vehicleId"], 64);
  const title = str(body["title"], 120);
  const category = str(body["category"], 20);
  const intervalKm = num(body["intervalKm"], 1, 5e5);
  const intervalMonths = num(body["intervalMonths"], 1, 240);
  if (!vehicleId) errors.push("Vehicle is required");
  if (!title) errors.push("Title is required");
  if (!category || !CATEGORIES.includes(category)) errors.push("Invalid category");
  if (intervalKm === null && intervalMonths === null) {
    errors.push("Set an interval in kilometres, in months, or both");
  }
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      vehicleId,
      category,
      title,
      intervalKm: intervalKm ?? void 0,
      intervalMonths: intervalMonths ?? void 0,
      lastServiceMileage: num(body["lastServiceMileage"], 0, 3e6) ?? void 0,
      lastServiceDate: isoDate(body["lastServiceDate"]) ?? void 0,
      active: body["active"] !== false,
      notes: str(body["notes"], 1e3) ?? void 0
    }
  };
}

// server/lib/router.ts
async function handleRequest(req, res) {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const method = req.method ?? "GET";
  if (path === "/api/health") {
    try {
      const pool2 = await getPool();
      await pool2.query("SELECT 1");
      json(res, 200, { status: "ok", database: true, time: (/* @__PURE__ */ new Date()).toISOString() });
    } catch (error) {
      json(res, 503, {
        status: "error",
        database: false,
        error: error.message
      });
    }
    return;
  }
  if (path === "/api/auth/register") {
    if (method !== "POST") return methodNotAllowed(res, ["POST"]);
    return handleRegister(req, res);
  }
  if (path === "/api/auth/login") {
    if (method !== "POST") return methodNotAllowed(res, ["POST"]);
    return handleLogin(req, res);
  }
  if (path === "/api/auth/logout") {
    if (method !== "POST") return methodNotAllowed(res, ["POST"]);
    return handleLogout(res);
  }
  if (path === "/api/auth/me") {
    if (method !== "GET") return methodNotAllowed(res, ["GET"]);
    return handleMe(req, res);
  }
  if (path === "/api/catalog") {
    if (method !== "GET") return methodNotAllowed(res, ["GET"]);
    const type = url.searchParams.get("type");
    const makes = type ? makesForType(type) : loadCatalog();
    res.setHeader("Cache-Control", "public, max-age=86400");
    json(res, 200, {
      count: makes.length,
      modelCount: makes.reduce((n, m) => n + m.models.length, 0),
      makes
    });
    return;
  }
  if (!path.startsWith("/api/")) {
    notFound(res);
    return;
  }
  const userId = userIdFrom(req);
  if (!userId) {
    unauthorized(res);
    return;
  }
  let body = {};
  if (method === "POST" || method === "PUT" || method === "PATCH") {
    try {
      body = await readJson(req);
    } catch (error) {
      badRequest(res, [error.message]);
      return;
    }
  }
  const segments = path.split("/").filter(Boolean).slice(1);
  const [resource, id] = segments;
  switch (resource) {
    case "garage": {
      if (method !== "GET") return methodNotAllowed(res, ["GET"]);
      const snapshot = await loadSnapshot(userId);
      await backfillStockImages(userId, snapshot.vehicles);
      json(res, 200, snapshot);
      return;
    }
    case "account":
      if (method !== "DELETE") return methodNotAllowed(res, ["DELETE"]);
      await deleteUser(userId);
      res.setHeader("Set-Cookie", "garaje_session=; Path=/; HttpOnly; Max-Age=0");
      json(res, 200, { deleted: true });
      return;
    case "vehicles":
      return handleVehicles(res, method, userId, id, body);
    case "records":
      return handleRecords(res, method, userId, id, body);
    case "plans":
      return handlePlans(res, method, userId, id, body);
    default:
      notFound(res);
  }
}
async function handleVehicles(res, method, userId, id, body) {
  if (!id) {
    if (method !== "POST") return methodNotAllowed(res, ["POST"]);
    const parsed = validateVehicle(body);
    if (!parsed.ok) return badRequest(res, parsed.errors);
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const vehicle = {
      ...parsed.value,
      id: newId(),
      userId,
      stockImage: await stockImageUrl(parsed.value) ?? void 0,
      mileageUpdatedAt: now,
      createdAt: now
    };
    await upsert("vehicles", userId, vehicle.id, vehicle);
    json(res, 201, vehicle);
    return;
  }
  const existing = await findById("vehicles", userId, id);
  if (!existing) return notFound(res);
  if (method === "GET") {
    json(res, 200, existing);
    return;
  }
  if (method === "PUT") {
    const parsed = validateVehicle(body);
    if (!parsed.ok) return badRequest(res, parsed.errors);
    const identityChanged = parsed.value.make !== existing.make || parsed.value.model !== existing.model || parsed.value.year !== existing.year || parsed.value.type !== existing.type;
    const updated = {
      ...existing,
      ...parsed.value,
      stockImage: identityChanged ? await stockImageUrl(parsed.value) ?? void 0 : existing.stockImage,
      mileageUpdatedAt: parsed.value.mileage !== existing.mileage ? (/* @__PURE__ */ new Date()).toISOString() : existing.mileageUpdatedAt
    };
    await upsert("vehicles", userId, id, updated);
    json(res, 200, updated);
    return;
  }
  if (method === "DELETE") {
    await removeVehicleCascade(userId, id);
    json(res, 200, { deleted: id });
    return;
  }
  methodNotAllowed(res, ["GET", "PUT", "DELETE"]);
}
async function handleRecords(res, method, userId, id, body) {
  if (!id) {
    if (method !== "POST") return methodNotAllowed(res, ["POST"]);
    const parsed = validateRecord(body);
    if (!parsed.ok) return badRequest(res, parsed.errors);
    const vehicle = await findById("vehicles", userId, parsed.value.vehicleId);
    if (!vehicle) return badRequest(res, ["El veh\xEDculo no existe"]);
    const record = {
      ...parsed.value,
      id: newId(),
      userId,
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    await upsert("records", userId, record.id, record, record.vehicleId);
    if (record.mileage > vehicle.mileage) {
      await upsert("vehicles", userId, vehicle.id, {
        ...vehicle,
        mileage: record.mileage,
        mileageUpdatedAt: record.date
      });
    }
    if (record.planId) {
      const plan = await findById("plans", userId, record.planId);
      if (plan) {
        await upsert("plans", userId, plan.id, {
          ...plan,
          lastServiceMileage: record.mileage,
          lastServiceDate: record.date
        }, plan.vehicleId);
      }
    }
    json(res, 201, record);
    return;
  }
  if (method === "DELETE") {
    const deleted = await remove("records", userId, id);
    if (!deleted) return notFound(res);
    json(res, 200, { deleted: id });
    return;
  }
  methodNotAllowed(res, ["POST", "DELETE"]);
}
async function handlePlans(res, method, userId, id, body) {
  if (!id) {
    if (method !== "POST") return methodNotAllowed(res, ["POST"]);
    const parsed = validatePlan(body);
    if (!parsed.ok) return badRequest(res, parsed.errors);
    const vehicle = await findById("vehicles", userId, parsed.value.vehicleId);
    if (!vehicle) return badRequest(res, ["El veh\xEDculo no existe"]);
    const plan = {
      ...parsed.value,
      id: newId(),
      userId,
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    await upsert("plans", userId, plan.id, plan, plan.vehicleId);
    json(res, 201, plan);
    return;
  }
  const existing = await findById("plans", userId, id);
  if (!existing) return notFound(res);
  if (method === "PUT") {
    const parsed = validatePlan(body);
    if (!parsed.ok) return badRequest(res, parsed.errors);
    const updated = { ...existing, ...parsed.value };
    await upsert("plans", userId, id, updated, updated.vehicleId);
    json(res, 200, updated);
    return;
  }
  if (method === "DELETE") {
    await remove("plans", userId, id);
    json(res, 200, { deleted: id });
    return;
  }
  methodNotAllowed(res, ["PUT", "DELETE"]);
}
async function backfillStockImages(userId, vehicles) {
  const pending = vehicles.filter((v) => !v.stockImage);
  if (!pending.length) return;
  await Promise.all(
    pending.map(async (vehicle) => {
      const url = await stockImageUrl(vehicle);
      if (!url) return;
      vehicle.stockImage = url;
      await upsert("vehicles", userId, vehicle.id, vehicle);
    })
  );
}

// server/entry/vercel.ts
function originalPath(req) {
  const header = req.headers["x-vercel-original-path"];
  const value = Array.isArray(header) ? header[0] : header;
  return value || req.url || "/";
}
async function handler(req, res) {
  req.url = originalPath(req);
  try {
    await handleRequest(req, res);
  } catch (error) {
    console.error("Unhandled error:", error);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
    }
    res.end(JSON.stringify({ error: "Internal server error" }));
  }
}
export {
  handler as default
};
