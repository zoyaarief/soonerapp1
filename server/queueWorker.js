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

  // 1) venues with waiting customers (guard against nulls/mixed types)
  let venues = [];
  try {
    venues = (
      await db.collection("queue").distinct("venueId", { status: "waiting" })
    ).filter((v) => v !== null && v !== undefined);
  } catch (e) {
    console.warn("distinct(venueId) failed:", e?.message || e);
    venues = [];
  }

  for (const venueId of venues) {
    // 2) waiting list for venue, sorted robustly
    const filter = {
      ...venueIdOrVariantsFilter(venueId),
      status: "waiting",
    };
    const waitingList = await db
      .collection("queue")
      .find(filter)
      .sort({ order: 1, position: 1, joinedAt: 1 })
      .toArray();

    // 3) mark top 5 as near-turn
    const topFive = waitingList.slice(0, 5);
    for (const q of topFive) {
      if (!q.nearTurnAt) {
        await db.collection("queue").updateOne(
          { _id: q._id },
          {
            $set: {
              nearTurnAt: now,
              arrivalDeadline: new Date(now.getTime() + 45 * 60 * 1000), // 45 min
            },
          }
        );

        // schema-friendly activity
        await safeInsertActivity(db, {
          type: "queue.near_turn",
          at: now,
          userId: q.userId,
          venueId: q.venueId,
          restaurantId: q.restaurantId,
          meta: { order: q.order ?? q.position ?? 0 },
        });
      }
    }
  }

  // 4) mark expired after deadline (not paused)
  const expired = await db
    .collection("queue")
    .find({
      status: "waiting",
      timerPaused: { $ne: true },
      arrivalDeadline: { $lte: now },
    })
    .toArray();

  for (const q of expired) {
    await db
      .collection("queue")
      .updateOne(
        { _id: q._id },
        { $set: { status: "expired", updatedAt: now } }
      );

    await safeInsertActivity(db, {
      type: "queue.expired",
      at: now,
      userId: q.userId,
      venueId: q.venueId,
      restaurantId: q.restaurantId,
      meta: { order: q.order ?? q.position ?? 0 },
    });
  }
}

// --- run every 30s, never crash the process ---
setInterval(async () => {
  try {
    await tick();
  } catch (err) {
    console.error("queueWorker tick failed (continuing):", err?.message || err);
  }
}, 30 * 1000);

// one immediate warm-up tick (non-blocking)
tick().catch((err) =>
  console.error(
    "initial queueWorker tick failed (continuing):",
    err?.message || err
  )
);
