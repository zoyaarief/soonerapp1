# Sooner — Virtual Walk‑In Queue Manager

Sooner is a Node.js + Express + Vanilla JS web app that lets **walk‑in customers** join a **virtual queue** for venues (restaurants, salons, clinics, events), and lets **venue owners** manage walk‑ins efficiently. Customers browse venues, view real‑time queue stats, enter/cancel the queue, get a 45‑minute *near‑turn* timer, and post reviews after they’re served.

> **Status:** actively developed. This repo contains both the backend (Node/Express/MongoDB) and a vanilla‑JS frontend (no frameworks).

---

## Features (Customer‑facing)

- Browse venues with **search & filters** (type, city, cuisine, rating).
- **Place page** with live stats: number in queue, approx wait, your position, seats left, status (“Open/Closed”), gallery, features, hours.
- **Join queue** with robust rules (venue open, walk‑ins enabled capacity available, max party size).
- **Cancel queue** (idempotent) the near‑turn timer.
- **45‑minute timer** that **starts at position ≤ 5**, persists across reloads, and pauses on arrival.
- **User dashboard** shows **Active Queue** and **Venues for Today** (favorites + recents; hides sections when empty).
- **Ratings & reviews** ; shows latest reviews per venue.

## Features (Owner‑facing – handled by teammate)

- Owner signup/login, profile, gallery management.
- Owner settings:  `walkinsEnabled`, `totalSeats`, `avgWaitMins`, `maxBooking`.
- Queue operations: serve, cancel post announcements.
- Dashboard to watch live queue & control parameters.

---

## Tech Stack

- **Backend:** Node.js, Express, MongoDB (Atlas).
- **Frontend:** Vanilla JavaScript (ES Modules), HTML, CSS (modular files per page).
- **Auth:** Session‑based (cookie), customer and owner roles.
- **Build/Style:** Prettier (format), ESLint (lint).
- **License:** MIT.

---

## Project Structure (key parts)

```
server/
  server.js
  api.routes.js
  db.js
  api.owner.js
  api.owner.sse.js
  api.likes.js
  api.reviews.js
  api.history.js
  queueWorker.js

public/
  index.html
  browse.html
  place.html
  userDashboard.html
  ownerSignUp.html
  ownerDashboard.html
  ownerProfile.html
  userProfile.html

  js/
    browse.js
    place.js
    userDashboard.js
    ownerDashboard.js
    ownerProfile.js

  css/
    browse.css
    place.css
    userDashboard.css
    ownerDashboard.css
    ownerProfile.css
    ownerSignUp.css
    userProfile.css
    flashscreen.css
```

---

## Key API Endpoints (Customer‑relevant)

- `GET /api/owners/public`
- `GET /api/owners/public/:id`
- `GET /api/queue/metrics/:venueId`
- `POST /api/queue/:venueId/join` *(or `POST /api/queue/join`)*
- `POST /api/queue/:venueId/cancel` *(or `POST /api/queue/cancel`)*
- `POST /api/queue/:venueId/arrived` *(or `POST /api/queue/arrived`)*
- `GET /api/reviews/venue/:venueId`, `POST /api/reviews/add`

> Collections in use: `owners`, `owner_settings`, `queue`, `customers`, `activitylog`, `announcements`, `likes`, `reviews`, `sessions` (and optionally `venues` for legacy/demo).

---

## Queue Rules (Customer join)

- Venue must be **open**, **walk‑ins enabled**, **queue active**.
- **Capacity**: `owner_settings.totalSeats` must have enough spots left (sum of active `partySize`).
- **Max party size**: `owners.profile.maxBooking` (default 12).
- **No duplicates**: same customer cannot have another **active** entry (same venue or any venue).
- Inserted queue doc fields (validator‑friendly): `venueId`, `customerId`, `name`, `email`, `partySize`, `status:"active"`, `joinedAt` (+ bridges: `people`, `order`, `position`).

---

##  45‑Minute Near‑Turn Timer

- Starts automatically the first time **position ≤ 5**.
- Persisted in `localStorage` per venue; survives polling/reloads.
- “I’m here” pauses the countdown; auto‑hides on cancel/leave/served.
- Optional auto‑cancel on expiry (disabled by default).

---

## Environment

Create `.env` in project root:

```
PORT=3000
MONGODB_URI=<your Atlas connection string>
SESSION_SECRET=<random strong secret>
NODE_ENV=development
```

> **Never commit secrets.** Use environment variables in deployment.

---

## Run Locally

```bash
npm install
npm run lint      # optional
npm run format    # optional
npm start         # node server/server.js
```

---

## Credentials to test the site without creating a new account 
Owner email : owner.demo@sooner.test
Owner password : OwnerTest!234

Customer email : jeishu@example.com
Customer Password : test1234


## Screenshots 
# 1. Flashscreen 

<img width="1701" height="931" alt="Screenshot 2025-10-15 at 12 44 18 AM" src="https://github.com/user-attachments/assets/ea09c880-2517-48a1-bf56-6e40b2cadd54" />

# 2. Customer/Owner Login

<img width="1698" height="919" alt="Screenshot 2025-10-15 at 12 44 43 AM" src="https://github.com/user-attachments/assets/ca3f4011-110d-44d8-8571-b8c248c4dcd9" />

# 3. Customer/Owner Sign Up 

<img width="1709" height="915" alt="Screenshot 2025-10-15 at 12 45 10 AM" src="https://github.com/user-attachments/assets/b8c4790a-c69e-414c-9b28-61ba7c7e82d3" />

# 4. Owner Profile 

<img width="1703" height="936" alt="Screenshot 2025-10-15 at 12 47 43 AM" src="https://github.com/user-attachments/assets/427afa98-aa5c-44e0-8cee-39ca5d6cc939" />

# 5. Owner Dashboard

<img width="1700" height="928" alt="Screenshot 2025-10-15 at 12 48 00 AM" src="https://github.com/user-attachments/assets/4551eaea-0411-41ef-9d8a-bd6f00d00635" />
<img width="1707" height="931" alt="Screenshot 2025-10-15 at 12 48 58 AM" src="https://github.com/user-attachments/assets/15a26af3-8271-4846-8048-6992aceaa814" />
<img width="1705" height="936" alt="Screenshot 2025-10-15 at 12 49 44 AM" src="https://github.com/user-attachments/assets/c8568e7e-88c8-4486-8295-e4f777fc67a5" />

# 6. Customer Home 

<img width="1710" height="937" alt="Screenshot 2025-10-15 at 12 50 43 AM" src="https://github.com/user-attachments/assets/956efc99-ade7-445a-8b7e-2d01f4469098" />

# 7. Customer Browse 

<img width="1710" height="930" alt="Screenshot 2025-10-15 at 12 51 05 AM" src="https://github.com/user-attachments/assets/0d6f85ee-7756-43fb-a76e-8a6c905276cd" />

# 8. Customer join Queue 

<img width="1706" height="932" alt="Screenshot 2025-10-15 at 12 51 37 AM" src="https://github.com/user-attachments/assets/54703b88-c91f-4183-808c-b934e2252a8f" />
<img width="1699" height="932" alt="Screenshot 2025-10-15 at 12 51 54 AM" src="https://github.com/user-attachments/assets/6fd96035-1316-4adf-be90-6b8460575c8c" />

# 8. Customer Ratings and Reviews 

 <img width="1709" height="935" alt="Screenshot 2025-10-15 at 12 52 30 AM" src="https://github.com/user-attachments/assets/74dc2c92-48f5-4ea6-9ec1-0dda48a7f03d" />

 ## Links 
 Video : 
 PPT : https://docs.google.com/presentation/d/1cVWZcI5oWXF61Pi0T7_qGKIw4BhI1c3W64k8r-3LHjQ/edit?slide=id.g38c488987de_0_1#slide=id.g38c488987de_0_1
 Design Document : `DESIGN.md`

## Author 
- 1. Nandana Pradeep - pradeep.na@northeastern.edu
- 2. Piriyajeishree Murali Naidu - muralinaidu.p@northeastern.edu

##  Rubric Mapping

- **Project description:** See top.
- **Personas & Stories:** See `DESIGN.md`.
- **Mockups:** See `DESIGN.md`.
- **Usable/Useful:** Virtual queue reduces physical waiting.
- **ESLint/Prettier:** Sample configs below.
- **Organization & Modules:** Server/client split; per‑page CSS/JS; `db.js` connector.
- **Vanilla JS CSR:** place.js, browse.js, userDashboard.js.
- **Forms:** Owner signup/profile; Reviews form; Join queue input.
- **Deployed:** Add URL when ready.
- **Mongo CRUD:** owners, owner_settings, queue, reviews, likes.
- **Node + Express:** Yes.
- **No secrets in repo:** Use `.env`.
- **MIT License:** Included.
- **package.json** present.

### Lint/Format configs

`.eslintrc.json`:
```json
{
  "env": { "es2022": true, "node": true, "browser": true },
  "extends": ["eslint:recommended"],
  "parserOptions": { "ecmaVersion": "latest", "sourceType": "module" },
  "rules": {
    "no-unused-vars": ["warn", { "argsIgnorePattern": "^_" }],
    "no-undef": "error",
    "no-console": "off"
  },
  "ignorePatterns": ["public/js/vendor/**","**/*.min.js"]
}
```

`.prettierrc`:
```json
{ "semi": true, "singleQuote": false, "printWidth": 100, "trailingComma": "es5" }
```

---


## License

MIT — see `LICENSE`.
