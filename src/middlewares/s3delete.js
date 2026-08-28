const { DeleteObjectCommand } = require("@aws-sdk/client-s3");
const r2Client = require("./r2client");

/**
 * Deletes a file from Cloudflare R2 using the file URL.
 * @param {string} imageUrl - The URL of the file to delete.
 * @returns {Promise<void>}
 */
const deleteFromR2 = async (imageUrl) => {
  const extractFolderAndFileName = (url) => {
    const path = new URL(url).pathname;
    const pathSegments = path.split("/");

    const folder = pathSegments.slice(1, -1).join("/");
    const fileName = pathSegments[pathSegments.length - 1];

    return { folder, fileName };
  };

  const { folder, fileName } = extractFolderAndFileName(imageUrl);

  const deleteParams = {
    Bucket: process.env.R2_BUCKET_NAME,
    Key: `${folder}/${fileName}`,
  };

  try {
    const command = new DeleteObjectCommand(deleteParams);
    await r2Client.send(command);
  } catch (error) {
    console.error("Error deleting file from R2:", error);
    throw new Error("Failed to delete file from R2");
  }
};

module.exports = deleteFromR2;
