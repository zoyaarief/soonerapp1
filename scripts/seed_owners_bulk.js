// scripts/seed_owners_bulk.js
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

// ✅ Same password as your existing single seeder
const OWNER_PASSWORD = "OwnerTest!234";

function lowerEmail(s) {
  return String(s || "")
    .trim()
    .toLowerCase();
}

function ownerSeed({
  manager,
  business,
  type,
  phone,
  email,
  location,
  avatar,
  gallery,
  waitTime = 15,
  totalSeats = 20,
  maxBooking = 4,
  openTime = "9:00 AM",
  closeTime = "9:00 PM",
}) {
  return {
    manager,
    business,
    type: String(type || "").toLowerCase(),
    phone,
    email: lowerEmail(email),
    createdAt: new Date(),
    updatedAt: new Date(),
    // Keep profile minimal & schema-friendly
    profile: {
      displayName: business,
      description: `${business} on Sooner.`,
      location,
      waitTime,
      totalSeats,
      maxBooking,
      avatar,
      gallery,
      openTime,
      closeTime,
    },
  };
}

async function upsertOwner(db, baseDoc, passwordHash) {
  const owners = db.collection("owners");

  // Ensure unique index on email
  await owners.createIndex({ email: 1 }, { unique: true }).catch(() => {});

  const existing = await owners.findOne({ email: baseDoc.email });
  let ownerId;
  if (existing) {
    // Update minimal, commonly-allowed fields
    await owners.updateOne(
      { _id: existing._id },
      {
        $set: {
          manager: baseDoc.manager,
          business: baseDoc.business,
          type: baseDoc.type,
          phone: baseDoc.phone,
          passwordHash, // update to unified test password
          updatedAt: new Date(),
          "profile.displayName": baseDoc.profile.displayName,
          "profile.description": baseDoc.profile.description,
          "profile.location": baseDoc.profile.location,
          "profile.waitTime": baseDoc.profile.waitTime,
          "profile.totalSeats": baseDoc.profile.totalSeats,
          "profile.maxBooking": baseDoc.profile.maxBooking,
          "profile.avatar": baseDoc.profile.avatar,
          "profile.gallery": baseDoc.profile.gallery,
          "profile.openTime": baseDoc.profile.openTime,
          "profile.closeTime": baseDoc.profile.closeTime,
        },
      }
    );
    ownerId = existing._id;
  } else {
    const r = await owners.insertOne({ ...baseDoc, passwordHash });
    ownerId = r.insertedId;
  }

  // Settings as STRING ownerId
  const ownerIdStr = String(ownerId);
  const ownerSettings = db.collection("owner_settings");
  await ownerSettings
    .createIndex({ ownerId: 1 }, { unique: true })
    .catch(() => {});
  await ownerSettings.updateOne(
    { ownerId: ownerIdStr },
    {
      $set: {
        ownerId: ownerIdStr,
        walkinsEnabled: true,
        queueActive: true,
        openStatus: "open",
        updatedAt: new Date(),
      },
    },
    { upsert: true }
  );

  // Optional announcement (skip if blocked by validator)
  const announcements = db.collection("announcements");
  await announcements
    .createIndex({ ownerId: 1, createdAt: -1 })
    .catch(() => {});
  try {
    await announcements.updateOne(
      { ownerId: ownerIdStr, type: "announcement" },
      {
        $set: {
          ownerId: ownerIdStr,
          venueId: ownerIdStr,
          message: "✨ Now on Sooner — walk-ins welcome!",
          type: "announcement",
          visible: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      },
      { upsert: true }
    );
  } catch {
    // silently skip if validator rejects
  }

  return ownerIdStr;
}

async function main() {
  const client = new MongoClient(uri, { maxPoolSize: 5 });
  await client.connect();
  const db = client.db(dbName);

  const passwordHash = await bcrypt.hash(OWNER_PASSWORD, 10);

  // Shared, simple image defaults (unsplash links are fine; swap if validator blocks)
  const defaultAvatar =
    "https://images.unsplash.com/photo-1517245386807-bb43f82c33c4?w=800&q=60";
  const defaultGallery = [
    "https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=1200&q=60",
  ];

  // ---------- 10 owners across different services ----------
  const seeds = [
    ownerSeed({
      manager: "Ava Brooks",
      business: "Velvet Shears Salon",
      type: "salon",
      phone: "+1 617 555 1101",
      email: "owner.salon@sooner.test",
      location: "Somerville, MA",
      avatar: defaultAvatar,
      gallery: defaultGallery,
      waitTime: 25,
      totalSeats: 12,
      maxBooking: 2,
    }),
    ownerSeed({
      manager: "Dr. Liam Carter",
      business: "Riverside Family Clinic",
      type: "clinic",
      phone: "+1 617 555 1102",
      email: "owner.clinic@sooner.test",
      location: "Cambridge, MA",
      avatar: defaultAvatar,
      gallery: defaultGallery,
      waitTime: 15,
      totalSeats: 8,
      maxBooking: 1,
    }),
    ownerSeed({
      manager: "Maya Patel",
      business: "Chapter & Chai Bookstore",
      type: "bookstore",
      phone: "+1 617 555 1103",
      email: "owner.bookstore@sooner.test",
      location: "Boston, MA",
      avatar: defaultAvatar,
      gallery: defaultGallery,
      waitTime: 5,
      totalSeats: 10,
      maxBooking: 4,
    }),
    ownerSeed({
      manager: "Noah Kim",
      business: "Serenity Springs Spa",
      type: "spa",
      phone: "+1 617 555 1104",
      email: "owner.spa@sooner.test",
      location: "Brookline, MA",
      avatar: defaultAvatar,
      gallery: defaultGallery,
      waitTime: 30,
      totalSeats: 10,
      maxBooking: 2,
    }),
    ownerSeed({
      manager: "Zoe Martinez",
      business: "PulsePoint Gym",
      type: "gym",
      phone: "+1 617 555 1105",
      email: "owner.gym@sooner.test",
      location: "Cambridge, MA",
      avatar: defaultAvatar,
      gallery: defaultGallery,
      waitTime: 10,
      totalSeats: 30,
      maxBooking: 6,
    }),
    ownerSeed({
      manager: "Ethan Ross",
      business: "Beacon Barbershop",
      type: "barbershop",
      phone: "+1 617 555 1106",
      email: "owner.barbershop@sooner.test",
      location: "Boston, MA",
      avatar: defaultAvatar,
      gallery: defaultGallery,
      waitTime: 20,
      totalSeats: 6,
      maxBooking: 2,
    }),
    ownerSeed({
      manager: "Lena Nguyen",
      business: "Early Bird Bakery",
      type: "bakery",
      phone: "+1 617 555 1107",
      email: "owner.bakery@sooner.test",
      location: "Somerville, MA",
      avatar: defaultAvatar,
      gallery: defaultGallery,
      openTime: "7:00 AM",
      closeTime: "7:00 PM",
      waitTime: 8,
      totalSeats: 14,
      maxBooking: 4,
    }),
    ownerSeed({
      manager: "Jackson Lee",
      business: "Cornerstone Cafe",
      type: "cafe",
      phone: "+1 617 555 1108",
      email: "owner.cafe@sooner.test",
      location: "Cambridge, MA",
      avatar: defaultAvatar,
      gallery: defaultGallery,
      waitTime: 12,
      totalSeats: 22,
      maxBooking: 4,
    }),
    ownerSeed({
      manager: "Priya Shah",
      business: "GreenCross Pharmacy",
      type: "pharmacy",
      phone: "+1 617 555 1109",
      email: "owner.pharmacy@sooner.test",
      location: "Boston, MA",
      avatar: defaultAvatar,
      gallery: defaultGallery,
      waitTime: 6,
      totalSeats: 5,
      maxBooking: 1,
    }),
    ownerSeed({
      manager: "Dr. Marco De Luca",
      business: "Harborview Dental",
      type: "dentist",
      phone: "+1 617 555 1110",
      email: "owner.dentist@sooner.test",
      location: "East Boston, MA",
      avatar: defaultAvatar,
      gallery: defaultGallery,
      waitTime: 18,
      totalSeats: 6,
      maxBooking: 1,
    }),
  ];

  const created = [];
  for (const seed of seeds) {
    try {
      const ownerIdStr = await upsertOwner(db, seed, passwordHash);
      created.push({ email: seed.email, ownerId: ownerIdStr, type: seed.type });
      console.log(
        `✅ Upserted: ${seed.business} (${seed.email}) -> _id ${ownerIdStr}`
      );
    } catch (e) {
      console.error(`❌ Failed for ${seed.email}:`, e?.message || e);
    }
  }

  // Helpful indexes (safe to call; ignore failures)
  try {
    await Promise.all([
      db
        .collection("owners")
        .createIndex({ type: 1 })
        .catch(() => {}),
      db
        .collection("owners")
        .createIndex({ "profile.displayName": 1 })
        .catch(() => {}),
      db
        .collection("owners")
        .createIndex({ "profile.rating": -1 })
        .catch(() => {}),
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
  } catch {}

  console.log("\n=========== Login Credentials ===========");
  console.log("Password (all 10 owners):", OWNER_PASSWORD);
  for (const row of created) {
    console.log(`  Email: ${row.email}   (type: ${row.type})`);
  }
  console.log("========================================\n");

  await client.close();
  console.log("✅ Bulk seed complete.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
