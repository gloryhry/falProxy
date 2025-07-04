// router.ts
import { Status } from "https://deno.land/std@0.208.0/http/status.ts";
import { load } from "https://deno.land/std@0.208.0/dotenv/mod.ts";

// --- Configuration Loading ---
await load({ export: true });

const CUSTOM_ACCESS_KEY = Deno.env.get("CUSTOM_ACCESS_KEY");
const AI_KEYS_RAW = Deno.env.get("AI_KEYS");
const PORT = parseInt(Deno.env.get("PORT") || "8000");
const DEBUG_MODE = Deno.env.get("DEBUG_MODE")?.toLowerCase() === 'true';

const SUPPORTED_MODELS_RAW = Deno.env.get("SUPPORTED_MODELS");
const SUPPORTED_MODELS_MAP = new Map<string, string>();

if (SUPPORTED_MODELS_RAW) {
    SUPPORTED_MODELS_RAW.split(',')
      .map(pair => pair.trim())
      .filter(pair => pair.includes(':'))
      .forEach(pair => {
          const [key, ...valueParts] = pair.split(':');
          const value = valueParts.join(':');
          if (key && value) {
              SUPPORTED_MODELS_MAP.set(key.trim(), value.trim());
          }
      });
}

function debugLog(...args: any[]) { if (DEBUG_MODE) console.log("[DEBUG]", ...args); }
console.log(`Debug mode is ${DEBUG_MODE ? 'ENABLED' : 'DISABLED'}.`);

// --- Environment Variable Validation ---
if (!CUSTOM_ACCESS_KEY) { console.error("FATAL: CUSTOM_ACCESS_KEY is not set."); Deno.exit(1); }
if (!AI_KEYS_RAW) { console.error("FATAL: AI_KEYS environment variable is not set."); Deno.exit(1); }
const AI_KEYS = AI_KEYS_RAW.split(',').map(key => key.trim()).filter(key => key.length > 0);
if (AI_KEYS.length === 0) { console.error("FATAL: AI_KEYS contains no valid keys."); Deno.exit(1); }
if (SUPPORTED_MODELS_MAP.size === 0) { console.error("FATAL: SUPPORTED_MODELS in .env is not set or is invalid."); Deno.exit(1); }
console.log(`Loaded ${SUPPORTED_MODELS_MAP.size} supported models from .env`);


// --- Dynamic Model Configuration & Caching ---
// MODIFIED: ModelConfig is simpler now, no need for status_base_url
interface ModelConfig {
    submit_url: string;
    supports_size_param: boolean;
    supports_aspect_ratio_param: boolean;
    uses_image_size_object: boolean;
}
interface CachedModelConfig extends ModelConfig { fetchedAt: number; }
const modelConfigCache = new Map<string, CachedModelConfig>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

async function fetchAndParseModelSchema(endpointId: string): Promise<ModelConfig> {
    const openApiUrl = `https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=${endpointId}`;
    debugLog(`[Schema Fetch] Fetching for ${endpointId}`);
    const response = await fetch(openApiUrl);
    if (!response.ok) throw new Error(`Failed to fetch OpenAPI schema for ${endpointId}: ${response.status} ${response.statusText}`);
    
    // (Schema parsing logic is largely the same, but simpler)
    const schema = await response.json();
    const postPathKey = `/${endpointId}`;
    const postPath = schema.paths?.[postPathKey]?.post;
    if (!postPath) throw new Error(`Could not find POST path '${postPathKey}' in schema.`);
    const requestBodyRef = postPath.requestBody?.content?.['application/json']?.schema?.$ref;
    if (!requestBodyRef) throw new Error(`Could not find request body reference in schema.`);
    const inputSchemaName = requestBodyRef.split('/').pop();
    if (!inputSchemaName) throw new Error(`Could not extract schema name from ref '${requestBodyRef}'.`);
    const inputSchema = schema.components?.schemas?.[inputSchemaName];
    if (!inputSchema) throw new Error(`Could not find input schema definition '${inputSchemaName}'.`);
    const properties = inputSchema.properties;
    if (!properties) throw new Error(`Input schema '${inputSchemaName}' has no properties.`);
    const supports_size_param = 'width' in properties && 'height' in properties && properties.width.type === 'integer';
    const supports_aspect_ratio_param = 'aspect_ratio' in properties;
    let uses_image_size_object = false;
    const imageSizeProp = properties.image_size;
    if (imageSizeProp) {
        const isSizeObjectSchema = (propDef: any): boolean => {
            if (!propDef) return false;
            if (propDef.type === 'object' && propDef.properties?.width && propDef.properties?.height) return true;
            if (propDef.$ref) {
                const refName = propDef.$ref.split('/').pop();
                const refSchema = schema.components?.schemas?.[refName];
                return refSchema?.type === 'object' && refSchema.properties?.width && refSchema.properties?.height;
            }
            return false;
        };
        if (isSizeObjectSchema(imageSizeProp)) { uses_image_size_object = true; }
        else if (imageSizeProp.anyOf || imageSizeProp.oneOf) { uses_image_size_object = (imageSizeProp.anyOf || imageSizeProp.oneOf).some((option: any) => isSizeObjectSchema(option)); }
    }
    
    const config: ModelConfig = {
        submit_url: `https://queue.fal.run/${endpointId}`,
        supports_size_param,
        supports_aspect_ratio_param,
        uses_image_size_object,
    };
    debugLog(`[Schema Parse] Successfully parsed config for ${endpointId}:`, config);
    return config;
}

async function getModelConfig(modelName: string): Promise<ModelConfig | null> {
    const endpointId = SUPPORTED_MODELS_MAP.get(modelName);
    if (!endpointId) return null;
    const cached = modelConfigCache.get(modelName);
    if (cached && (Date.now() - cached.fetchedAt < CACHE_TTL_MS)) {
        debugLog(`[Cache HIT] Using cached config for ${modelName}`);
        return cached;
    }
    debugLog(`[Cache MISS] Fetching new config for ${modelName}`);
    try {
        const newConfig = await fetchAndParseModelSchema(endpointId);
        modelConfigCache.set(modelName, { ...newConfig, fetchedAt: Date.now() });
        return newConfig;
    } catch (error) {
        console.error(`[Config Error] Failed to get model config for '${modelName}':`, error);
        if (cached) {
            console.warn(`[Config Warning] Serving stale cache for ${modelName} due to fetch failure.`);
            return cached;
        }
        return null;
    }
}

// --- Helper Functions ---
function getRandomApiKey(): string { const randomIndex = Math.floor(Math.random() * AI_KEYS.length); return AI_KEYS[randomIndex]; }
interface AuthResult { valid: boolean; userKey?: string; apiKey?: string; error?: string; }
function extractAndValidateApiKey(request: Request): AuthResult { const authHeader = request.headers.get('Authorization') || ''; let userKey: string | undefined; if (authHeader.startsWith('Bearer ')) userKey = authHeader.substring(7); else if (authHeader.startsWith('Key ')) userKey = authHeader.substring(4); else userKey = authHeader; if (!userKey) return { valid: false, userKey, error: "Authorization header missing or empty." }; if (userKey !== CUSTOM_ACCESS_KEY) { console.log(`Authentication failed: Invalid user key provided.`); return { valid: false, userKey: "provided_but_invalid", error: "Invalid API key." }; } const randomApiKey = getRandomApiKey(); return { valid: true, userKey, apiKey: randomApiKey }; }
function parseSize(sizeString?: string): { width: number; height: number } | null { if (!sizeString || typeof sizeString !== 'string') return null; const parts = sizeString.toLowerCase().split('x'); if (parts.length === 2) { const width = parseInt(parts[0], 10); const height = parseInt(parts[1], 10); if (!isNaN(width) && !isNaN(height) && width > 0 && height > 0) return { width, height }; } return null; }
function gcd(a: number, b: number): number { while (b) { [a, b] = [b, a % b]; } return a; }
function calculateAspectRatio(width: number, height: number): string { if (!width || !height || width <= 0 || height <= 0) return "1:1"; const divisor = gcd(width, height); return `${width / divisor}:${height / divisor}`; }

// --- CORS Configuration ---
const CORS_HEADERS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', };

// --- Endpoint Handlers ---
async function handleImageGenerations(request: Request): Promise<Response> {
    debugLog("--- New Image Generation Request ---");
    const authResult = extractAndValidateApiKey(request);
    if (!authResult.valid || !authResult.apiKey) return new Response(JSON.stringify({ error: { message: authResult.error || "Authentication failed.", type: "authentication_error" } }), { status: Status.Unauthorized });
    const { apiKey } = authResult;
    let openaiRequestPayload;
    try { openaiRequestPayload = await request.json(); debugLog("Parsed OpenAI Request Payload:", openaiRequestPayload); }
    catch (error) { return new Response(JSON.stringify({ error: { message: "Missing or invalid JSON request body.", type: "invalid_request_error" } }), { status: Status.BadRequest }); }
    
    const { prompt, model: requestedModel, n: requestedN, size: requestedSize, seed: requestedSeed } = openaiRequestPayload;
    const modelName = requestedModel || "flux-dev";
    const numImages = Math.max(1, Math.min(4, parseInt(requestedN) || 1));
    if (!prompt || typeof prompt !== 'string' || prompt.trim() === "") return new Response(JSON.stringify({ error: { message: "A 'prompt' is required.", type: "invalid_request_error" } }), { status: Status.BadRequest });
    
    const modelConfig = await getModelConfig(modelName);
    if (!modelConfig) return new Response(JSON.stringify({ error: { message: `Model '${modelName}' not found or its configuration failed to load.`, type: "invalid_request_error" } }), { status: Status.NotFound });
    
    let width: number | undefined, height: number | undefined, aspectRatio: string | undefined;
    const requestedDimensions = parseSize(requestedSize);
    if (requestedDimensions) { width = requestedDimensions.width; height = requestedDimensions.height; aspectRatio = calculateAspectRatio(width, height); }
    
    const falRequestPayload: Record<string, any> = { prompt, num_images: numImages, seed: requestedSeed, enable_safety_checker: false };
    if (width && height) {
        if (modelConfig.uses_image_size_object) falRequestPayload.image_size = { width, height };
        else if (modelConfig.supports_size_param) { falRequestPayload.width = width; falRequestPayload.height = height; }
        if (aspectRatio && modelConfig.supports_aspect_ratio_param) falRequestPayload.aspect_ratio = aspectRatio;
    } else if (aspectRatio && modelConfig.supports_aspect_ratio_param) {
        falRequestPayload.aspect_ratio = aspectRatio;
    }
    debugLog("Constructed Fal Payload:", falRequestPayload);

    try {
        const falSubmitResponse = await fetch(modelConfig.submit_url, { method: 'POST', headers: { "Authorization": `Key ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify(falRequestPayload) });
        const submitResponseText = await falSubmitResponse.text();
        debugLog(`Fal Submit Response Status: ${falSubmitResponse.status}`);
        debugLog("Fal Submit Response Body:", submitResponseText);
        
        if (!falSubmitResponse.ok) { let errorMessage = submitResponseText; try { const errorData = JSON.parse(submitResponseText); errorMessage = errorData.detail || JSON.stringify(errorData); } catch (e) { /* ignore */ } return new Response(JSON.stringify({ error: { message: `Fal API submission error: ${errorMessage}`, type: "fal_api_error" } }), { status: Status.InternalServerError }); }
        
        const falSubmitData = JSON.parse(submitResponseText);
        
        const { status_url, response_url, request_id } = falSubmitData;
        if (!status_url || !response_url || !request_id) {
            return new Response(JSON.stringify({ error: { message: "Fal API did not return valid polling URLs.", type: "fal_api_error" } }), { status: Status.InternalServerError });
        }
        debugLog(`Received polling URLs. Status: ${status_url}, Result: ${response_url}`);

        const imageUrls: string[] = [];
        for (let attempt = 0; attempt < 45; attempt++) {
            await new Promise(resolve => setTimeout(resolve, 2000));
            debugLog(`Polling attempt ${attempt + 1}/45 for request_id: ${request_id}`);
            
            const statusResponse = await fetch(status_url, { headers: { "Authorization": `Key ${apiKey}` } });
            if (statusResponse.ok) {
                const statusData = await statusResponse.json();
                if (statusData.status === "COMPLETED") {
                    const resultResponse = await fetch(response_url, { headers: { "Authorization": `Key ${apiKey}` } });
                    if (resultResponse.ok) {
                        const resultData = await resultResponse.json();
                        debugLog("Received final result data:", resultData);
                        if (resultData.images && Array.isArray(resultData.images)) resultData.images.forEach((img: any) => { if (img?.url) imageUrls.push(img.url); });
                        if (imageUrls.length > 0) break;
                    }
                } else if (statusData.status === "FAILED" || statusData.status === "ERROR") {
                    let failureReason = `Polling status indicated ${statusData.status}.`;
                    try { const resultResponse = await fetch(response_url, { headers: { "Authorization": `Key ${apiKey}` } }); failureReason = await resultResponse.text(); } catch(e) {/* ignore */}
                    return new Response(JSON.stringify({ error: { message: `Image generation failed: ${failureReason}`, type: "generation_failed" } }), { status: Status.InternalServerError });
                }
            }
        }
        if (imageUrls.length === 0) return new Response(JSON.stringify({ error: { message: "Image generation timed out or returned no images.", type: "generation_timeout" } }), { status: Status.InternalServerError });
        const responseData = { created: Math.floor(Date.now() / 1000), data: imageUrls.slice(0, numImages).map(imgUrl => ({ url: imgUrl, revised_prompt: prompt })) };
        return new Response(JSON.stringify(responseData), { status: Status.OK });
    } catch (e: any) {
        console.error(`Unhandled exception in handleImageGenerations: ${e.toString()}`, e.stack);
        return new Response(JSON.stringify({ error: { message: `Server error: ${e.toString()}`, type: "server_error" } }), { status: Status.InternalServerError });
    }
}

async function listModels(): Promise<Response> {
    const modelData = Array.from(SUPPORTED_MODELS_MAP.keys()).map(id => ({ id, object: "model", created: Math.floor(Date.now() / 1000) - Math.floor(Math.random() * 3000000), owned_by: "fal-openai-adapter-deno", permission: [], root: id, parent: null }));
    return new Response(JSON.stringify({ object: "list", data: modelData }));
}

// --- Main Server Logic ---
async function warmupCache() {
    console.log("Starting model cache warm-up...");
    await Promise.all(
      Array.from(SUPPORTED_MODELS_MAP.keys()).map(name => 
        getModelConfig(name).catch(e => { console.error(`[Warm-up] Failed for ${name}:`, e.message); return null; })
      )
    );
    console.log("Model cache warm-up finished.");
}

warmupCache().then(() => {
    console.log(`Deno server starting to listen on http://localhost:${PORT}`);
    Deno.serve({ port: PORT }, async (request: Request) => {
        const url = new URL(request.url);
        const path = url.pathname;
        const startTime = Date.now();
        if (request.method === 'OPTIONS') {
            console.log(`[CORS] Handling OPTIONS preflight for ${path}`);
            return new Response(null, { status: Status.NoContent, headers: CORS_HEADERS });
        }
        console.log(`[${new Date(startTime).toISOString()}] --> ${request.method} ${path}`);
        let response: Response;
        try {
            if (path === '/v1/images/generations' && request.method === 'POST') response = await handleImageGenerations(request);
            else if (path === '/v1/models' && request.method === 'GET') response = await listModels();
            else if (path === '/health' && request.method === 'GET') response = new Response(JSON.stringify({ status: "ok" }));
            else response = new Response(JSON.stringify({ error: { message: "Not Found" } }), { status: Status.NotFound });
        } catch (err) {
            console.error(`[${new Date().toISOString()}] Critical error handling ${request.method} ${path}:`, err);
            response = new Response(JSON.stringify({ error: { message: "Internal Server Error" } }), { status: Status.InternalServerError });
        }
        for (const [key, value] of Object.entries(CORS_HEADERS)) { response.headers.set(key, value); }
        if (!response.headers.has('Content-Type') && response.body) response.headers.set('Content-Type', 'application/json');
        const duration = Date.now() - startTime;
        console.log(`[${new Date().toISOString()}] <-- ${request.method} ${path} ${response.status} (${duration}ms)`);
        return response;
    });
});