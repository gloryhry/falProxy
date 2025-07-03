// main_file_cache_proxy_auth.ts
import {
  Status,
  STATUS_TEXT,
} from "https://deno.land/std@0.208.0/http/status.ts";
import { parse } from "https://deno.land/std@0.208.0/flags/mod.ts";
import { ensureDir } from "https://deno.land/std@0.208.0/fs/ensure_dir.ts";
import { join } from "https://deno.land/std@0.208.0/path/mod.ts";

// --- Configuration ---
const args = parse(Deno.args, {
  string: ["backends", "port", "token", "cache-dir", "proxy-key"], // Added proxy-key
  default: {
    port: "8080",
    "cache-dir": "./image_file_cache",
  },
});

const BACKEND_API_URLS_RAW = args.backends || Deno.env.get("BACKEND_API_URLS");
const PORT = parseInt(args.port || Deno.env.get("PORT") || "8080");
const AUTH_TOKEN = args.token || Deno.env.get("AUTH_TOKEN"); // Token for backend API
const CACHE_DIR = args["cache-dir"] || Deno.env.get("CACHE_DIR") || "./image_file_cache";
const PROXY_ACCESS_KEY = args["proxy-key"] || Deno.env.get("PROXY_ACCESS_KEY"); // Key required for accessing this proxy

if (!BACKEND_API_URLS_RAW) {
  console.error("FATAL: Backend API URLs are not set. Provide via --backends or BACKEND_API_URLS env var.");
  Deno.exit(1);
}
const BACKEND_API_URLS = BACKEND_API_URLS_RAW.split(",").map((url) => url.trim()).filter(Boolean);
if (BACKEND_API_URLS.length === 0) {
  console.error("FATAL: No valid backend API URLs found after parsing.");
  Deno.exit(1);
}

// Make Proxy Access Key mandatory for security
if (!PROXY_ACCESS_KEY) {
    console.error("FATAL: Proxy access key is not set. Provide via --proxy-key or PROXY_ACCESS_KEY env var. This key is required in the '?key=' GET parameter to use the /prompt endpoint.");
    Deno.exit(1);
}

if (!AUTH_TOKEN) {
  console.warn("WARNING: AUTH_TOKEN is not set. Requests to backend APIs will be unauthenticated.");
}

console.log("--- Configuration ---");
console.log(`Proxy Port: ${PORT}`);
console.log(`Backend APIs: ${BACKEND_API_URLS.join(", ")}`);
console.log(`Auth Token for Backends: ${AUTH_TOKEN ? "Set" : "Not Set"}`);
console.log(`Proxy Access Key Required: Yes (Parameter: '?key=...')`);
console.log(`File Cache Directory: ${CACHE_DIR}`);
console.log("--------------------");


// --- File System Caching Logic ---
// Ensure cache directory exists on startup
try { await ensureDir(CACHE_DIR); console.log(`[CACHE_FS] Ensured cache directory exists: ${CACHE_DIR}`); }
catch (error) { console.error(`[CACHE_FS] FATAL: Failed to create/access cache directory ${CACHE_DIR}:`, error); Deno.exit(1); }

interface FsCacheEntry { data: Uint8Array; contentType: string; revisedPrompt?: string; }
interface FsCacheMetadata { contentType: string; originalUrl: string; revisedPrompt?: string; createdAt: string; }

async function generateCacheHash(description: string, width?: number, height?: number, model?: string): Promise<string> { /* ... same as before ... */
    const keyString = `${description.toLowerCase().trim()}|${width || "def"}|${height || "def"}|${model || "def"}`;
    try {
      const data = new TextEncoder().encode(keyString);
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
      return hashHex;
    } catch (error) {
        console.error("[HASH] Error generating cache hash:", error);
        throw new Error(`Failed to generate cache hash: ${error.message}`);
    }
}
function getCacheFilePaths(hash: string): { dataPath: string; metaPath: string } { /* ... same as before ... */
    const dataPath = join(CACHE_DIR, `${hash}.data`);
    const metaPath = join(CACHE_DIR, `${hash}.meta.json`);
    return { dataPath, metaPath };
}
async function getFromFsCache(hash: string): Promise<FsCacheEntry | null> { /* ... same as before ... */
    const { dataPath, metaPath } = getCacheFilePaths(hash);
    try {
      const [metaStat, dataStat] = await Promise.all([ Deno.stat(metaPath).catch(() => null), Deno.stat(dataPath).catch(() => null) ]);
      if (!metaStat || !metaStat.isFile || !dataStat || !dataStat.isFile) return null;
      const metaJson = await Deno.readTextFile(metaPath);
      const metadata = JSON.parse(metaJson) as FsCacheMetadata;
      const data = await Deno.readFile(dataPath);
      return { data, contentType: metadata.contentType, revisedPrompt: metadata.revisedPrompt };
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) console.error(`[CACHE_FS] Error reading cache for hash ${hash}:`, error);
      return null;
    }
}
async function addToFsCache(hash: string, data: Uint8Array, contentType: string, originalUrl: string, revisedPrompt?: string): Promise<void> { /* ... same as before ... */
    const { dataPath, metaPath } = getCacheFilePaths(hash);
    const metadata: FsCacheMetadata = { contentType, originalUrl, revisedPrompt, createdAt: new Date().toISOString() };
    try {
      await Promise.all([ Deno.writeFile(dataPath, data), Deno.writeTextFile(metaPath, JSON.stringify(metadata, null, 2)) ]);
      console.log(`[CACHE_FS] Added to cache: ${hash}`);
    } catch (error) { console.error(`[CACHE_FS] Error writing cache for hash ${hash}:`, error); }
}
async function deleteFromFsCache(hash: string): Promise<boolean> { /* ... same as before ... */
    const { dataPath, metaPath } = getCacheFilePaths(hash);
    try {
      const results = await Promise.allSettled([ Deno.remove(dataPath), Deno.remove(metaPath) ]);
      let deletedAny = false;
      results.forEach((result, index) => {
          const filePath = index === 0 ? dataPath : metaPath;
          if (result.status === 'fulfilled') { console.log(`[CACHE_FS_ADMIN] Deleted ${filePath}`); deletedAny = true; }
          else if (!(result.reason instanceof Deno.errors.NotFound)) console.error(`[CACHE_FS_ADMIN] Error deleting ${filePath}:`, result.reason);
      });
      return deletedAny;
    } catch (error) { console.error(`[CACHE_FS_ADMIN] Unexpected error during deletion for hash ${hash}:`, error); return false; }
}

// --- Backend API Interaction (same as before) ---
let currentBackendIndex = 0;
function getNextBackendUrl(): string { /* ... same as before ... */
    const url = BACKEND_API_URLS[currentBackendIndex];
    currentBackendIndex = (currentBackendIndex + 1) % BACKEND_API_URLS.length;
    return url;
}
interface ImageGenerationResponse { created: number; data: Array<{ url: string; revised_prompt?: string; }>; }
async function generateImageFromBackend(description: string, width?: number, height?: number, model?: string): Promise<{ imageUrl: string; revisedPrompt?: string } | null> { /* ... same as before ... */
    const backendUrl = getNextBackendUrl();
    const requestUrl = `${backendUrl}/v1/images/generations`;
    const payload: Record<string, any> = { prompt: description, n: 1 };
    if (model) payload.model = model;
    if (width && height) payload.size = `${width}x${height}`;
    console.log(`[BACKEND] Requesting image from ${requestUrl} for prompt: "${description}"`);
    try {
      const headers: HeadersInit = { "Content-Type": "application/json", "Accept": "application/json" };
      if (AUTH_TOKEN) headers["Authorization"] = `Bearer ${AUTH_TOKEN}`;
      const response = await fetch(requestUrl, { method: "POST", headers, body: JSON.stringify(payload) });
      if (!response.ok) { const errorBody = await response.text(); console.error(`[BACKEND] Error: ${response.status} from ${requestUrl}. Body: ${errorBody.substring(0, 500)}`); return null; }
      const jsonResponse = (await response.json()) as ImageGenerationResponse;
      if (jsonResponse.data && jsonResponse.data.length > 0 && jsonResponse.data[0].url) { console.log(`[BACKEND] Image URL received: ${jsonResponse.data[0].url}`); return { imageUrl: jsonResponse.data[0].url, revisedPrompt: jsonResponse.data[0].revised_prompt }; }
      else { console.error(`[BACKEND] Invalid response structure from ${requestUrl}:`, jsonResponse); return null; }
    } catch (error) { console.error(`[BACKEND] Network error requesting ${requestUrl}:`, error); return null; }
}
async function fetchImageFromUrl(imageUrl: string): Promise<{ data: Uint8Array, contentType: string } | null> { /* ... same as before ... */
    try {
      console.log(`[FETCH] Fetching image data from ${imageUrl}`);
      const response = await fetch(imageUrl);
      if (!response.ok) { console.error(`[FETCH] Failed to fetch image from ${imageUrl}: ${response.status}`); return null; }
      const contentType = response.headers.get("content-type") || "image/png";
      const arrayBuffer = await response.arrayBuffer();
      return { data: new Uint8Array(arrayBuffer), contentType };
    } catch (error) { console.error(`[FETCH] Error fetching image data from ${imageUrl}:`, error); return null; }
}

// --- HTTP Request Handler ---
async function handler(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const pathSegments = url.pathname.split("/").filter(Boolean);

  // --- Authentication Check for /prompt endpoint ---
  if (request.method === "GET" && pathSegments.length >= 2 && pathSegments[0] === "prompt") {
    const providedKey = url.searchParams.get("key");
    if (!providedKey || providedKey !== PROXY_ACCESS_KEY) {
        console.warn(`[AUTH] Failed attempt to access /prompt. Provided key: "${providedKey ? '***' : 'None'}"`);
        return new Response("Unauthorized: Invalid or missing access key.", { status: Status.Unauthorized });
    }
    // --- End Authentication Check ---

    const description = decodeURIComponent(pathSegments.slice(1).join("/"));
    const width = url.searchParams.get("width") ? parseInt(url.searchParams.get("width")!) : undefined;
    const height = url.searchParams.get("height") ? parseInt(url.searchParams.get("height")!) : undefined;
    const model = url.searchParams.get("model") || undefined;

    if (!description) return new Response("Description missing.", { status: Status.BadRequest });

    console.log(`[REQUEST] Prompt: "${description}", Size: ${width}x${height}, Model: ${model || 'default'}`);

    let cacheHash: string;
    try { cacheHash = await generateCacheHash(description, width, height, model); }
    catch (hashError) { return new Response(`Failed to generate cache identifier: ${hashError.message}`, { status: Status.InternalServerError }); }

    const cachedImage = await getFromFsCache(cacheHash);

    if (cachedImage) {
      console.log(`[CACHE_FS] HIT for ${cacheHash}`);
      return new Response(cachedImage.data, {
        status: Status.OK,
        headers: { "Content-Type": cachedImage.contentType, "X-Cache-Hit": "true", "X-Revised-Prompt": cachedImage.revisedPrompt || "" },
      });
    }
    console.log(`[CACHE_FS] MISS for ${cacheHash}`);

    const generationResult = await generateImageFromBackend(description, width, height, model);
    if (!generationResult || !generationResult.imageUrl) return new Response("Failed to generate image from backend.", { status: Status.ServiceUnavailable });

    const imageDataResult = await fetchImageFromUrl(generationResult.imageUrl);
    if (!imageDataResult) return new Response("Failed to fetch image data from generated URL.", { status: Status.BadGateway });

    await addToFsCache(cacheHash, imageDataResult.data, imageDataResult.contentType, generationResult.imageUrl, generationResult.revisedPrompt);

    return new Response(imageDataResult.data, {
      status: Status.OK,
      headers: {
        "Content-Type": imageDataResult.contentType,
        "X-Cache-Hit": "false",
        "X-Revised-Prompt": generationResult.revisedPrompt || description,
      },
    });
  } // End of /prompt handler

  // Status endpoint (no auth needed by default)
  if (url.pathname === "/status" && request.method === "GET") {
    let cacheDirExists = false;
    try { await Deno.stat(CACHE_DIR); cacheDirExists = true; }
    catch(e) { if (!(e instanceof Deno.errors.NotFound)) console.warn("[STATUS] Error checking cache directory:", e); }
    return new Response(JSON.stringify({ status: "ok", backends: BACKEND_API_URLS, cacheDirectory: CACHE_DIR, cacheDirectoryExists: cacheDirExists, }), { headers: {"Content-Type": "application/json"}});
  }

  // Cache Delete endpoint (uses separate Admin Token header for potentially higher security)
  if (url.pathname.startsWith("/cache/delete") && request.method === "POST") {
    const adminToken = request.headers.get("X-Admin-Token");
    // IMPORTANT: Replace with a secure check/token in a real deployment!
    if (adminToken !== "SUPER_SECRET_ADMIN_TOKEN_CHANGE_ME") {
        return new Response("Unauthorized (Admin Token Required)", { status: Status.Unauthorized });
    }
    try {
        const { description, width, height, model } = await request.json();
        let hashToDelete: string;
        try { hashToDelete = await generateCacheHash(description, width, height, model); }
        catch (hashError) { return new Response(`Failed to generate cache identifier for deletion: ${hashError.message}`, { status: Status.InternalServerError }); }

        const deleted = await deleteFromFsCache(hashToDelete);
        if (deleted) { console.log(`[CACHE_FS_ADMIN] Deleted cache for hash: ${hashToDelete}`); return new Response(`Cache deleted for hash: ${hashToDelete}`, { status: Status.OK }); }
        else { return new Response(`Cache not found or failed to delete for hash: ${hashToDelete}`, { status: Status.NotFound }); }
    } catch (e) {
        console.error("[CACHE_ADMIN] Error deleting cache:", e);
        if (e instanceof SyntaxError) return new Response(`Invalid JSON body for cache deletion request: ${e.message}`, {status: Status.BadRequest});
        return new Response(`Error deleting cache: ${e.message}`, {status: Status.InternalServerError});
    }
  }

  // Default Not Found
  return new Response(STATUS_TEXT[Status.NotFound], { status: Status.NotFound });
}

// --- Main Server ---
console.log(`Image Proxy with File System cache listening on http://localhost:${PORT}`);
Deno.serve({ port: PORT }, handler);