const { PutObjectCommand } = require("@aws-sdk/client-s3");
const { v4: uuidv4 } = require("uuid");
const convert = require("heic-convert");
const r2Client = require("./r2client");

// Detect HEIC/HEIF by magic bytes (ftyp box), since the extension or
// mimetype can be wrong (iOS sometimes labels HEIC files as .jpg)
const isHeic = (buffer) => {
  if (!buffer || buffer.length < 12) return false;
  if (buffer.toString("ascii", 4, 8) !== "ftyp") return false;
  const brand = buffer.toString("ascii", 8, 12).toLowerCase();
  return ["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"].includes(brand);
};

const getContentType = (ext) => {
  const mimeTypes = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
    pdf: "application/pdf",
    txt: "text/plain",
    json: "application/json",
    mp4: "video/mp4",
    mp3: "audio/mpeg",
  };
  return mimeTypes[ext.toLowerCase()] || "application/octet-stream";
};

/**
 * @param {Buffer} fileBuffer
 * @param {string} fileName
 * @param {string} keyPrefix
 * @returns {Promise<string>} file URL
 */
const uploadFileToS3 = async (fileBuffer, fileName, keyPrefix) => {
  try {
    let body = fileBuffer;
    let fileExtension = (fileName.split(".").pop() || "").toLowerCase();

    // Convert HEIC/HEIF -> JPEG so browsers can display it
    if (isHeic(fileBuffer) || ["heic", "heif"].includes(fileExtension)) {
      const converted = await convert({
        buffer: fileBuffer,
        format: "JPEG", // use "PNG" if you prefer lossless
        quality: 0.9,
      });
      body = Buffer.from(converted);
      fileExtension = "jpg";
    }

    const uniqueFileName = `${uuidv4()}.${fileExtension}`;
    const key = `${keyPrefix}/${uniqueFileName}`;

    await r2Client.send(
      new PutObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: key,
        Body: body,
        ContentType: getContentType(fileExtension),
      })
    );

    const domain = process.env.R2_ENDPOINT.replace("https://", "");
    return `https://${domain}/${key}`;
  } catch (error) {
    console.error("❌ Error uploading to R2:", error);
    throw new Error("Failed to upload file to R2");
  }
};

module.exports = uploadFileToS3;