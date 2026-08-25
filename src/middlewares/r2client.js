const { S3Client } = require("@aws-sdk/client-s3");

/**
 * Shared Cloudflare R2 client instance.
 * Imported by s3upload.js and s3delete.js to avoid duplicate instantiation.
 */
const r2Client = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
  forcePathStyle: true,
});

module.exports = r2Client;
