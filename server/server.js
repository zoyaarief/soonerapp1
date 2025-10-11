// server/server.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import bcrypt from "bcrypt";
import session from "express-session";
import MongoStore from "connect-mongo";
import { connectToDb, getDb } from "./db.js";
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

// ---- SSE helpers (for live queue stream)
function sseSetup(res) {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.flushHeaders?.();
}
function sseSend(res, event, dataObj) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(dataObj)}\n\n`);
}

// --- SETTINGS helpers (owner_settings) ---
async function loadOrInitSettings(ownerId) {
  const db = getDb();
  const Settings = db.collection("owner_settings");

  let doc = await Settings.findOne({ ownerId: new ObjectId(ownerId) });
  if (!doc) {
    doc = {
      ownerId: new ObjectId(ownerId),
      walkinsEnabled: false,
      openStatus: "closed", // "open" | "closed"
      queueActive: true,
      updatedAt: new Date(),
    };
    const { insertedId } = await Settings.insertOne(doc);
    doc._id = insertedId;
  }
  return doc;
}

async function updateSettings(ownerId, patch) {
  const db = getDb();
  const Settings = db.collection("owner_settings");
  const res = await Settings.findOneAndUpdate(
    { ownerId: new ObjectId(ownerId) },
    { $set: { ...patch, updatedAt: new Date() } },
    { upsert: true, returnDocument: "after" }
  );
  return res.value;
}

// --- QUEUE helpers (shared) ---
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

// Compute capacity snapshot for the logged-in owner (used by dashboard)
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
  const agg = await Queue.aggregate([
    { $match: filter },
    { $group: { _id: null, used: { $sum: { $toInt: "$partySize" } } } },
  ]).toArray();

  const used = Number(agg[0]?.used || 0);
  const left = totalSeats > 0 ? Math.max(totalSeats - used, 0) : Infinity;

  return { totalSeats, used, left };
}

// ---- Helpers used by public add-to-queue ----
function buildQueueFilterForTargetId(targetId) {
  let asObjId = null;
  try {
    asObjId = new ObjectId(String(targetId));
  } catch {
    /* ignore */
  }
  const clauses = [];
  if (asObjId) clauses.push({ venueId: asObjId }, { restaurantId: asObjId });
  clauses.push(
    { venueId: String(targetId) },
    { restaurantId: String(targetId) }
  );
  return { $or: clauses };
}

// Read settings for an owner; this one reads from "settings" (kept for compatibility)
async function getOwnerSettings(db, ownerId) {
  const Settings = db.collection("settings");
  const doc = await Settings.findOne({ ownerId: String(ownerId) });
  return {
    walkinsEnabled: !!doc?.walkinsEnabled,
    openStatus: doc?.openStatus === "open" ? "open" : "closed",
    queueActive: doc?.queueActive !== false, // default true
  };
}

// Compute capacity snapshot by explicit owner id (used by public add-to-queue)
async function computeSpotsLeftForOwnerById(db, ownerId) {
  const owner = await db
    .collection("owners")
    .findOne(
      { _id: new ObjectId(String(ownerId)) },
      { projection: { profile: 1 } }
    );

  const totalSeats = Number(owner?.profile?.totalSeats || 0);

  const Queue = db.collection("queue");
  const filter = buildQueueFilterForTargetId(ownerId);
  const agg = await Queue.aggregate([
    { $match: filter },
    { $group: { _id: null, sum: { $sum: { $ifNull: ["$partySize", 0] } } } },
  ]).toArray();

  const seatsUsed = Number(agg[0]?.sum || 0);
  const spotsLeft =
    totalSeats > 0 ? Math.max(0, totalSeats - seatsUsed) : Infinity;

  return { totalSeats, seatsUsed, spotsLeft };
}

// Next position for a given owner scope
async function computeNextPosition(db, ownerId) {
  const Queue = db.collection("queue");
  const filter = buildQueueFilterForTargetId(ownerId);
  const last = await Queue.find(filter)
    .sort({ position: -1 })
    .limit(1)
    .toArray();
  return (last[0]?.position || 0) + 1;
}

// =====================
// Auth: create/login/session/logout
// =====================
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

// =====================
// Owner profile
// =====================
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

// =====================
// Announcements API
// =====================
app.get("/api/announcements", requireOwner, async (req, res) => {
  try {
    const db = getDb();
    const items = await db
      .collection("announcements")
      .find({ ownerId: req.session.ownerId })
      .sort({ createdAt: -1 })
      .toArray();

    res.json({
      ok: true,
      items: items.map((x) => ({
        _id: String(x._id),
        text: x.text,
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
    const doc = {
      ownerId: req.session.ownerId,
      text: text.trim(),
      createdAt: new Date(),
    };
    const result = await db.collection("announcements").insertOne(doc);
    res.status(201).json({ ok: true, id: String(result.insertedId) });
  } catch (e) {
    console.error("POST /api/announcements", e);
    res.status(500).json({ error: "Server error" });
  }
});

app.delete("/api/announcements/:id", requireOwner, async (req, res) => {
  try {
    const { id } = req.params;
    const db = getDb();
    const result = await db.collection("announcements").deleteOne({
      _id: new ObjectId(id),
      ownerId: req.session.ownerId,
    });
    res.json({ ok: true, deletedCount: result.deletedCount });
  } catch (e) {
    console.error("DELETE /api/announcements/:id", e);
    res.status(500).json({ error: "Server error" });
  }
});

// =====================
// Settings API (owner_settings)
// =====================
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

// =====================
// Queue API (collection: "queue" + "queue_pending")
// =====================

// List current queue (+ spots left + settings)
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
      seatsUsed: used,
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

// Live queue stream (SSE)
app.get("/api/queue/stream", requireOwner, async (req, res) => {
  const db = getDb();
  const Queue = db.collection("queue");

  sseSetup(res);

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

// =====================
// Public add-to-queue (with capacity gate)
// =====================
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

    // Capacity gate (optional but recommended)
    const { totalSeats, seatsUsed, spotsLeft } =
      await computeSpotsLeftForOwnerById(db, ownerId);
    if (Number.isFinite(spotsLeft) && spotsLeft < psize) {
      return res.status(409).json({
        ok: false,
        error: "Not enough spots left",
        totalSeats,
        seatsUsed,
        spotsLeft,
      });
    }

    const position = await computeNextPosition(db, ownerId);
    const Queue = db.collection("queue");

    const doc = {
      venueId: ObjectId.isValid(String(ownerId))
        ? new ObjectId(String(ownerId))
        : String(ownerId),
      restaurantId: ObjectId.isValid(String(ownerId))
        ? new ObjectId(String(ownerId))
        : String(ownerId),
      position,
      name: (name || "Guest").trim(),
      email: (email || "").trim(),
      phone: (phone || "").trim(),
      partySize: psize,
      status: "active",
      joinedAt: new Date(),
    };

    const result = await Queue.insertOne(doc);
    const after = await computeSpotsLeftForOwnerById(db, ownerId);

    return res.status(201).json({
      ok: true,
      id: String(result.insertedId),
      position,
      capacity: after, // { totalSeats, seatsUsed, spotsLeft }
    });
  } catch (e) {
    console.error("POST /api/public/queue error:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

// =====================

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
