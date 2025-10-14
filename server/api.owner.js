// server/api.owner.js
import express from "express";
import bcrypt from "bcrypt";
import { ObjectId } from "mongodb";
import { getDb } from "./db.js";

const router = express.Router();
async function nextOrderOwner(db, venueIdAny) {
  const key = `seq:order:${String(venueIdAny)}`;
  const r = await db
    .collection("settings")
    .findOneAndUpdate(
      { _id: key },
      { $inc: { value: 1 }, $setOnInsert: { ownerId: key } },
      { upsert: true, returnDocument: "after" }
    );
  return r.value?.value || 1;
}

// ------------------------ TYPE HELPERS (new) ------------------------
const asObjectId = (v) => {
  if (v == null) return null;
  if (v instanceof ObjectId) return v;
  const s = String(v);
  return ObjectId.isValid(s) ? new ObjectId(s) : null;
};
const asStringId = (v) => {
  if (v == null) return "";
  return v instanceof ObjectId ? v.toHexString() : String(v);
};
const asDateOrNull = (d) => (d ? new Date(d) : null);
const asNum = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
const asStr = (v) => (v == null ? "" : String(v));

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
    //openStatus: "closed",
    //queueActive: true,
    updatedAt: new Date(),
  };
  await Settings.updateOne(
    { ownerId: base.ownerId },
    { $setOnInsert: base },
    { upsert: true }
  );
  await Legacy.updateOne(
    { ownerId: String(ownerId) },
    { $setOnInsert: base },
    { upsert: true }
  );
  return base;
}

// keep this as your single point of truth for settings updates
async function updateSettings(ownerId, patch) {
  const db = getDb();
  const Settings = db.collection("owner_settings");
  const Legacy = db.collection("settings");

  const normalized = {};

  // Keep ONLY walkinsEnabled
  if (Object.prototype.hasOwnProperty.call(patch, "walkinsEnabled")) {
    if (typeof patch.walkinsEnabled === "boolean") {
      normalized.walkinsEnabled = patch.walkinsEnabled;
    }
  }

  // We explicitly ignore openStatus/queueActive if sent
  // (Optionally: you could 400 them to catch stray callers)

  if (!Object.keys(normalized).length) {
    // Nothing to update -> return the current state
    let oid = null;
    try {
      oid = new ObjectId(String(ownerId));
    } catch {}
    return (
      (oid && (await Settings.findOne({ ownerId: oid }))) ||
      (await Settings.findOne({ ownerId: String(ownerId) })) ||
      (await Legacy.findOne({ ownerId: String(ownerId) }))
    );
  }

  normalized.updatedAt = new Date();

  let oid = null;
  try {
    oid = new ObjectId(String(ownerId));
  } catch {}
  const filters = [
    oid && { ownerId: oid },
    { ownerId: String(ownerId) },
  ].filter(Boolean);

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

    if (
      !manager?.trim() ||
      !business?.trim() ||
      !email?.trim() ||
      !password ||
      password.length < 8
    )
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
        res.status(201).json({
          ok: true,
          ownerId: result.insertedId,
          business: doc.business,
        })
      );
    });
  } catch (err) {
    if (err?.code === 11000)
      return res.status(409).json({ error: "Email already exists" });
    console.error("Create owner error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/owners/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email?.trim() || !password)
      return res.status(400).json({ error: "Missing credentials" });

    const db = getDb();
    const owner = await db
      .collection("owners")
      .findOne({ email: email.trim().toLowerCase() });
    if (!owner) return res.status(401).json({ error: "Invalid credentials" });

    const ok = await bcrypt.compare(password, owner.passwordHash || "");
    if (!ok) return res.status(401).json({ error: "Invalid credentials" });

    req.session.regenerate((err) => {
      if (err) return res.status(500).json({ error: "Session error" });
      req.session.ownerId = String(owner._id);
      req.session.business = owner.business;
      console.log("✅ Owner logged in:", owner.email);
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
    const owner = await db
      .collection("owners")
      .findOne(
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
    const raw = await db
      .collection("announcements")
      .find({
        $or: [
          { ownerId: String(req.session.ownerId) },
          { venueId: String(req.session.ownerId) },
        ],
      })
      .sort({ createdAt: -1 })
      .toArray();

    const items = raw.map((x) => ({
      _id: String(x._id),
      text: x.message ?? "",
      type: x.type || "announcement",
      createdAt: x.createdAt,
    }));

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
      ownerId: String(req.session.ownerId),
      venueId: new ObjectId(req.session.ownerId),
      message: text.trim(),
      type: "announcement",
      visible: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const r = await db.collection("announcements").insertOne(doc);
    res.status(201).json({ ok: true, id: String(r.insertedId) });
  } catch (e) {
    console.error("POST /announcements", e);
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
        { venueId: new ObjectId(req.session.ownerId) },
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

// router.get("/queue", requireOwner, async (req, res) => {
//   try {
//     const db = getDb();
//     const Queue = db.collection("queue");
//     const Settings = db.collection("owner_settings");
//     const Owners = db.collection("owners");

//     const filter = await buildQueueFilterForOwner(req);
//     const list = await Queue.find(filter)
//       .sort({ position: 1, joinedAt: 1 })
//       .toArray();

//     const owner = await Owners.findOne(
//       { _id: new ObjectId(req.session.ownerId) },
//       { projection: { "profile.totalSeats": 1 } }
//     );
//     const totalSeats = Number(owner?.profile?.totalSeats || 0);

//     let used = 0;
//     for (const it of list) {
//       const size = Number(it.people || it.partySize || 0);
//       if (totalSeats > 0 && used + size > totalSeats) break;
//       used += size;
//     }
//     const spotsLeft = totalSeats ? Math.max(totalSeats - used, 0) : Infinity;

//     const s = (await Settings.findOne({
//       ownerId: new ObjectId(req.session.ownerId),
//     })) ||
//       (await Settings.findOne({ ownerId: String(req.session.ownerId) })) || {
//         walkinsEnabled: false,
//         openStatus: "closed",
//         queueActive: true,
//       };

//     res.json({
//       ok: true,
//       queue: list.map((x) => ({
//         _id: String(x._id),
//         name: x.name || "Guest",
//         email: x.email || "",
//         phone: x.phone || "",
//         people: x.people || x.partySize || 1,
//         position: x.position || x.order || 0,
//         status: x.status || "waiting",
//       })),
//       totalSeats,
//       seatsUsed: used,
//       spotsLeft,
//       settings: {
//         walkinsEnabled: !!s.walkinsEnabled,
//         openStatus: s.openStatus === "open" ? "open" : "closed",
//         queueActive: !!s.queueActive,
//       },
//     });
//   } catch (e) {
//     console.error("GET /api/queue error:", e);
//     res.status(500).json({ error: "Server error" });
//   }
// });

// ------------------------ Mark served → move to queue_pending (Undo window) ------------------------
router.get("/queue", requireOwner, async (req, res) => {
  try {
    const db = getDb();
    const Queue = db.collection("queue");
    const Settings = db.collection("owner_settings");
    const Owners = db.collection("owners");

    const filter = await buildQueueFilterForOwner(req);

    // Only live entries, sorted by FCFS (order, then joinedAt, then _id)
    const list = await Queue.find({
      ...filter,
      status: { $in: ["waiting", "active"] },
    })
      .sort({ order: 1, joinedAt: 1, _id: 1 })
      .toArray();

    // Capacity (from owner profile)
    const owner = await Owners.findOne(
      { _id: new ObjectId(req.session.ownerId) },
      { projection: { "profile.totalSeats": 1 } }
    );
    const totalSeats = Number(owner?.profile?.totalSeats || 0);

    let used = 0;
    for (const it of list) {
      const size = Number(it.people || it.partySize || 0);
      if (totalSeats > 0 && used + size > totalSeats) break;
      used += size;
    }
    const spotsLeft = totalSeats ? Math.max(totalSeats - used, 0) : Infinity;

    // Settings
    const s = (await Settings.findOne({
      ownerId: new ObjectId(req.session.ownerId),
    })) ||
      (await Settings.findOne({ ownerId: String(req.session.ownerId) })) || {
        walkinsEnabled: false,
        openStatus: "closed",
        queueActive: true,
      };

    // Derive live position as i+1 from the sorted list
    res.json({
      ok: true,
      queue: list.map((x, i) => ({
        _id: String(x._id),
        name: x.name || "Guest",
        email: x.email || "",
        phone: x.phone || "",
        people: x.people || x.partySize || 1,
        position: i + 1,
        status: x.status || "waiting",
        order: x.order ?? i + 1, // optional for debugging
      })),
      totalSeats,
      seatsUsed: used,
      spotsLeft,
      settings: {
        walkinsEnabled: !!s.walkinsEnabled,
        openStatus: s.openStatus === "open" ? "open" : "closed",
        queueActive: !!s.queueActive,
      },
    });
  } catch (e) {
    console.error("GET /api/queue error:", e);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/queue/serve", requireOwner, async (req, res) => {
  try {
    const db = getDb();
    const Queue = db.collection("queue");
    const Pending = db.collection("queue_pending");

    const { id } = req.body || {};
    if (!id) return res.status(400).json({ error: "Missing id" });

    const ownerFilter = await buildQueueFilterForOwner(req);
    const doc = await Queue.findOne({
      _id: new ObjectId(String(id)),
      ...ownerFilter,
    });
    if (!doc) return res.status(404).json({ error: "Not found" });

    const now = new Date();
    const people = asNum(doc.people ?? doc.partySize, 1);
    const order = asNum(doc.order ?? doc.position, 0);
    const position = asNum(doc.position ?? doc.order, order);

    const pendingForSet = {
      ownerId: asStringId(req.session.ownerId),

      // IMPORTANT: keep userId as ObjectId if schema requires it later
      userId: asObjectId(doc.userId) ?? null,

      // Your queue sample shows strings for venueId/restaurantId
      venueId: asStringId(doc.venueId ?? req.session.ownerId),
      restaurantId: asStringId(
        doc.restaurantId ?? doc.venueId ?? req.session.ownerId
      ),

      name: asStr(doc.name || "Guest"),
      email: asStr(doc.email || ""),
      phone: asStr(doc.phone || ""),

      people,
      partySize: people,
      order,
      position,

      status: "waiting",
      servedAt: now,
      joinedAt: doc.joinedAt ? new Date(doc.joinedAt) : now,
      updatedAt: now,
      expireAt: new Date(now.getTime() + 5 * 60 * 1000),
      timerPaused: !!doc.timerPaused,

      nearTurnAt: asDateOrNull(doc.nearTurnAt),
      arrivalDeadline: asDateOrNull(doc.arrivalDeadline),
    };

    const createdAtValue = doc.createdAt ? new Date(doc.createdAt) : now;

    await Pending.updateOne(
      { _id: new ObjectId(String(doc._id)) },
      { $set: pendingForSet, $setOnInsert: { createdAt: createdAtValue } },
      { upsert: true }
    );

    await Queue.deleteOne({ _id: doc._id });
    try {
      await reindexPositions(db, doc.venueId || req.session.ownerId);
    } catch {}

    res.json({
      ok: true,
      removed: {
        _id: String(doc._id),
        name: pendingForSet.name,
        email: pendingForSet.email,
        phone: pendingForSet.phone,
        people: pendingForSet.people,
        position: pendingForSet.position,
        order: pendingForSet.order,
        venueId: pendingForSet.venueId,
        restaurantId: pendingForSet.restaurantId,
        status: "served",
      },
    });
  } catch (e) {
    console.error("POST /api/queue/serve", e);
    res.status(500).json({ error: "Server error" });
  }
});

async function reindexPositions(db, venueIdAny) {
  const Queue = db.collection("queue");
  const vStr = String(venueIdAny);
  const vOID = ObjectId.isValid(vStr) ? new ObjectId(vStr) : null;

  const match = {
    status: { $in: ["waiting", "active"] },
    $or: [{ venueId: vStr }].concat(vOID ? [{ venueId: vOID }] : []),
  };

  const list = await Queue.find(match)
    .sort({ order: 1, joinedAt: 1, _id: 1 })
    .project({ _id: 1 })
    .toArray();
  if (!list.length) return;

  const ops = list.map((d, i) => ({
    updateOne: {
      filter: { _id: d._id },
      update: { $set: { position: i + 1, updatedAt: new Date() } },
    },
  }));
  await Queue.bulkWrite(ops, { ordered: false });
}

// Undo (restore from queue_pending back to queue)
router.post("/queue/restore", requireOwner, async (req, res) => {
  try {
    const db = getDb();
    const Queue = db.collection("queue");
    const Pending = db.collection("queue_pending");
    const Activity = db.collection("activitylog");

    const payload = req.body?.item || {};
    if (!payload?._id) {
      return res.status(400).json({ error: "Missing item._id" });
    }
    const _id = new ObjectId(String(payload._id));

    // 1) fetch canonical pending
    const pend = await Pending.findOne({ _id });
    if (!pend) return res.status(404).json({ error: "Undo window expired" });

    // --- helpers ---

    const isHex24 = (s) => typeof s === "string" && /^[0-9a-fA-F]{24}$/.test(s);
    const asIntMin1 = (v, d = 1) => {
      const n = Math.floor(Number(v));
      return Number.isFinite(n) && n >= 1 ? n : d;
    };

    const toDateOrOmit = (d) => (d ? new Date(d) : undefined);
    const validEmail = (s) =>
      typeof s === "string" &&
      // tiny permissive pattern; your schema may be stricter but this avoids obvious fails
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
    const validPhone = (s) =>
      typeof s === "string" &&
      // accept +, digits, spaces, dashes, parens with 7+ digits total
      s.replace(/[^\d]/g, "").length >= 7;

    // 2) Build a strict, whitelisted doc (avoid additionalProperties)
    const venueIdStr = isHex24(pend.venueId)
      ? pend.venueId
      : pend.venueId instanceof ObjectId
        ? pend.venueId.toHexString()
        : "";
    const restaurantIdStr = isHex24(pend.restaurantId)
      ? pend.restaurantId
      : pend.restaurantId instanceof ObjectId
        ? pend.restaurantId.toHexString()
        : venueIdStr;

    const people = asIntMin1(pend.people ?? pend.partySize ?? 1);
    const order = asIntMin1(pend.order ?? pend.position ?? 1);
    const position = asIntMin1(pend.position ?? pend.order ?? order);

    const doc = {
      _id, // keep the same id
      userId: pend.userId, // expect ObjectId; do not coerce to string
      venueId: venueIdStr, // schema likely wants 24-hex string
      restaurantId: restaurantIdStr, // same
      name:
        typeof pend.name === "string" && pend.name.trim()
          ? pend.name.trim()
          : "Guest",
      people,
      order,
      position,
      status: "waiting",
      timerPaused: !!pend.timerPaused,
      joinedAt: new Date(pend.joinedAt || new Date()),
      createdAt: new Date(pend.createdAt || new Date()),
      updatedAt: new Date(),
    };

    // Optional dates: include only if present (no nulls)
    const nearTurnAt = toDateOrOmit(pend.nearTurnAt);
    const arrivalDeadline = toDateOrOmit(pend.arrivalDeadline);
    if (nearTurnAt) doc.nearTurnAt = nearTurnAt;
    if (arrivalDeadline) doc.arrivalDeadline = arrivalDeadline;

    // Optional patterned strings: include only if valid
    if (validEmail(pend.email)) doc.email = pend.email.trim();
    if (validPhone(pend.phone)) doc.phone = pend.phone.trim();

    // 3) Required field guardrails
    if (!(doc.userId instanceof ObjectId)) {
      return res
        .status(400)
        .json({ error: "Cannot restore: userId must be an ObjectId" });
    }
    if (!isHex24(doc.venueId) || !isHex24(doc.restaurantId)) {
      return res.status(400).json({
        error: "Cannot restore: venueId/restaurantId must be 24-hex strings",
      });
    }

    // 4) Insert & cleanup
    await Queue.insertOne(doc);
    await Pending.deleteOne({ _id });
    try {
      await reindexPositions(db, doc.venueId);
    } catch {}

    // 5) best-effort activity
    try {
      await Activity.insertOne({
        actorId: String(req.session.ownerId),
        action: "queue.restore",
        entityType: "queue",
        entityId: _id,
        at: new Date(),
      });
    } catch (logErr) {
      console.warn(
        "activitylog insert skipped:",
        logErr?.errInfo || logErr?.message || logErr
      );
    }

    res.json({ ok: true, restored: String(_id) });
  } catch (e) {
    // Print exact $jsonSchema reasons so we can iterate if anything else mismatches
    if (e?.errInfo?.details) {
      console.error(
        "QUEUE RESTORE VALIDATION DETAILS:\n" +
          JSON.stringify(e.errInfo.details, null, 2)
      );
    }
    console.error("POST /api/queue/restore", e);
    res.status(500).json({ error: "Server error" });
  }
});

// ------------------------ PUBLIC JOIN QUEUE ------------------------
// router.post("/public/queue", async (req, res) => {
//   try {
//     const db = getDb();
//     const { ownerId, name, email, phone, partySize } = req.body || {};
//     if (!ownerId) return res.status(400).json({ error: "Missing ownerId" });
//     const count = Math.max(1, Math.min(12, Number(partySize) || 1));
//     const doc = {
//       venueId: ObjectId.isValid(ownerId)
//         ? new ObjectId(ownerId)
//         : String(ownerId),
//       restaurantId: ObjectId.isValid(ownerId)
//         ? new ObjectId(ownerId)
//         : String(ownerId),
//       name: name?.trim() || "Guest",
//       email: email?.trim() || "",
//       phone: phone?.trim() || "",
//       partySize: count,
//       people: count,
//       status: "waiting",
//       position: 0,
//       order: 0,
//       joinedAt: new Date(),
//       createdAt: new Date(),
//     };
//     const r = await db.collection("queue").insertOne(doc);
//     res.status(201).json({ ok: true, id: String(r.insertedId) });
//   } catch (e) {
//     console.error("Public queue error", e);
//     res.status(500).json({ error: "Server error" });
//   }
// });
router.post("/public/queue", async (req, res) => {
  try {
    const db = getDb();
    const { ownerId, name, email, phone, partySize } = req.body || {};
    if (!ownerId) return res.status(400).json({ error: "Missing ownerId" });

    const count = Math.max(1, Math.min(12, Number(partySize) || 1));
    const ord = await nextOrderOwner(db, ownerId);

    const venueId = ObjectId.isValid(ownerId)
      ? new ObjectId(ownerId)
      : String(ownerId);

    const doc = {
      venueId,
      restaurantId: venueId,
      name: name?.trim() || "Guest",
      email: email?.trim() || "",
      phone: phone?.trim() || "",
      partySize: count,
      people: count,
      status: "waiting",
      order: ord,
      position: ord, // initial, UI will still derive live position
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
