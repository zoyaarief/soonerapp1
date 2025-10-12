// server/api.owner.sse.js
import express from "express";
import { ObjectId } from "mongodb";
import { getDb } from "./db.js";

const router = express.Router();

// ------------------------ AUTH GUARD ------------------------
function requireOwner(req, res, next) {
  if (req.session?.ownerId) return next();
  return res.status(401).json({ error: "Not authenticated" });
}

// ------------------------ SSE HELPERS ------------------------
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

// ------------------------ OWNER QUEUE FILTER ------------------------
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

// ------------------------ SETTINGS HELPER ------------------------
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

// ------------------------ CAPACITY CALC ------------------------
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
    const size = Number(it.partySize || it.people || 0);
    if (used + size <= totalSeats) used += size;
    else break;
  }
  const left = totalSeats > 0 ? Math.max(totalSeats - used, 0) : Infinity;
  return { totalSeats, used, left };
}

// ------------------------ SSE ENDPOINT ------------------------
router.get("/queue/stream", requireOwner, async (req, res) => {
  const db = getDb();
  const Queue = db.collection("queue");

  sseSetup(req, res);

  const sendSnapshot = async () => {
    try {
      const filter = await buildQueueFilterForOwner(req);
      const items = await Queue.find(filter)
        .sort({ position: 1, joinedAt: 1 })
        .toArray();
      const capacity = await computeSpotsLeftForOwner(req);
      const settings = await loadOrInitSettings(req.session.ownerId);

      sseSend(res, "snapshot", {
        queue: items.map((x) => ({
          _id: String(x._id),
          name: x.name || "Guest",
          email: x.email || "",
          phone: x.phone || "",
          people: x.people || x.partySize || 1,
          position: x.position || x.order || 0,
          status: x.status || "waiting",
        })),
        capacity,
        settings: {
          walkinsEnabled: !!settings.walkinsEnabled,
          openStatus: settings.openStatus,
          queueActive: !!settings.queueActive,
        },
      });
    } catch (err) {
      console.error("SSE snapshot error", err);
    }
  };

  await sendSnapshot();

  // Keep alive heartbeat every 25s
  const hb = setInterval(() => res.write(": keep-alive\n\n"), 25000);

  // Listen for changes in the queue collection
  const changeStream = Queue.watch([], { fullDocument: "updateLookup" });
  changeStream.on("change", async () => {
    await sendSnapshot();
  });

  req.on("close", () => {
    clearInterval(hb);
    try {
      changeStream.close();
    } catch {}
    res.end();
  });
});

export default router;
