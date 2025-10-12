// server/api.owner.js
import express from "express";
import bcrypt from "bcrypt";
import { ObjectId } from "mongodb";
import { getDb, getClient } from "./db.js";

const router = express.Router();

// ------------------------ AUTH GUARD ------------------------
function requireOwner(req, res, next) {
  if (req.session?.ownerId) return next();
  return res.status(401).json({ error: "Not authenticated" });
}

// ------------------------ SETTINGS HELPERS ------------------------
async function loadOrInitSettings(ownerId) {
  const db = getDb();
  const Settings = db.collection("owner_settings");
  const Legacy = db.collection("settings");

  let oid = null;
  try {
    oid = new ObjectId(String(ownerId));
  } catch {}

  const found =
    (oid && (await Settings.findOne({ ownerId: oid }))) ||
    (await Settings.findOne({ ownerId: String(ownerId) })) ||
    (await Legacy.findOne({ ownerId: String(ownerId) }));

  if (found) return found;

  const base = {
    ownerId: oid || String(ownerId),
    walkinsEnabled: false,
    openStatus: "closed",
    queueActive: true,
    updatedAt: new Date(),
  };
  await Settings.updateOne({ ownerId: base.ownerId }, { $setOnInsert: base }, { upsert: true });
  await Legacy.updateOne({ ownerId: String(ownerId) }, { $setOnInsert: base }, { upsert: true });
  return base;
}

async function updateSettings(ownerId, patch) {
  const db = getDb();
  const Settings = db.collection("owner_settings");
  const Legacy = db.collection("settings");

  const normalized = {};
  if ("walkinsEnabled" in patch) normalized.walkinsEnabled = !!patch.walkinsEnabled;
  if ("queueActive" in patch) normalized.queueActive = !!patch.queueActive;
  if ("openStatus" in patch)
    normalized.openStatus = patch.openStatus === "open" ? "open" : "closed";
  normalized.updatedAt = new Date();

  let oid = null;
  try {
    oid = new ObjectId(String(ownerId));
  } catch {}

  const filters = [oid && { ownerId: oid }, { ownerId: String(ownerId) }].filter(Boolean);
  for (const f of filters) {
    await Settings.updateOne(f, { $set: normalized }, { upsert: false });
    await Legacy.updateOne(f, { $set: normalized }, { upsert: false });
  }
  return (
    (oid && (await Settings.findOne({ ownerId: oid }))) ||
    (await Settings.findOne({ ownerId: String(ownerId) })) ||
    (await Legacy.findOne({ ownerId: String(ownerId) }))
  );
}

// ------------------------ OWNER AUTH ------------------------
router.post("/owners", async (req, res) => {
  try {
    const db = getDb();
    const Owners = db.collection("owners");
    const { manager, business, type, phone, email, password } = req.body || {};

    if (!manager?.trim() || !business?.trim() || !email?.trim() || !password || password.length < 8)
      return res.status(400).json({ error: "Invalid payload" });

    const passwordHash = await bcrypt.hash(password, 10);
    const doc = {
      manager: manager.trim(),
      business: business.trim(),
      type: type?.trim() || "",
      phone: phone?.trim() || "",
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
      req.session.save(() =>
        res.status(201).json({ ok: true, ownerId: result.insertedId, business: doc.business })
      );
    });
  } catch (err) {
    if (err?.code === 11000) return res.status(409).json({ error: "Email already exists" });
    console.error("Create owner error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/owners/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email?.trim() || !password) return res.status(400).json({ error: "Missing credentials" });

    const db = getDb();
    const owner = await db.collection("owners").findOne({ email: email.trim().toLowerCase() });
    if (!owner) return res.status(401).json({ error: "Invalid credentials" });

    const ok = await bcrypt.compare(password, owner.passwordHash || "");
    if (!ok) return res.status(401).json({ error: "Invalid credentials" });

    req.session.regenerate((err) => {
      if (err) return res.status(500).json({ error: "Session error" });
      req.session.ownerId = String(owner._id);
      req.session.business = owner.business;
      console.log("✅ Owner logged in:", owner.email);
      console.log("Session right before save:", req.sessionID, req.session);
      req.session.save(() => res.json({ ok: true, business: owner.business }));
    });
  } catch (e) {
    console.error("Login error:", e);
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/owners/session", (req, res) => {
  if (req.session?.ownerId)
    return res.json({
      ok: true,
      ownerId: req.session.ownerId,
      business: req.session.business,
    });
  res.status(401).json({ ok: false });
});

router.post("/owners/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("sooner.sid");
    res.json({ ok: true });
  });
});

// ------------------------ OWNER PROFILE ------------------------
router.get("/owners/me", requireOwner, async (req, res) => {
  try {
    const db = getDb();
    const owner = await db.collection("owners").findOne(
      { _id: new ObjectId(req.session.ownerId) },
      { projection: { passwordHash: 0 } }
    );
    if (!owner) return res.status(404).json({ error: "Owner not found" });
    res.json({ ok: true, ...owner, ownerId: String(owner._id) });
  } catch (e) {
    res.status(500).json({ error: "Server error" });
  }
});

router.put("/owners/me", requireOwner, async (req, res) => {
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
      avatar,
      gallery,
    } = req.body || {};

    const profile = {
      displayName: displayName?.trim() || "",
      description: description?.trim() || "",
      cuisine: cuisine?.trim() || "",
      approxPrice: approxPrice?.trim() || "",
      waitTime: Number(waitTime) || 0,
      totalSeats: Number(totalSeats) || 0,
      maxBooking: Number(maxBooking) || 0,
      location: location?.trim() || "",
      openTime: openTime?.trim() || "",
      closeTime: closeTime?.trim() || "",
      features: features?.trim() || "",
      avatar: avatar || "",
      gallery: Array.isArray(gallery) ? gallery : [],
      updatedAt: new Date(),
    };

    const result = await Owners.updateOne(
      { _id: new ObjectId(req.session.ownerId) },
      { $set: { profile, updatedAt: new Date() } }
    );

    res.json({ ok: true, modifiedCount: result.modifiedCount });
  } catch (e) {
    console.error("PUT /owners/me", e);
    res.status(500).json({ error: "Server error" });
  }
});

// ------------------------ SETTINGS ------------------------
router.get("/settings", requireOwner, async (req, res) => {
  try {
    const doc = await loadOrInitSettings(req.session.ownerId);
    res.json({
      ok: true,
      settings: {
        walkinsEnabled: !!doc.walkinsEnabled,
        openStatus: doc.openStatus,
        queueActive: !!doc.queueActive,
      },
    });
  } catch (e) {
    res.status(500).json({ error: "Server error" });
  }
});

router.put("/settings", requireOwner, async (req, res) => {
  try {
    const patch = {
      walkinsEnabled: req.body.walkinsEnabled,
      queueActive: req.body.queueActive,
      openStatus: req.body.openStatus,
    };
    const doc = await updateSettings(req.session.ownerId, patch);
    res.json({ ok: true, settings: doc });
  } catch (e) {
    res.status(500).json({ error: "Server error" });
  }
});

// ------------------------ ANNOUNCEMENTS ------------------------
router.get("/announcements", requireOwner, async (req, res) => {
  try {
    const db = getDb();
    const items = await db
      .collection("announcements")
      .find({
        $or: [{ ownerId: String(req.session.ownerId) }, { venueId: String(req.session.ownerId) }],
      })
      .sort({ createdAt: -1 })
      .toArray();

    res.json({ ok: true, items });
  } catch (e) {
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/announcements", requireOwner, async (req, res) => {
  try {
    const { text } = req.body || {};
    if (!text?.trim()) return res.status(400).json({ error: "Missing text" });

    const db = getDb();
    const doc = {
      venueId: new ObjectId(req.session.ownerId),
      message: text.trim(),
      type: "announcement",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const r = await db.collection("announcements").insertOne(doc);
    res.status(201).json({ ok: true, id: String(r.insertedId) });
  } catch (e) {
    res.status(500).json({ error: "Server error" });
  }
});

router.delete("/announcements/:id", requireOwner, async (req, res) => {
  try {
    const db = getDb();
    await db.collection("announcements").deleteOne({
      _id: new ObjectId(req.params.id),
      $or: [
        { ownerId: String(req.session.ownerId) },
        { venueId: String(req.session.ownerId) },
      ],
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "Server error" });
  }
});

// ------------------------ QUEUE MANAGEMENT (Owner Dashboard) ------------------------
async function buildQueueFilterForOwner(req) {
  const ownerId = req.session.ownerId;
  let oid = null;
  try {
    oid = new ObjectId(String(ownerId));
  } catch {}
  return {
    $or: [
      { venueId: oid },
      { venueId: String(ownerId) },
      { restaurantId: oid },
      { restaurantId: String(ownerId) },
    ],
  };
}

router.get("/queue", requireOwner, async (req, res) => {
  try {
    const db = getDb();
    const Queue = db.collection("queue");
    const filter = await buildQueueFilterForOwner(req);
    const list = await Queue.find(filter).sort({ order: 1 }).toArray();
    res.json({ ok: true, queue: list });
  } catch (e) {
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/queue/serve", requireOwner, async (req, res) => {
  try {
    const { id } = req.body || {};
    const db = getDb();
    const Queue = db.collection("queue");
    const filter = await buildQueueFilterForOwner(req);
    const doc = await Queue.findOne({ _id: new ObjectId(id), ...filter });
    if (!doc) return res.status(404).json({ error: "Not found" });
    await Queue.updateOne({ _id: doc._id }, { $set: { status: "served" } });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "Server error" });
  }
});

// ------------------------ PUBLIC JOIN QUEUE ------------------------
router.post("/public/queue", async (req, res) => {
  try {
    const db = getDb();
    const { ownerId, name, email, phone, partySize } = req.body || {};
    if (!ownerId) return res.status(400).json({ error: "Missing ownerId" });
    const count = Math.max(1, Math.min(12, Number(partySize) || 1));
    const doc = {
      venueId: ObjectId.isValid(ownerId) ? new ObjectId(ownerId) : String(ownerId),
      restaurantId: ObjectId.isValid(ownerId) ? new ObjectId(ownerId) : String(ownerId),
      name: name?.trim() || "Guest",
      email: email?.trim() || "",
      phone: phone?.trim() || "",
      partySize: count,
      people: count,
      status: "waiting",
      position: 0,
      order: 0,
      joinedAt: new Date(),
      createdAt: new Date(),
    };
    const r = await db.collection("queue").insertOne(doc);
    res.status(201).json({ ok: true, id: String(r.insertedId) });
  } catch (e) {
    console.error("Public queue error", e);
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/session", (req, res) => {
  if (req.session?.ownerId)
    return res.json({
      ok: true,
      ownerId: req.session.ownerId,
      business: req.session.business,
    });
  res.status(401).json({ ok: false });
});

export default router;
