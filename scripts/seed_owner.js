// scripts/seed_owner.js
import dotenv from "dotenv";
import { MongoClient } from "mongodb";
import bcrypt from "bcrypt";

dotenv.config();

const uri = process.env.MONGODB_URI;
const dbName = process.env.DB_NAME;

if (!uri || !dbName) {
  console.error("❌ Missing MONGODB_URI or DB_NAME in .env");
  process.exit(1);
}

const OWNER_EMAIL = "owner.demo@sooner.test";
const OWNER_PASSWORD = "OwnerTest!234";

async function main() {
  const client = new MongoClient(uri, { maxPoolSize: 5 });
  await client.connect();
  const db = client.db(dbName);

  // ------------ Build a schema-friendly owner ------------
  // Keep fields minimal and types simple to satisfy most $jsonSchema validators.
  const passwordHash = await bcrypt.hash(OWNER_PASSWORD, 10);
  const ownerDoc = {
    manager: "Demo Manager",
    business: "Sooner Demo Bistro",
    // Most validators expect lowercase enumerated types:
    type: "restaurant", // << IMPORTANT: lowercase
    phone: "+1 617 555 1000",
    email: OWNER_EMAIL.toLowerCase(),
    passwordHash,
    createdAt: new Date(),
    updatedAt: new Date(),

    // Minimal profile: use only fields commonly permitted
    profile: {
      displayName: "Sooner Demo Bistro",
      description: "Modern bistro serving seasonal dishes.",
      location: "Cambridge, MA",
      // Keep these basic to reduce validation risk:
      waitTime: 20,
      totalSeats: 40,
      maxBooking: 6,
      // If your validator doesn’t allow these, comment them out:
      // cuisine: "American",
      // approxPrice: "2 people · $60",
      // features: "Outdoor seating, wheelchair access",
      // rating: 4.6,
      avatar:
        "https://images.unsplash.com/photo-1528605248644-14dd04022da1?w=800&q=60",
      gallery: [
        "https://images.unsplash.com/photo-1559339352-11d035aa65de?w=1200&q=60",
      ],
      openTime: "10:00 AM",
      closeTime: "11:00 PM",
    },
  };

  // ------------ Upsert owner (handle unique email) ------------
  const owners = db.collection("owners");
  await owners.createIndex({ email: 1 }, { unique: true }).catch(() => {});
  let ownerId;

  const existing = await owners.findOne({ email: ownerDoc.email });
  if (existing) {
    // Update only the fields that are almost always allowed by validators
    try {
      await owners.updateOne(
        { _id: existing._id },
        {
          $set: {
            manager: ownerDoc.manager,
            business: ownerDoc.business,
            type: ownerDoc.type,
            phone: ownerDoc.phone,
            passwordHash: ownerDoc.passwordHash,
            updatedAt: new Date(),
            // profile update kept minimal
            "profile.displayName": ownerDoc.profile.displayName,
            "profile.description": ownerDoc.profile.description,
            "profile.location": ownerDoc.profile.location,
            "profile.waitTime": ownerDoc.profile.waitTime,
            "profile.totalSeats": ownerDoc.profile.totalSeats,
            "profile.maxBooking": ownerDoc.profile.maxBooking,
            "profile.avatar": ownerDoc.profile.avatar,
            "profile.gallery": ownerDoc.profile.gallery,
            "profile.openTime": ownerDoc.profile.openTime,
            "profile.closeTime": ownerDoc.profile.closeTime,
          },
        }
      );
      ownerId = existing._id;
    } catch (e) {
      console.error(
        "❌ owners.updateOne failed validation:",
        JSON.stringify(e, null, 2)
      );
      throw e;
    }
  } else {
    try {
      const r = await owners.insertOne(ownerDoc);
      ownerId = r.insertedId;
    } catch (e) {
      console.error("❌ owners.insertOne failed validation. Details:");
      console.error(JSON.stringify(e, null, 2));
      console.error("\nℹ️ Run this in mongosh to see your validator:\n");
      console.error(
        'db.getCollectionInfos({ name: "owners" })[0].options.validator'
      );
      throw e;
    }
  }

  // ------------ Owner settings (store as STRING ownerId) ------------
  const ownerIdStr = String(ownerId);
  const ownerSettings = db.collection("owner_settings");
  await ownerSettings
    .createIndex({ ownerId: 1 }, { unique: true })
    .catch(() => {});
  await ownerSettings.updateOne(
    { ownerId: ownerIdStr },
    {
      $set: {
        ownerId: ownerIdStr, // STRING is important
        walkinsEnabled: true,
        queueActive: true,
        openStatus: "open",
        updatedAt: new Date(),
      },
    },
    { upsert: true }
  );

  // ------------ Announcement (optional; remove if validator blocks) ------------
  const announcements = db.collection("announcements");
  await announcements
    .createIndex({ ownerId: 1, createdAt: -1 })
    .catch(() => {});
  try {
    await announcements.updateOne(
      {
        ownerId: ownerIdStr,
        type: "announcement",
      },
      {
        $set: {
          ownerId: ownerIdStr,
          venueId: ownerIdStr, // some code also checks venueId
          message: "⭐ Happy hour 4–6pm. Walk-ins via Sooner!",
          type: "announcement",
          visible: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      },
      { upsert: true }
    );
  } catch (e) {
    console.warn(
      "⚠️ announcements upsert was blocked by its validator — skipping"
    );
  }

  // ------------ Helpful indexes (safe) ------------
  await Promise.all([
    owners.createIndex({ type: 1 }).catch(() => {}),
    owners.createIndex({ "profile.displayName": 1 }).catch(() => {}),
    owners.createIndex({ "profile.rating": -1 }).catch(() => {}),

    db
      .collection("likes")
      .createIndex({ userId: 1, venueId: 1 }, { unique: true })
      .catch(() => {}),
    db
      .collection("queue")
      .createIndex({ venueId: 1, status: 1, order: 1 })
      .catch(() => {}),
    db
      .collection("queue")
      .createIndex({ userId: 1, status: 1 })
      .catch(() => {}),
  ]);

  console.log("✅ Seed complete.");
  console.log("Owner _id:", ownerIdStr);
  console.log("Login with:");
  console.log("  Email   :", OWNER_EMAIL);
  console.log("  Password:", OWNER_PASSWORD);

  await client.close();
}

main().catch((e) => {
  process.exit(1);
});
