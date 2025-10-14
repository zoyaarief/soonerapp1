// scripts/seed_queue.js
import { MongoClient, ObjectId } from "mongodb";
import dotenv from "dotenv";
dotenv.config();

/**
 * USAGE:
 *   OWNER_ID=68eca3fe4bc49f3b1c2ee99e node scripts/seed_queue.js
 *   # or
 *   node scripts/seed_queue.js 68eca3fe4bc49f3b1c2ee99e
 */

const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.DB_NAME || "sooner";
const OWNER_ID = (process.env.OWNER_ID || process.argv[2] || "").trim();

if (!MONGODB_URI) {
  console.error("❌ Missing MONGODB_URI in .env");
  process.exit(1);
}
if (!OWNER_ID) {
  console.error("❌ Missing OWNER_ID (env or CLI arg). Example:");
  console.error(
    "   OWNER_ID=68eca3fe4bc49f3b1c2ee99e node scripts/seed_queue.js"
  );
  process.exit(1);
}

const client = new MongoClient(MONGODB_URI, { maxPoolSize: 10 });

function randName() {
  const first = [
    "Alex",
    "Jordan",
    "Taylor",
    "Sam",
    "Chris",
    "Riley",
    "Morgan",
    "Jamie",
    "Priya",
    "Devon",
  ];
  const last = [
    "Lee",
    "Patel",
    "Kim",
    "Garcia",
    "Nguyen",
    "Singh",
    "Brown",
    "Davis",
    "Martinez",
    "Allen",
  ];
  return `${first[(Math.random() * first.length) | 0]} ${last[(Math.random() * last.length) | 0]}`;
}

function party() {
  return Math.max(1, Math.min(6, (Math.random() * 6) | 0));
}

function nowMinus(mins) {
  return new Date(Date.now() - mins * 60 * 1000);
}

async function getQueueValidator(db) {
  const meta = await db.command({
    listCollections: 1,
    filter: { name: "queue" },
  });
  const entry = meta?.cursor?.firstBatch?.[0];
  return entry?.options?.validator || null;
}

function wantsObjectId(validator) {
  try {
    const props =
      validator?.$jsonSchema?.properties ||
      validator?.validator?.$jsonSchema?.properties ||
      {};
    const vid = props.venueId?.bsonType || props.venueId?.type;
    const rid = props.restaurantId?.bsonType || props.restaurantId?.type;
    const toArr = (x) => (Array.isArray(x) ? x : x ? [x] : []);
    const vArr = toArr(vid).map((s) => String(s).toLowerCase());
    const rArr = toArr(rid).map((s) => String(s).toLowerCase());
    const vWantsObjId = vArr.includes("objectid") && !vArr.includes("string");
    const rWantsObjId = rArr.includes("objectid") && !rArr.includes("string");
    return vWantsObjId || rWantsObjId;
  } catch {
    return false;
  }
}

function buildEntries({ ownerIdAsString, ownerIdAsObjectId, useObjectId }) {
  const idStr = String(ownerIdAsString);
  const idObj =
    ownerIdAsObjectId instanceof ObjectId
      ? ownerIdAsObjectId
      : new ObjectId(ownerIdAsString);

  const venueId = useObjectId ? idObj : idStr;
  const restaurantId = useObjectId ? idObj : idStr;

  const entries = [];
  let order = 1;

  for (let i = 0; i < 10; i++) {
    const name = randName();
    const size = party();

    const joinedAt = nowMinus(30 - i * 2);
    const createdAt = joinedAt;

    const isNear = i < 5;
    const nearTurnAt = isNear ? nowMinus(10) : null;
    const arrivalDeadline = isNear
      ? new Date(nearTurnAt.getTime() + 45 * 60 * 1000)
      : null;

    entries.push({
      venueId, // string or ObjectId (schema-dependent)
      restaurantId, // keep in sync with venueId
      userId: new ObjectId(),

      name,
      email: "",
      phone: "",

      people: size,
      partySize: size,

      status: "waiting",
      order,
      position: order,

      joinedAt,
      createdAt,

      nearTurnAt,
      arrivalDeadline,
      timerPaused: false,
    });

    order++;
  }
  return entries;
}

// ✅ FIX: do NOT set the same field in both $setOnInsert and $set
async function ensureOwnerSettings(db, ownerIdStr) {
  const Settings = db.collection("owner_settings");
  await Settings.updateOne(
    { ownerId: ownerIdStr }, // store as STRING consistently in settings
    {
      $setOnInsert: {
        ownerId: ownerIdStr,
        walkinsEnabled: true,
        openStatus: "open",
        queueActive: true,
      },
      $set: { updatedAt: new Date() }, // only here, not also in $setOnInsert
    },
    { upsert: true }
  );
}

function prettyPrintValidationError(err) {
  const writeErr = err?.writeErrors?.[0]?.err;
  const errInfo = writeErr?.errInfo || writeErr?.errmsg || err?.errorResponse;
  console.error("❌ Document failed validation. Details:");
  console.dir(errInfo, { depth: 10, colors: true });
}

async function tryInsert(db, entries, { bypass = false } = {}) {
  try {
    const r = await db.collection("queue").insertMany(entries, {
      ordered: true,
      bypassDocumentValidation: !!bypass,
    });
    return { ok: true, insertedCount: r.insertedCount };
  } catch (e) {
    return { ok: false, error: e };
  }
}

async function main() {
  await client.connect();
  const db = client.db(DB_NAME);

  const validator = await getQueueValidator(db);
  if (validator) console.log("ℹ️ queue validator detected.");
  else console.log("ℹ️ queue has no validator (or none returned).");

  const preferObjectId = wantsObjectId(validator);
  console.log(
    "→ Using",
    preferObjectId ? "ObjectId" : "String",
    "for venueId/restaurantId."
  );

  const owner = await db.collection("owners").findOne({
    $or: [{ _id: new ObjectId(OWNER_ID) }, { _id: OWNER_ID }],
  });
  if (!owner) {
    console.warn(
      "⚠️  No owner found with that id in 'owners'. Proceeding anyway."
    );
  }

  // ensure settings (string id)
  const ownerIdStr = String(OWNER_ID);
  await ensureOwnerSettings(db, ownerIdStr);

  // clean old waiting docs for either id type
  await db.collection("queue").deleteMany({
    $or: [
      { venueId: ownerIdStr },
      { restaurantId: ownerIdStr },
      { venueId: new ObjectId(OWNER_ID) },
      { restaurantId: new ObjectId(OWNER_ID) },
    ],
    status: "waiting",
  });

  const entriesPreferred = buildEntries({
    ownerIdAsString: ownerIdStr,
    ownerIdAsObjectId: new ObjectId(OWNER_ID),
    useObjectId: preferObjectId,
  });

  let result = await tryInsert(db, entriesPreferred, { bypass: false });
  if (!result.ok) {
    console.warn("⚠️ Insert failed with preferred id type. Details next:");
    prettyPrintValidationError(result.error);

    const entriesAlternate = buildEntries({
      ownerIdAsString: ownerIdStr,
      ownerIdAsObjectId: new ObjectId(OWNER_ID),
      useObjectId: !preferObjectId,
    });

    console.log(
      "↻ Retrying with alternate id type:",
      !preferObjectId ? "ObjectId" : "String"
    );
    result = await tryInsert(db, entriesAlternate, { bypass: false });

    if (!result.ok) {
      console.warn("⚠️ Second attempt failed. Details next:");
      prettyPrintValidationError(result.error);

      console.warn(
        "🛟 Bypassing document validation just for seeding (local/dev)."
      );
      const bypassRes = await tryInsert(db, entriesAlternate, { bypass: true });
      if (!bypassRes.ok) {
        console.error("❌ Even bypass insert failed.");
        prettyPrintValidationError(bypassRes.error);
        await client.close();
        process.exit(1);
      } else {
        console.log(
          `✅ Seeded ${bypassRes.insertedCount} queue docs (validation bypassed).`
        );
      }
    } else {
      console.log(
        `✅ Seeded ${result.insertedCount} queue docs (alternate id type).`
      );
    }
  } else {
    console.log(
      `✅ Seeded ${result.insertedCount} queue docs (preferred id type).`
    );
  }

  // capacity for charts
  await db
    .collection("owners")
    .updateOne(
      { $or: [{ _id: new ObjectId(OWNER_ID) }, { _id: OWNER_ID }] },
      { $set: { "profile.totalSeats": 40 } }
    );

  await client.close();
}

main().catch(async (e) => {
  console.error(e);
  try {
    await client.close();
  } catch {}
  process.exit(1);
});
