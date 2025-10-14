// server/queueWorker.js
import { ObjectId } from "mongodb";
import { getDb } from "./db.js";

// --- helpers ---
const toStr = (v) => (v == null ? "" : String(v));
const toMaybeObjectId = (v) =>
  ObjectId.isValid(String(v)) ? new ObjectId(String(v)) : undefined;

// Build a filter that matches either string or ObjectId forms of venueId
function venueIdOrVariantsFilter(venueId) {
  const variants = new Set();
  // original
  variants.add(venueId);
  // string form
  variants.add(toStr(venueId));
  // objectId form (if valid)
  const maybe = toMaybeObjectId(venueId);
  if (maybe) variants.add(maybe);
  // if the original was an ObjectId, also add its string form explicitly
  if (
    venueId &&
    typeof venueId === "object" &&
    venueId._bsontype === "ObjectID"
  ) {
    variants.add(String(venueId));
  }
  return { $or: Array.from(variants).map((v) => ({ venueId: v })) };
}

async function safeInsertActivity(db, payload) {
  try {
    const now = new Date();
    const doc = {
      type: payload.type, // e.g., "queue.near_turn" | "queue.expired"
      createdAt: now,
      at: payload.at || now,

      // dual identifiers (strip undefined later)
      ownerIdStr: payload.ownerIdStr ? String(payload.ownerIdStr) : undefined,
      ownerId: toMaybeObjectId(payload.ownerIdStr),

      userIdStr: payload.userId ? String(payload.userId) : undefined,
      userId: toMaybeObjectId(payload.userId),

      venueIdStr: payload.venueId != null ? String(payload.venueId) : undefined,
      venueId: toMaybeObjectId(payload.venueId),

      restaurantIdStr:
        payload.restaurantId != null ? String(payload.restaurantId) : undefined,
      restaurantId: toMaybeObjectId(payload.restaurantId),

      meta: payload.meta || {},
    };

    // strip undefined keys so we don't violate bsonType constraints
    Object.keys(doc).forEach((k) => doc[k] === undefined && delete doc[k]);

    await db.collection("activitylog").insertOne(doc);
  } catch (err) {
    // Never crash the worker on logging problems
    console.warn(
      "activitylog insert skipped:",
      err?.errInfo || err?.message || err
    );
  }
}

// --- the worker tick ---

async function tick() {
  const db = getDb();
  const now = new Date();

  // --- 1) Find venues that currently have ACTIVE customers
  const venues = await db
    .collection("queue")
    .distinct("venueId", { status: "active" });

  for (const venueId of venues) {
    // --- 2) Active entries in FIFO order (joinedAt first; fallback to order if present)
    const activeList = await db
      .collection("queue")
      .find({ venueId, status: "active" })
      .sort({ joinedAt: 1, order: 1 }) // joinedAt is primary; 'order' only if some docs still use it
      .toArray();

    if (!activeList.length) continue;

    // --- 3) Mark top-5 as "near turn" (set 45m arrival window) if not already set
    const topFive = activeList.slice(0, 5);
    for (const q of topFive) {
      if (!q.nearTurnAt || !q.arrivalDeadline) {
        await db.collection("queue").updateOne(
          { _id: q._id },
          {
            $set: {
              nearTurnAt: now,
              arrivalDeadline: new Date(now.getTime() + 45 * 60 * 1000), // +45 mins
              updatedAt: now,
            },
          }
        );

        // Log activity once (store both keys to satisfy any validator variant)
        const customerId = q.customerId || q.userId || null;
        const userId = q.userId || q.customerId || null;

        await db.collection("activitylog").insertOne({
          customerId,
          userId,
          venueId: q.venueId,
          type: "queue.near_turn",
          at: now,
          createdAt: now,
          meta: { order: q.order, position: q.position },
        });
      }
    }
  }

  // --- 4) Expire near-turns past the deadline (if not paused by "I'm here")
  // NOTE: schema enum commonly allows: "active","served","cancelled","no_show"
  // If your schema allows "expired", change the status and type accordingly.
  const toExpire = await db
    .collection("queue")
    .find({
      status: "active",
      timerPaused: { $ne: true },
      arrivalDeadline: { $lte: now },
    })
    .toArray();

  for (const q of toExpire) {
    await db
      .collection("queue")
      .updateOne(
        { _id: q._id },
        { $set: { status: "no_show", updatedAt: now } }
      );

    const customerId = q.customerId || q.userId || null;
    const userId = q.userId || q.customerId || null;

    await db.collection("activitylog").insertOne({
      customerId,
      userId,
      venueId: q.venueId,
      type: "queue.no_show", // use "queue.expired" if your enum requires
      at: now,
      createdAt: now,
      meta: { order: q.order, position: q.position },
    });
  }
}

// Run every 30s with a hard error guard so the process never crashes
setInterval(async () => {
  try {
    await tick();
  } catch (err) {
    console.error("[queueWorker] tick failed:", err?.message || err);
    // swallow to keep server alive
  }
}, 30 * 1000);

// Optional: run once on boot (doesn't block startup)
tick().catch((err) => {
  console.error("[queueWorker] initial tick failed:", err?.message || err);
});
