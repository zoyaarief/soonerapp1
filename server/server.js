// server/server.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import bcrypt from "bcrypt";
import session from "express-session";
import MongoStore from "connect-mongo";
import { connectToDb, getDb, getClient } from "./db.js";
import path from "path";
import { fileURLToPath } from "url";
import { ObjectId } from "mongodb";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || "dev-secret";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---- Static (serves /public)
app.use(express.static(path.join(__dirname, "..", "public")));

// ---- CORS (adjust origin to where your frontend is served)
app.use(cors({ origin: "http://localhost:5173", credentials: true }));

// ---- JSON body (allow base64 images)
app.use(express.json({ limit: "50mb" }));

// ---- Sessions (Mongo-backed)
app.use(
  session({
    name: "sooner.sid",
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
      mongoUrl: process.env.MONGODB_URI,
      dbName: process.env.DB_NAME,
      collectionName: "sessions",
      ttl: 60 * 60 * 8, // 8 hours
      crypto: { secret: SESSION_SECRET.slice(0, 32) },
    }),
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: false, // set true behind HTTPS in prod
      maxAge: 1000 * 60 * 60 * 8,
    },
  })
);

// ---- Health
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// ---- Auth guard helper
function requireOwner(req, res, next) {
  if (req.session?.ownerId) return next();
  return res.status(401).json({ error: "Not authenticated" });
}

// ---- SSE helpers (for live queue stream) — includes credentials-friendly CORS
function sseSetup(req, res) {
  const origin = req.headers.origin || "http://localhost:5173";
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.flushHeaders?.();
}
function sseSend(res, event, dataObj) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(dataObj)}\n\n`);
}

// ===================== SETTINGS (owner_settings + legacy settings) =====================

// Robust loader: prefer existing; if none exists anywhere, create exactly once (no churn on toggles)
async function loadOrInitSettings(ownerId) {
  const db = getDb();
  const SettingsNew = db.collection("owner_settings");
  const SettingsLegacy = db.collection("settings");

  let asObjId = null;
  try {
    asObjId = new ObjectId(String(ownerId));
  } catch {}

  const found =
    (asObjId && (await SettingsNew.findOne({ ownerId: asObjId }))) ||
    (await SettingsNew.findOne({ ownerId: String(ownerId) })) ||
    (await SettingsLegacy.findOne({ ownerId: String(ownerId) }));

  if (found) {
    return {
      _id: found._id,
      ownerId: found.ownerId,
      walkinsEnabled: !!found.walkinsEnabled,
      openStatus: found.openStatus === "open" ? "open" : "closed",
      queueActive: found.queueActive !== false,
      updatedAt: found.updatedAt || new Date(),
    };
  }

  // Initialize exactly once (one doc in owner_settings [ObjectId] and one in legacy [string])
  const base = {
    walkinsEnabled: false,
    openStatus: "closed",
    queueActive: true,
    updatedAt: new Date(),
  };

  const newDoc = { ...base, ownerId: asObjId || new ObjectId(String(ownerId)) };
  const legacyDoc = { ...base, ownerId: String(ownerId) };

  await SettingsNew.updateOne(
    { ownerId: newDoc.ownerId },
    { $setOnInsert: newDoc },
    { upsert: true }
  );
  await SettingsLegacy.updateOne(
    { ownerId: legacyDoc.ownerId },
    { $setOnInsert: legacyDoc },
    { upsert: true }
  );

  return { ...base, ownerId: newDoc.ownerId };
}

// UPDATE WITHOUT UPSERTS — no accidental new rows on stop/restart toggles
async function updateSettings(ownerId, patch) {
  const db = getDb();
  const SettingsNew = db.collection("owner_settings");
  const SettingsLegacy = db.collection("settings");

  let asObjId = null;
  try {
    asObjId = new ObjectId(String(ownerId));
  } catch {}

  const normalized = {};
  if ("walkinsEnabled" in patch)
    normalized.walkinsEnabled = !!patch.walkinsEnabled;
  if ("queueActive" in patch) normalized.queueActive = !!patch.queueActive;
  if ("openStatus" in patch) {
    const v = String(patch.openStatus || "").toLowerCase();
    normalized.openStatus = v === "open" ? "open" : "closed";
  }
  normalized.updatedAt = new Date();

  // Try to update existing docs only (no upserts)
  const results = [];

  if (asObjId) {
    results.push(
      await SettingsNew.updateOne(
        { ownerId: asObjId },
        { $set: normalized },
        { upsert: false }
      )
    );
  }
  results.push(
    await SettingsNew.updateOne(
      { ownerId: String(ownerId) },
      { $set: normalized },
      { upsert: false }
    )
  );
  results.push(
    await SettingsLegacy.updateOne(
      { ownerId: String(ownerId) },
      { $set: normalized },
      { upsert: false }
    )
  );

  const matched = results.reduce((a, r) => a + (r?.matchedCount || 0), 0);

  // If nothing existed yet, initialize once and retry updates (still without upsert)
  if (matched === 0) {
    await loadOrInitSettings(ownerId);
    const again = [];
    if (asObjId) {
      again.push(
        await SettingsNew.updateOne(
          { ownerId: asObjId },
          { $set: normalized },
          { upsert: false }
        )
      );
    }
    again.push(
      await SettingsNew.updateOne(
        { ownerId: String(ownerId) },
        { $set: normalized },
        { upsert: false }
      )
    );
    again.push(
      await SettingsLegacy.updateOne(
        { ownerId: String(ownerId) },
        { $set: normalized },
        { upsert: false }
      )
    );
  }

  // Return canonical (prefer ObjectId row if present)
  const doc =
    (asObjId && (await SettingsNew.findOne({ ownerId: asObjId }))) ||
    (await SettingsNew.findOne({ ownerId: String(ownerId) })) ||
    (await SettingsLegacy.findOne({ ownerId: String(ownerId) }));

  return doc;
}

// ===================== QUEUE helpers =====================

// Scope queue docs for the logged-in owner: venueId==owner._id OR restaurantId==owner._id
async function buildQueueFilterForOwner(req) {
  const db = getDb();
  const owner = await db
    .collection("owners")
    .findOne(
      { _id: new ObjectId(req.session.ownerId) },
      { projection: { _id: 1 } }
    );

  if (!owner?._id) return { _id: { $exists: false } };

  const ownerIdObj = owner._id;
  const ownerIdStr = String(owner._id);

  return {
    $or: [
      { venueId: ownerIdObj },
      { venueId: ownerIdStr },
      { restaurantId: ownerIdObj },
      { restaurantId: ownerIdStr },
    ],
  };
}

// Recompute sequential positions (1..N) for the current owner's queue
async function recomputePositionsForOwner(req) {
  const db = getDb();
  const Queue = db.collection("queue");
  const filter = await buildQueueFilterForOwner(req);

  const docs = await Queue.find(filter).sort({ joinedAt: 1, _id: 1 }).toArray();
  if (!docs.length) return;

  const ops = docs.map((doc, idx) => ({
    updateOne: {
      filter: { _id: doc._id },
      update: { $set: { position: idx + 1 } },
    },
  }));

  if (ops.length) {
    await Queue.bulkWrite(ops, { ordered: false });
  }
}

// ===== NEW: sequential-fit capacity calculators (server-wide truth) =====

// Owner-context: compute capacity using sequential fit
async function computeSpotsLeftForOwner(req) {
  const db = getDb();
  const Owners = db.collection("owners");
  const Queue = db.collection("queue");
  const ownerId = new ObjectId(req.session.ownerId);

  const owner = await Owners.findOne(
    { _id: ownerId },
    { projection: { "profile.totalSeats": 1 } }
  );
  const totalSeats = Number(owner?.profile?.totalSeats || 0);

  const filter = await buildQueueFilterForOwner(req);
  const items = await Queue.find(filter)
    .sort({ position: 1, joinedAt: 1 })
    .project({ partySize: 1 })
    .toArray();

  let used = 0;
  for (const it of items) {
    const size = Number(it.partySize) || 0;
    if (used + size <= totalSeats) used += size;
    else break;
  }
  const left = totalSeats > 0 ? Math.max(totalSeats - used, 0) : Infinity;
  return { totalSeats, used, left };
}

// Public-context (by ownerId): compute capacity using sequential fit
function buildQueueFilterForTargetId(targetId) {
  let asObjId = null;
  try {
    asObjId = new ObjectId(String(targetId));
  } catch {}
  const clauses = [];
  if (asObjId) clauses.push({ venueId: asObjId }, { restaurantId: asObjId });
  clauses.push(
    { venueId: String(targetId) },
    { restaurantId: String(targetId) }
  );
  return { $or: clauses };
}

// Legacy public settings reader (kept)
async function getOwnerSettings(db, ownerId) {
  const Settings = db.collection("settings");
  const doc = await Settings.findOne({ ownerId: String(ownerId) });
  return {
    walkinsEnabled: !!doc?.walkinsEnabled,
    openStatus: doc?.openStatus === "open" ? "open" : "closed",
    queueActive: doc?.queueActive !== false, // default true
  };
}

// NEW: compute sequential capacity for public/atomic paths
async function computeSpotsLeftForOwnerById(db, ownerId, session = null) {
  const Owners = db.collection("owners");
  const Queue = db.collection("queue");

  const owner = await Owners.findOne(
    { _id: new ObjectId(String(ownerId)) },
    { projection: { "profile.totalSeats": 1 }, session }
  );
  const totalSeats = Number(owner?.profile?.totalSeats || 0);

  const filter = buildQueueFilterForTargetId(ownerId);
  const items = await Queue.find(filter, { session })
    .sort({ position: 1, joinedAt: 1 })
    .project({ partySize: 1 })
    .toArray();

  let used = 0;
  for (const it of items) {
    const size = Number(it.partySize) || 0;
    if (used + size <= totalSeats) used += size;
    else break;
  }
  const spotsLeft = totalSeats > 0 ? Math.max(totalSeats - used, 0) : Infinity;
  return { totalSeats, seatsUsed: used, spotsLeft };
}

// Next position for a given owner scope
async function computeNextPosition(db, ownerId, session = null) {
  const Queue = db.collection("queue");
  const filter = buildQueueFilterForTargetId(ownerId);
  const last = await Queue.find(filter, { session })
    .sort({ position: -1 })
    .limit(1)
    .toArray();
  return (last[0]?.position || 0) + 1;
}

/**
 * Atomically enqueue with sequential-fit capacity enforcement.
 * Uses a transaction when possible; otherwise safe fallback.
 */
async function enqueueWithCapacity(ownerId, payload) {
  const client = getClient();
  const db = getDb();
  const Queue = db.collection("queue");

  const tryTxn = async () => {
    const session = client.startSession();
    try {
      let insertedId = null,
        position = null,
        capacityAfter = null;

      await session.withTransaction(async () => {
        // 1) Sequential-fit capacity check (inside txn)
        const { spotsLeft } = await computeSpotsLeftForOwnerById(
          db,
          ownerId,
          session
        );
        const psize = Number(payload.partySize || 0);
        if (Number.isFinite(spotsLeft) && psize > spotsLeft) {
          const err = new Error("CAPACITY_BLOCK");
          err.code = "CAPACITY_BLOCK";
          throw err; // abort tx
        }

        // 2) Compute position (inside txn)
        position = await computeNextPosition(db, ownerId, session);

        // 3) Insert
        const res = await Queue.insertOne(
          { ...payload, position },
          { session }
        );
        insertedId = res.insertedId;

        // 4) Capacity after insert (inside txn)
        capacityAfter = await computeSpotsLeftForOwnerById(
          db,
          ownerId,
          session
        );
      });

      return {
        ok: true,
        id: String(insertedId),
        position,
        capacity: capacityAfter,
      };
    } finally {
      await session.endSession();
    }
  };

  try {
    return await tryTxn();
  } catch (e) {
    // Fallback for standalone dev Mongo (no transactions)
    if (
      e?.codeName === "NoSuchTransaction" ||
      /Transaction numbers are only allowed/.test(String(e)) ||
      e?.code === 20
    ) {
      const { spotsLeft } = await computeSpotsLeftForOwnerById(db, ownerId);
      const psize = Number(payload.partySize || 0);
      if (Number.isFinite(spotsLeft) && psize > spotsLeft) {
        return {
          ok: false,
          error: "Not enough spots left",
          capacity: await computeSpotsLeftForOwnerById(db, ownerId),
        };
      }
      const position = await computeNextPosition(db, ownerId);
      const res = await Queue.insertOne({ ...payload, position });
      const capacity = await computeSpotsLeftForOwnerById(db, ownerId);
      return { ok: true, id: String(res.insertedId), position, capacity };
    }

    if (e?.code === "CAPACITY_BLOCK") {
      return {
        ok: false,
        error: "Not enough spots left",
        capacity: await computeSpotsLeftForOwnerById(db, ownerId),
      };
    }
    throw e;
  }
}

// ===================== Auth =====================
app.post("/api/owners", async (req, res) => {
  try {
    const db = getDb();
    const Owners = db.collection("owners");

    const { manager, business, type, phone, email, password } = req.body || {};
    const valid =
      typeof manager === "string" &&
      typeof business === "string" &&
      typeof type === "string" &&
      typeof phone === "string" &&
      typeof email === "string" &&
      typeof password === "string" &&
      manager.trim() &&
      business.trim() &&
      type.trim() &&
      phone.trim() &&
      email.trim() &&
      password.length >= 8;

    if (!valid) return res.status(400).json({ error: "Invalid payload" });

    const passwordHash = await bcrypt.hash(password, 10);
    const doc = {
      manager: manager.trim(),
      business: business.trim(),
      type: type.trim(),
      phone: phone.trim(),
      email: email.trim().toLowerCase(),
      passwordHash,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await Owners.insertOne(doc);

    req.session.regenerate((err) => {
      if (err) return res.status(500).json({ error: "Session error" });
      req.session.ownerId = String(result.insertedId);
      req.session.business = doc.business;
      req.session.save((err2) => {
        if (err2) return res.status(500).json({ error: "Session save error" });
        return res.status(201).json({
          ok: true,
          ownerId: result.insertedId,
          business: doc.business,
        });
      });
    });
  } catch (err) {
    if (err?.code === 11000) {
      return res.status(409).json({ error: "Email already exists" });
    }
    console.error("Create owner error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/owners/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email?.trim() || typeof password !== "string" || password.length < 8) {
      return res.status(400).json({ error: "Missing email/password" });
    }

    const db = getDb();
    const owner = await db.collection("owners").findOne({
      email: email.trim().toLowerCase(),
    });
    if (!owner) return res.status(401).json({ error: "Invalid credentials" });

    const ok = await bcrypt.compare(password, owner.passwordHash || "");
    if (!ok) return res.status(401).json({ error: "Invalid credentials" });

    req.session.regenerate((err) => {
      if (err) return res.status(500).json({ error: "Session error" });
      req.session.ownerId = String(owner._id);
      req.session.business = owner.business;
      req.session.save((err2) => {
        if (err2) return res.status(500).json({ error: "Session save error" });
        res.json({ ok: true, business: owner.business });
      });
    });
  } catch (e) {
    console.error("Login error:", e);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/api/session", (req, res) => {
  if (req.session?.ownerId) {
    return res.json({
      ok: true,
      ownerId: req.session.ownerId,
      business: req.session.business,
    });
  }
  return res.status(401).json({ ok: false, error: "Not authenticated" });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("sooner.sid");
    res.json({ ok: true });
  });
});

// ===================== Owner profile =====================
app.get("/api/owners/me", requireOwner, async (req, res) => {
  try {
    const db = getDb();
    const owner = await db
      .collection("owners")
      .findOne(
        { _id: new ObjectId(req.session.ownerId) },
        { projection: { passwordHash: 0 } }
      );
    if (!owner) return res.status(404).json({ error: "Owner not found" });

    res.json({
      ok: true,
      ownerId: String(owner._id),
      manager: owner.manager,
      business: owner.business,
      type: owner.type,
      phone: owner.phone,
      email: owner.email,
      profile: owner.profile || null,
      venueId: owner.venueId || owner?.profile?.venueId || null,
      restaurantId: owner.restaurantId || null,
    });
  } catch (e) {
    console.error("GET /api/owners/me error:", e);
    res.status(500).json({ error: "Server error" });
  }
});

app.put("/api/owners/me", requireOwner, async (req, res) => {
  try {
    const db = getDb();
    const Owners = db.collection("owners");

    const {
      displayName,
      description,
      cuisine,
      approxPrice,
      waitTime,
      totalSeats,
      maxBooking,
      location,
      openTime,
      closeTime,
      features,
      avatar, // data URL
      gallery, // array of data URLs
      venueId,
      restaurantId,
    } = req.body || {};

    if (gallery && !Array.isArray(gallery)) {
      return res.status(400).json({ error: "gallery must be an array" });
    }

    const profile = {
      displayName: (displayName || "").trim(),
      description: (description || "").trim(),
      cuisine: (cuisine || "").trim(),
      approxPrice: (approxPrice || "").trim(),
      waitTime: Number(waitTime) || 0,
      totalSeats: Number(totalSeats) || 0,
      maxBooking: Number(maxBooking) || 0,
      location: (location || "").trim(),
      openTime: (openTime || "").trim(),
      closeTime: (closeTime || "").trim(),
      features: (features || "").trim(),
      avatar: avatar || "",
      gallery: gallery || [],
      updatedAt: new Date(),
      venueId: venueId || undefined,
    };

    const update = {
      $set: { profile, updatedAt: new Date() },
    };
    if (profile.displayName) update.$set.business = profile.displayName;
    if (venueId) update.$set.venueId = venueId;
    if (restaurantId) update.$set.restaurantId = restaurantId;

    const result = await Owners.updateOne(
      { _id: new ObjectId(req.session.ownerId) },
      update
    );

    if (profile.displayName) req.session.business = profile.displayName;

    res.json({ ok: true, modifiedCount: result.modifiedCount });
  } catch (e) {
    console.error("PUT /api/owners/me error:", e);
    res.status(500).json({ error: "Server error" });
  }
});

// ===================== Announcements =====================
// =====================
// =====================
// Announcements API — schema-adaptive (handles validator 121)
// =====================

function ownerIdQueryVariants(ownerId) {
  const variants = [];
  const asStr = String(ownerId);

  // ownerId (ObjectId / string)
  try {
    variants.push({ ownerId: new ObjectId(asStr) });
  } catch {}
  variants.push({ ownerId: asStr });

  // ownerIdObj (ObjectId / string)
  try {
    variants.push({ ownerIdObj: new ObjectId(asStr) });
  } catch {}
  variants.push({ ownerIdObj: asStr });

  // venueId (ObjectId / string)  <-- NEW so GET can see newly inserted docs
  try {
    variants.push({ venueId: new ObjectId(asStr) });
  } catch {}
  variants.push({ venueId: asStr });

  return variants;
}

/**
 * Given a Mongo 121 error (Document failed validation), try to infer what's
 * required by the collection's $jsonSchema and produce a new candidate doc.
 */
function adaptAnnouncementDocForValidator(err, baseDoc, sessionOwnerId) {
  const info = err?.errInfo || err?.errorResponse?.errInfo;
  const rules = info?.details?.schemaRulesNotSatisfied || [];

  let next = { ...baseDoc };

  // What the schema seems to require
  let requireObjectIdOwner = null; // for ownerId
  let requireStringOwner = null;
  let requireOwnerIdObj = false; // separate flag for ownerIdObj
  let ownerIdObjMustBeObjectId = null;

  let requireMessageField = false;
  let requireTitleField = false;
  let requireContentField = false; // NEW: some schemas use 'content'
  let requireTypeField = false;
  let requireUpdatedAt = false;
  let requireStatus = false; // NEW
  let requireIsActive = false; // NEW

  // If 'type' has enum, capture allowed values
  let typeEnumValues = null;

  for (const r of rules) {
    const name = r?.operatorName;

    if (name === "required") {
      const reqs = r?.details?.missingProperties || r?.missingProperties || [];
      for (const prop of reqs) {
        if (prop === "message") requireMessageField = true;
        if (prop === "title") requireTitleField = true;
        if (prop === "content") requireContentField = true; // NEW
        if (prop === "type") requireTypeField = true;
        if (prop === "updatedAt") requireUpdatedAt = true;
        if (prop === "status") requireStatus = true; // NEW
        if (prop === "isActive") requireIsActive = true; // NEW
        if (prop === "ownerIdObj") requireOwnerIdObj = true;
      }
    }

    if (name === "properties") {
      const props = r?.details?.propertiesNotSatisfied || [];
      for (const p of props) {
        const propName = p?.propertyName;
        const inner = p?.details || [];

        if (propName === "ownerId") {
          for (const i of inner) {
            if (i?.operatorName === "bsonType") {
              const expected = i?.specifiedAs?.bsonType || i?.bsonType;
              if (expected === "objectId") {
                requireObjectIdOwner = true;
                requireStringOwner = false;
              } else if (expected === "string") {
                requireStringOwner = true;
                requireObjectIdOwner = false;
              }
            }
          }
        }

        if (propName === "ownerIdObj") {
          requireOwnerIdObj = true;
          for (const i of inner) {
            if (i?.operatorName === "bsonType") {
              const expected = i?.specifiedAs?.bsonType || i?.bsonType;
              if (expected === "objectId") ownerIdObjMustBeObjectId = true;
              else if (expected === "string") ownerIdObjMustBeObjectId = false;
            }
          }
        }

        if (propName === "type") {
          for (const i of inner) {
            if (i?.operatorName === "enum") {
              const vals = i?.specifiedAs?.enum || i?.allowedValues || i?.enum;
              if (Array.isArray(vals) && vals.length) typeEnumValues = vals;
            }
          }
        }
      }
    }
  }

  // Apply inferred ownerId shape
  if (requireObjectIdOwner === true) {
    try {
      next.ownerId = new ObjectId(String(sessionOwnerId));
    } catch {}
  } else if (requireStringOwner === true) {
    next.ownerId = String(sessionOwnerId);
  }

  // Apply inferred ownerIdObj shape
  if (requireOwnerIdObj) {
    if (ownerIdObjMustBeObjectId !== false) {
      try {
        next.ownerIdObj = new ObjectId(String(sessionOwnerId));
      } catch {
        next.ownerIdObj = String(sessionOwnerId);
      }
    } else {
      next.ownerIdObj = String(sessionOwnerId);
    }
  }

  // Map body fields to whatever the schema wants most
  if (requireContentField) {
    // Prefer to move existing message/text/title into 'content'
    if (typeof next.content !== "string" || !next.content) {
      const src = next.text || next.message || next.title || "";
      if (src) next.content = src;
    }
    delete next.text;
    delete next.message;
    delete next.title;
  } else if (requireMessageField) {
    if (typeof next.message !== "string" || !next.message) {
      const src = next.text || next.title || next.content || "";
      if (src) next.message = src;
    }
    delete next.text;
    delete next.title;
    delete next.content;
  } else if (requireTitleField) {
    if (typeof next.title !== "string" || !next.title) {
      const src = next.text || next.message || next.content || "";
      if (src) next.title = src;
    }
    delete next.text;
    delete next.message;
    delete next.content;
  } else {
    // No explicit requirement; keep one field and drop extras to satisfy schemas with additionalProperties:false
    const src = next.text || next.message || next.title || next.content || "";
    if (src) {
      next.text = src;
      delete next.message;
      delete next.title;
      delete next.content;
    }
  }

  // Defaults for additional required fields
  if (requireTypeField) {
    if (
      typeEnumValues &&
      Array.isArray(typeEnumValues) &&
      typeEnumValues.length
    ) {
      // If 'announcement' is not allowed, use the first allowed value
      next.type = typeEnumValues.includes(next.type)
        ? next.type
        : typeEnumValues[0];
    } else if (!next.type) {
      next.type = "announcement";
    }
  }
  if (requireUpdatedAt && !next.updatedAt) next.updatedAt = new Date();
  if (requireStatus && !next.status) next.status = "active";
  if (requireIsActive && typeof next.isActive !== "boolean")
    next.isActive = true;

  return next;
}

app.get("/api/announcements", requireOwner, async (req, res) => {
  try {
    const db = getDb();
    const orFilter = ownerIdQueryVariants(req.session.ownerId);

    const items = await db
      .collection("announcements")
      .find({ $or: orFilter })
      .sort({ createdAt: -1 })
      .toArray();

    res.json({
      ok: true,
      items: items.map((x) => ({
        _id: String(x._id),
        text: x.text ?? x.message ?? x.title ?? x.content ?? "",
        createdAt: x.createdAt,
      })),
    });
  } catch (e) {
    console.error("GET /api/announcements", e);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/announcements", requireOwner, async (req, res) => {
  try {
    const { text } = req.body || {};
    if (!text || typeof text !== "string" || !text.trim()) {
      return res.status(400).json({ error: "Invalid text" });
    }

    const db = getDb();
    const coll = db.collection("announcements");

    const createdAt = new Date();
    const safeText = text.trim();
    const ownerIdStr = String(req.session.ownerId);

    // Build candidates that satisfy the schema: { venueId, message, createdAt }
    const candidateDocs = [];
    // Try ObjectId form first
    try {
      candidateDocs.push({
        venueId: new ObjectId(ownerIdStr),
        message: safeText,
        createdAt,
      });
    } catch {}
    // Fallback string form
    candidateDocs.push({
      venueId: ownerIdStr,
      message: safeText,
      createdAt,
    });

    // Some schemas also require extra metadata; try a second pass with extras
    for (const doc of [...candidateDocs]) {
      candidateDocs.push({
        ...doc,
        type: "announcement",
        updatedAt: createdAt,
      });
    }

    // Try to insert using the candidates
    let insertedId = null;
    let lastErr = null;

    for (const candidate of candidateDocs) {
      try {
        const r = await coll.insertOne(candidate);
        insertedId = r.insertedId;
        break;
      } catch (err) {
        lastErr = err;

        // Log helpful details if it’s a schema (121) error
        if (err?.code === 121) {
          console.error(
            "Announcements validator 121. Candidate was:",
            JSON.stringify(candidate)
          );
          console.error("err.errInfo:", JSON.stringify(err.errInfo, null, 2));
        } else {
          // Non-schema error → stop trying
          console.error("Announcements insert error (non-121):", err);
          break;
        }
      }
    }

    if (!insertedId) {
      return res.status(400).json({
        ok: false,
        error:
          "Announcement did not match the collection's schema (needs venueId, message, createdAt). See server logs for details.",
      });
    }

    return res.status(201).json({ ok: true, id: String(insertedId) });
  } catch (e) {
    console.error("POST /api/announcements", e);
    res.status(500).json({ error: "Server error" });
  }
});

app.delete("/api/announcements/:id", requireOwner, async (req, res) => {
  try {
    const { id } = req.params;
    const db = getDb();
    const orFilter = ownerIdQueryVariants(req.session.ownerId);

    const result = await db.collection("announcements").deleteOne({
      _id: new ObjectId(id),
      $or: orFilter,
    });

    res.json({ ok: true, deletedCount: result.deletedCount });
  } catch (e) {
    console.error("DELETE /api/announcements/:id", e);
    res.status(500).json({ error: "Server error" });
  }
});

// ===================== Settings API =====================
app.get("/api/settings", requireOwner, async (req, res) => {
  try {
    const doc = await loadOrInitSettings(req.session.ownerId);
    res.json({
      ok: true,
      settings: {
        walkinsEnabled: !!doc.walkinsEnabled,
        openStatus: doc.openStatus || "closed",
        queueActive: doc.queueActive !== false,
        updatedAt: doc.updatedAt,
      },
    });
  } catch (e) {
    console.error("GET /api/settings", e);
    res.status(500).json({ error: "Server error" });
  }
});

app.put("/api/settings", requireOwner, async (req, res) => {
  try {
    const allowed = {};
    if ("walkinsEnabled" in req.body)
      allowed.walkinsEnabled = !!req.body.walkinsEnabled;
    if ("openStatus" in req.body) {
      const v = String(req.body.openStatus || "").toLowerCase();
      allowed.openStatus = v === "open" ? "open" : "closed";
    }
    if ("queueActive" in req.body) allowed.queueActive = !!req.body.queueActive;

    const doc = await updateSettings(req.session.ownerId, allowed);
    res.json({
      ok: true,
      settings: {
        walkinsEnabled: !!doc.walkinsEnabled,
        openStatus: doc.openStatus,
        queueActive: !!doc.queueActive,
        updatedAt: doc.updatedAt,
      },
    });
  } catch (e) {
    console.error("PUT /api/settings", e);
    res.status(500).json({ error: "Server error" });
  }
});

// ===================== Queue API =====================

// List current queue (+ sequential-fit spots left + settings)
app.get("/api/queue", requireOwner, async (req, res) => {
  try {
    const db = getDb();
    const Queue = db.collection("queue");

    // Ensure sequential positions
    await recomputePositionsForOwner(req);

    const filter = await buildQueueFilterForOwner(req);
    const items = await Queue.find(filter)
      .sort({ position: 1, joinedAt: 1 })
      .toArray();

    const { left, totalSeats, used } = await computeSpotsLeftForOwner(req);
    const settings = await loadOrInitSettings(req.session.ownerId);

    res.json({
      ok: true,
      queue: items.map((x) => ({
        _id: String(x._id),
        name: x.name,
        email: x.email,
        phone: x.phone,
        people: x.partySize,
        position: x.position,
        createdAt: x.joinedAt,
      })),
      spotsLeft: left,
      totalSeats,
      seatsUsed: used, // sequential used (clamped to total)
      settings: {
        walkinsEnabled: !!settings.walkinsEnabled,
        openStatus: settings.openStatus,
        queueActive: !!settings.queueActive,
      },
    });
  } catch (e) {
    console.error("GET /api/queue", e);
    res.status(500).json({ error: "Server error" });
  }
});

// Live queue stream (SSE) — publishes sequential-fit capacity
app.get("/api/queue/stream", requireOwner, async (req, res) => {
  const db = getDb();
  const Queue = db.collection("queue");

  sseSetup(req, res);

  const sendSnapshot = async () => {
    await recomputePositionsForOwner(req);
    const filter = await buildQueueFilterForOwner(req);
    const items = await Queue.find(filter)
      .sort({ position: 1, joinedAt: 1 })
      .toArray();

    const { left, totalSeats, used } = await computeSpotsLeftForOwner(req);
    const settings = await loadOrInitSettings(req.session.ownerId);

    sseSend(res, "snapshot", {
      queue: items.map((x) => ({
        _id: String(x._id),
        name: x.name,
        email: x.email,
        phone: x.phone,
        people: x.partySize,
        position: x.position,
        createdAt: x.joinedAt,
      })),
      spotsLeft: left,
      totalSeats,
      seatsUsed: used,
      settings: {
        walkinsEnabled: !!settings.walkinsEnabled,
        openStatus: settings.openStatus,
        queueActive: !!settings.queueActive,
      },
    });
  };

  await sendSnapshot();

  const hb = setInterval(() => res.write(":keep-alive\n\n"), 25000);
  const changeStream = Queue.watch([], { fullDocument: "updateLookup" });
  changeStream.on("change", async () => {
    try {
      await sendSnapshot();
    } catch {}
  });

  req.on("close", () => {
    clearInterval(hb);
    try {
      changeStream.close();
    } catch {}
    res.end();
  });
});

// Mark served → move to queue_pending (TTL 5 min) + reindex
app.post("/api/queue/serve", requireOwner, async (req, res) => {
  try {
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ error: "Missing id" });

    const db = getDb();
    const Queue = db.collection("queue");
    const Pending = db.collection("queue_pending");

    const filter = await buildQueueFilterForOwner(req);
    const doc = await Queue.findOne({ _id: new ObjectId(id), ...filter });
    if (!doc) return res.status(404).json({ error: "Not found" });

    await Queue.deleteOne({ _id: doc._id });
    await Pending.insertOne({
      ...doc,
      removedAt: new Date(),
      expireAt: new Date(Date.now() + 5 * 60 * 1000),
    });

    await recomputePositionsForOwner(req);

    res.json({
      ok: true,
      removed: {
        _id: String(doc._id),
        name: doc.name,
        email: doc.email,
        phone: doc.phone,
        people: doc.partySize,
        position: doc.position,
      },
    });
  } catch (e) {
    console.error("POST /api/queue/serve", e);
    res.status(500).json({ error: "Server error" });
  }
});

// Restore (undo) → back from queue_pending to queue + reindex
app.post("/api/queue/restore", requireOwner, async (req, res) => {
  try {
    const { item } = req.body || {};
    if (!item || !item._id) {
      return res.status(400).json({ error: "Invalid item" });
    }

    const db = getDb();
    const Queue = db.collection("queue");
    const Pending = db.collection("queue_pending");

    const pending = await Pending.findOne({ _id: new ObjectId(item._id) });
    if (!pending) return res.json({ ok: true, restored: false });

    const scope = pending.venueId
      ? {
          $or: [
            { venueId: pending.venueId },
            { venueId: String(pending.venueId) },
          ],
        }
      : pending.restaurantId
        ? {
            $or: [
              { restaurantId: pending.restaurantId },
              { restaurantId: String(pending.restaurantId) },
            ],
          }
        : {};

    const last = await Queue.find(scope)
      .sort({ position: -1 })
      .limit(1)
      .toArray();

    const nextPos =
      typeof pending.position === "number" && pending.position > 0
        ? pending.position
        : (last[0]?.position || 0) + 1;

    await Queue.insertOne({
      venueId: pending.venueId,
      restaurantId: pending.restaurantId,
      position: nextPos,
      name: pending.name || "Guest",
      email: pending.email || "",
      phone: pending.phone || "",
      partySize: Number(pending.partySize) || 1,
      status: pending.status || "active",
      joinedAt: pending.joinedAt || new Date(),
    });

    await Pending.deleteOne({ _id: pending._id });
    await recomputePositionsForOwner(req);
    res.json({ ok: true, restored: true });
  } catch (e) {
    console.error("POST /api/queue/restore", e);
    res.status(500).json({ error: "Server error" });
  }
});

// ===================== Public add-to-queue (STRICT sequential capacity) =====================
app.post("/api/public/queue", async (req, res) => {
  try {
    const db = getDb();
    const { ownerId, name, email, phone, partySize } = req.body || {};

    if (!ownerId)
      return res.status(400).json({ ok: false, error: "ownerId is required" });
    const psize = Number(partySize || 0);
    if (!psize || psize < 1)
      return res
        .status(400)
        .json({ ok: false, error: "partySize must be >= 1" });

    // Settings gate
    const settings = await getOwnerSettings(db, ownerId);
    if (!settings.queueActive)
      return res
        .status(409)
        .json({ ok: false, error: "Queue is currently stopped" });
    if (settings.openStatus !== "open")
      return res.status(409).json({ ok: false, error: "Restaurant is closed" });
    if (!settings.walkinsEnabled)
      return res
        .status(409)
        .json({ ok: false, error: "Walk-ins are disabled" });

    // Build the payload we want to insert if capacity allows
    const baseDoc = {
      venueId: ObjectId.isValid(String(ownerId))
        ? new ObjectId(String(ownerId))
        : String(ownerId),
      restaurantId: ObjectId.isValid(String(ownerId))
        ? new ObjectId(String(ownerId))
        : String(ownerId),
      name: (name || "Guest").trim(),
      email: (email || "").trim(),
      phone: (phone || "").trim(),
      partySize: psize,
      status: "active",
      joinedAt: new Date(),
    };

    // Atomic enqueue with sequential-fit capacity enforcement
    const out = await enqueueWithCapacity(ownerId, baseDoc);
    if (!out.ok) {
      return res.status(409).json({
        ok: false,
        error: "Not enough spots left",
        ...("capacity" in out ? { capacity: out.capacity } : {}),
      });
    }

    return res.status(201).json({
      ok: true,
      id: out.id,
      position: out.position,
      capacity: out.capacity, // { totalSeats, seatsUsed (sequential), spotsLeft }
    });
  } catch (e) {
    console.error("POST /api/public/queue error:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

// ---- Boot
connectToDb()
  .then(() => {
    const db = getDb();

    // helpful indices
    db.collection("owners")
      .createIndex({ email: 1 }, { unique: true })
      .catch(() => {});

    // primary queue collection (index by venueId/restaurantId + position)
    db.collection("queue")
      .createIndex({ venueId: 1, position: 1 })
      .catch(() => {});
    db.collection("queue")
      .createIndex({ restaurantId: 1, position: 1 })
      .catch(() => {});

    // TTL for pending deletes
    db.collection("queue_pending")
      .createIndex({ expireAt: 1 }, { expireAfterSeconds: 0 })
      .catch(() => {});

    db.collection("announcements")
      .createIndex({ ownerId: 1, createdAt: -1 })
      .catch(() => {});
    db.collection("announcements")
      .createIndex({ ownerIdObj: 1, createdAt: -1 })
      .catch(() => {});

    // settings (owner_settings used by dashboard; "settings" kept for public gate compatibility)
    db.collection("owner_settings")
      .createIndex({ ownerId: 1 }, { unique: true })
      .catch(() => {});
    db.collection("settings")
      .createIndex({ ownerId: 1 }, { unique: true })
      .catch(() => {});

    app.listen(PORT, () => {
      console.log(`Server listening on http://localhost:${PORT}`);
    });
  })
  .catch((e) => {
    console.error("DB connection failed:", e);
    process.exit(1);
  });
