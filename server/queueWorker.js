import { getDb } from "./db.js";

setInterval(async () => {
  const db = getDb();
  const now = new Date();

  // 1️. Fetch all venues that currently have waiting customers
  const venues = await db.collection("queue").distinct("venueId", { status: "waiting" });

  for (const venueId of venues) {
    // 2️. Get all waiting queue entries for that venue, sorted by order
    const waitingList = await db.collection("queue")
      .find({ venueId, status: "waiting" })
      .sort({ order: 1 })
      .toArray();

    // 3️. Mark top 5 as "near turn" if not already set
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

        // Log activity once
        await db.collection("activitylog").insertOne({
          userId: q.userId,
          venueId: q.venueId,
          type: "queue.near_turn",
          at: now,
          meta: { order: q.order },
        });
      }
    }
  }

  // 4. Mark expired (after 45 mins, if not paused)
  const expired = await db.collection("queue")
    .find({
      status: "waiting",
      timerPaused: { $ne: true },
      arrivalDeadline: { $lte: now },
    })
    .toArray();

  for (const q of expired) {
    await db.collection("queue").updateOne(
      { _id: q._id },
      { $set: { status: "expired" } }
    );

    await db.collection("activitylog").insertOne({
      userId: q.userId,
      venueId: q.venueId,
      type: "queue.expired",
      at: now,
      meta: { order: q.order },
    });
  }
}, 30 * 1000); // runs every 30 seconds
