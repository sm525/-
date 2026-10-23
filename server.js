import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import pg from "pg";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { Pool } = pg;
const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "..", "public");
const port = Number(process.env.PORT || 3000);

if (!process.env.DATABASE_URL) {
  console.error("Missing DATABASE_URL. Copy .env.example to .env and configure it.");
  process.exit(1);
}
if (!process.env.ADMIN_API_KEY || process.env.ADMIN_API_KEY.length < 24) {
  console.error("ADMIN_API_KEY must be configured with a long secret (at least 24 characters).");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === "true" ? { rejectUnauthorized: true } : false
});

app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(",").map(s => s.trim())
    : false
}));
app.use(express.json({ limit: "1mb" }));
app.use(express.static(publicDir));

function safeEqual(a, b) {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

function requireAdmin(req, res, next) {
  const header = req.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token || !safeEqual(token, process.env.ADMIN_API_KEY)) {
    return res.status(401).json({ error: "Admin authorization required." });
  }
  next();
}

function validId(id) {
  return typeof id === "string" && /^[a-z0-9][a-z0-9-]{1,79}$/.test(id);
}
function cleanText(value, max = 20000) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return null;
  return value.trim().slice(0, max);
}
function normalizeCharacter(body) {
  const allowedElements = ["Aero", "Glacio", "Electro", "Fusion", "Havoc", "Spectro"];
  const allowedWeapons = ["Sword", "Broadblade", "Pistols", "Gauntlets", "Rectifier"];
  const allowedStatuses = ["needs_review", "partially_verified", "verified"];
  const element = body.element || null;
  const weapon_type = body.weapon_type || null;
  const rarity = body.rarity == null ? null : Number(body.rarity);
  const verification_status = body.verification_status || "needs_review";

  if (element && !allowedElements.includes(element)) throw new Error("Invalid element.");
  if (weapon_type && !allowedWeapons.includes(weapon_type)) throw new Error("Invalid weapon_type.");
  if (rarity !== null && ![4, 5].includes(rarity)) throw new Error("rarity must be 4, 5, or null.");
  if (!allowedStatuses.includes(verification_status)) throw new Error("Invalid verification_status.");
  if (typeof body.official_name !== "string" || !body.official_name.trim()) {
    throw new Error("official_name is required.");
  }

  const loc = body.localizations || {};
  return {
    official_name: body.official_name.trim().slice(0, 160),
    element, weapon_type, rarity,
    debut_version: cleanText(body.debut_version, 40),
    playable: body.playable !== false,
    verification_status,
    localizations: {
      en: {
        display_name: cleanText(loc.en?.display_name, 160),
        short_description: cleanText(loc.en?.short_description, 1000),
        full_description: cleanText(loc.en?.full_description, 20000)
      },
      ar: {
        display_name: cleanText(loc.ar?.display_name, 160),
        short_description: cleanText(loc.ar?.short_description, 1000),
        full_description: cleanText(loc.ar?.full_description, 20000)
      }
    }
  };
}

async function getCharacter(id) {
  const charResult = await pool.query(
    `SELECT id, official_name, element, weapon_type, rarity, debut_version, playable,
            verification_status, created_at, updated_at
     FROM characters WHERE id = $1`, [id]
  );
  if (!charResult.rowCount) return null;
  const character = charResult.rows[0];

  const [locs, stats, skills, sources, media] = await Promise.all([
    pool.query(`SELECT locale, display_name, short_description, full_description
                FROM character_localizations WHERE character_id = $1 ORDER BY locale`, [id]),
    pool.query(`SELECT level, hp, atk, def, max_energy, other_stats
                FROM character_stats WHERE character_id = $1 ORDER BY level`, [id]),
    pool.query(`SELECT id, official_name, skill_type, display_order, description_en, description_ar, source_id
                FROM skills WHERE character_id = $1 ORDER BY display_order, id`, [id]),
    pool.query(`SELECT id, source_url, publisher, source_type, checked_at, notes, is_official
                FROM sources WHERE character_id = $1 ORDER BY id`, [id]),
    pool.query(`SELECT id, asset_type, asset_url, source_id, permission_status, alt_en, alt_ar
                FROM media_assets WHERE character_id = $1 ORDER BY id`, [id])
  ]);
  character.localizations = Object.fromEntries(locs.rows.map(r => [r.locale, {
    display_name: r.display_name,
    short_description: r.short_description,
    full_description: r.full_description
  }]));
  character.stats = stats.rows;
  character.skills = skills.rows;
  character.sources = sources.rows;
  character.media_assets = media.rows;
  return character;
}

app.get("/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true, database: "connected" });
  } catch {
    res.status(503).json({ ok: false, database: "unavailable" });
  }
});

app.get("/api/characters", async (req, res, next) => {
  try {
    const q = cleanText(req.query.q, 100);
    const element = cleanText(req.query.element, 20);
    const weapon = cleanText(req.query.weapon, 20);
    const rarity = req.query.rarity ? Number(req.query.rarity) : null;
    const params = [];
    const where = [];
    if (q) { params.push(`%${q}%`); where.push(`(c.official_name ILIKE $${params.length} OR EXISTS (
      SELECT 1 FROM character_localizations l WHERE l.character_id = c.id
      AND (l.display_name ILIKE $${params.length} OR l.short_description ILIKE $${params.length})
    ))`); }
    if (element) { params.push(element); where.push(`c.element = $${params.length}`); }
    if (weapon) { params.push(weapon); where.push(`c.weapon_type = $${params.length}`); }
    if (rarity && [4, 5].includes(rarity)) { params.push(rarity); where.push(`c.rarity = $${params.length}`); }
    const sql = `SELECT c.id, c.official_name, c.element, c.weapon_type, c.rarity,
      c.debut_version, c.playable, c.verification_status,
      COALESCE((SELECT jsonb_object_agg(l.locale, jsonb_build_object(
        'display_name', l.display_name, 'short_description', l.short_description
      )) FROM character_localizations l WHERE l.character_id = c.id), '{}'::jsonb) AS localizations,
      (SELECT m.asset_url FROM media_assets m WHERE m.character_id = c.id AND m.asset_type IN ('portrait','icon')
       ORDER BY CASE m.asset_type WHEN 'portrait' THEN 0 ELSE 1 END, m.id LIMIT 1) AS image_url
      FROM characters c ${where.length ? "WHERE " + where.join(" AND ") : ""}
      ORDER BY c.official_name ASC LIMIT 250`;
    const result = await pool.query(sql, params);
    res.json({ count: result.rowCount, characters: result.rows });
  } catch (err) { next(err); }
});

app.get("/api/characters/:id", async (req, res, next) => {
  try {
    const character = await getCharacter(req.params.id);
    if (!character) return res.status(404).json({ error: "Character not found." });
    res.json(character);
  } catch (err) { next(err); }
});

app.post("/api/characters", requireAdmin, async (req, res, next) => {
  const client = await pool.connect();
  try {
    if (!validId(req.body.id)) return res.status(400).json({ error: "id must be a lowercase slug (letters, numbers, hyphens)." });
    const data = normalizeCharacter(req.body);
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO characters (id, official_name, element, weapon_type, rarity, debut_version, playable, verification_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [req.body.id, data.official_name, data.element, data.weapon_type, data.rarity,
       data.debut_version, data.playable, data.verification_status]
    );
    for (const locale of ["en", "ar"]) {
      const l = data.localizations[locale];
      if (l.display_name || l.short_description || l.full_description) {
        await client.query(
          `INSERT INTO character_localizations (character_id, locale, display_name, short_description, full_description)
           VALUES ($1,$2,$3,$4,$5)`,
          [req.body.id, locale, l.display_name, l.short_description, l.full_description]
        );
      }
    }
    await client.query(
      `INSERT INTO change_logs (character_id, action, change_summary) VALUES ($1, 'create', $2::jsonb)`,
      [req.body.id, JSON.stringify({ official_name: data.official_name })]
    );
    await client.query("COMMIT");
    res.status(201).json(await getCharacter(req.body.id));
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    if (err.code === "23505") return res.status(409).json({ error: "A character with this id already exists." });
    if (err instanceof Error && !err.code) return res.status(400).json({ error: err.message });
    next(err);
  } finally { client.release(); }
});

app.patch("/api/characters/:id", requireAdmin, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const existing = await client.query("SELECT id FROM characters WHERE id = $1", [req.params.id]);
    if (!existing.rowCount) return res.status(404).json({ error: "Character not found." });
    const current = await getCharacter(req.params.id);
    const merged = {
      ...current,
      ...req.body,
      id: req.params.id,
      localizations: {
        en: { ...(current.localizations?.en || {}), ...(req.body.localizations?.en || {}) },
        ar: { ...(current.localizations?.ar || {}), ...(req.body.localizations?.ar || {}) }
      }
    };
    const data = normalizeCharacter(merged);
    await client.query("BEGIN");
    await client.query(
      `UPDATE characters SET official_name=$2, element=$3, weapon_type=$4, rarity=$5,
       debut_version=$6, playable=$7, verification_status=$8, updated_at=NOW() WHERE id=$1`,
      [req.params.id, data.official_name, data.element, data.weapon_type, data.rarity,
       data.debut_version, data.playable, data.verification_status]
    );
    for (const locale of ["en", "ar"]) {
      const l = data.localizations[locale];
      await client.query(
        `INSERT INTO character_localizations (character_id, locale, display_name, short_description, full_description)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (character_id, locale) DO UPDATE SET
         display_name=EXCLUDED.display_name, short_description=EXCLUDED.short_description,
         full_description=EXCLUDED.full_description`,
        [req.params.id, locale, l.display_name, l.short_description, l.full_description]
      );
    }
    await client.query(
      `INSERT INTO change_logs (character_id, action, change_summary) VALUES ($1, 'update', $2::jsonb)`,
      [req.params.id, JSON.stringify({ fields: Object.keys(req.body) })]
    );
    await client.query("COMMIT");
    res.json(await getCharacter(req.params.id));
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    if (err instanceof Error && !err.code) return res.status(400).json({ error: err.message });
    next(err);
  } finally { client.release(); }
});

app.delete("/api/characters/:id", requireAdmin, async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query("DELETE FROM characters WHERE id=$1 RETURNING id", [req.params.id]);
    if (!result.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Character not found." });
    }
    await client.query(
      `INSERT INTO change_logs (character_id, action, change_summary) VALUES ($1, 'delete', $2::jsonb)`,
      [req.params.id, JSON.stringify({ deleted: true })]
    );
    await client.query("COMMIT");
    res.json({ deleted: true, id: req.params.id });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    next(err);
  } finally { client.release(); }
});

app.get("/", (_req, res) => res.sendFile(path.join(publicDir, "index.html")));
app.get("/admin", (_req, res) => res.sendFile(path.join(publicDir, "admin.html")));

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error." });
});

const server = app.listen(port, () => console.log(`Resonance Archive API listening on port ${port}`));
async function shutdown() {
  server.close();
  await pool.end();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
