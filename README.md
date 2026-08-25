# GoviMart Mobile API — Backend Service

Node.js / Express 5 backend API service for **GoviMart / Polygon**, handling marketplace user authentication, customer management, produce products & packages, order histories, complaints, and Cloudflare R2 media storage.

---

## 🛠 Tech Stack

- **Runtime**: Node.js
- **Framework**: Express (`^5.1.0`)
- **Database**: MySQL2 connection pool (`^3.15.3`) connected to multiple database instances (`plant_care`, `collection_officer`, `marketPlace`, `agro_world_admin`)
- **Authentication**: JSON Web Tokens (`jsonwebtoken`), `bcrypt` password hashing
- **Validation**: `joi` (`^18.0.2`)
- **Storage**: Cloudflare R2 / AWS S3 SDK (`@aws-sdk/client-s3`)
- **SMS Gateway**: Shoutout API (HTTP API)
- **Email**: Nodemailer (`^9.0.3`) via SMTP
- **Documentation**: Swagger UI Express (`swagger-ui-express`, `swagger-jsdoc`)

---

## 🚀 Getting Started

### 1. Prerequisites

- Node.js (v18+)
- MySQL Server (with required GoviMart schemas)

### 2. Environment Setup

1. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```
2. Fill in database credentials, JWT secret, Cloudflare R2 credentials, and SMS/Email service credentials in `.env`.

### 3. Installation

```bash
npm install
```

### 4. Running the Server

```bash
# Start dev server with nodemon auto-reload
npm run dev

# Start production server
npm run start
```

Default Base URL: `http://localhost:3000/polygon/`  
Health Check: `GET /polygon/health`

---

## 📂 Project Structure

```
GoviMart-Mobile-API/
├── server.js                   # Main Express application entry & route mounts
├── api/
│   └── index.js                # Serverless entry point for Vercel deployment
├── startup/
│   └── database.js             # MySQL database connection pools (plantcare, collectionofficer, marketPlace, admin)
├── routes/                     # Express router definitions (auth, customer, home, order, product, complaint, health)
├── endpoint/                   # Business logic and request controller handlers
├── dao/                        # Data Access Objects (SQL queries)
├── middlewares/                # Custom middleware (auth token verification, rate limiter, multer upload, R2 client)
├── validations/                # Joi validation schemas
├── assets/                     # Email templates & logo resources
└── vercel.json                 # Vercel deployment configuration
```

---

## 🛡 Security Features

- Rate limiting on login endpoints (5 attempts per 15 minutes per IP).
- Stale attempt cleanup on rate-limiter maps to prevent memory leaks.
- Cloudflare R2 credentials managed via shared client singleton (`r2client.js`).
- OTP values stripped from production logs.
- Environment variables secured in `.env` (excluded from git tracking).
