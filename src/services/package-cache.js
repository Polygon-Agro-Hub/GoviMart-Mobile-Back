const cache = require("../cache/cache");
const ProductDao = require("../dao/product.dao");

const DEFAULT_PACKAGES_CACHE_KEY = "govimart_active_packages";

/**
 * Retrieve cached packages if available for default list.
 */
function getCachedPackages(search) {
  if (!search || search.trim() === "") {
    const data = cache.get(DEFAULT_PACKAGES_CACHE_KEY);
    if (Array.isArray(data) && data.length > 0) {
      return data;
    }
  }
  return null;
}

/**
 * Set packages in memory cache.
 */
function setCachedPackages(packages) {
  if (Array.isArray(packages) && packages.length > 0) {
    cache.set(DEFAULT_PACKAGES_CACHE_KEY, packages);
    console.log(`⚡ [PackageCache] Cached ${packages.length} active packages in memory.`);
  }
}

/**
 * Invalidate / clear package cache.
 */
function clearPackageCache() {
  cache.del(DEFAULT_PACKAGES_CACHE_KEY);
  console.log("🧹 [PackageCache] Invalidated package cache.");
}

/**
 * Fetch fresh package data from DB, refresh the in-memory cache, and return results.
 */
async function refreshPackageCache() {
  try {
    const packages = await ProductDao.getAllProductDao("");
    setCachedPackages(packages);
    return packages;
  } catch (err) {
    console.error("❌ [PackageCache] Error refreshing package cache:", err);
    throw err;
  }
}

module.exports = {
  getCachedPackages,
  setCachedPackages,
  clearPackageCache,
  refreshPackageCache,
};
