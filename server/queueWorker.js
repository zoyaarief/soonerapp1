// server/queueWorker.js
// Runs a lightweight maintenance loop for queue near-turn + expiry handling.
// Safe with your current queue schema and won't crash the server on validation errors.

import { getDb } from "./db.js";

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
    await db.collection("queue").updateOne(
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
