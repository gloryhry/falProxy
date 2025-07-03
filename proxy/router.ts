// main.ts
import { Status } from "https://deno.land/std@0.208.0/http/status.ts"; // For HTTP status codes

// --- Configuration Loading ---
const AI_KEYS_RAW = Deno.env.get("AI_KEYS");
const CUSTOM_ACCESS_KEY = Deno.env.get("CUSTOM_ACCESS_KEY");
const PORT = parseInt(Deno.env.get("PORT") || "8000");

if (!AI_KEYS_RAW) {
  console.error("FATAL: AI_KEYS environment variable is not set. Please set it as a comma-separated string of keys.");
  Deno.exit(1);
}
const AI_KEYS = AI_KEYS_RAW.split(',').map(key => key.trim()).filter(key => key.length > 0);
if (AI_KEYS.length === 0) {
    console.error("FATAL: AI_KEYS environment variable is set but contains no valid keys after parsing.");
    Deno.exit(1);
}

if (!CUSTOM_ACCESS_KEY) {
  console.error("FATAL: CUSTOM_ACCESS_KEY environment variable is not set.");
  Deno.exit(1);
}

// Model URLs configuration - Ensure these are correct for your Fal.ai models
// Added 'uses_image_size_object' flag
const MODEL_URLS: Record<string, {
    submit_url: string;
    status_base_url: string;
    default_size?: string;
    supports_size_param?: boolean;         // Accepts top-level width/height?
    supports_aspect_ratio_param?: boolean; // Accepts top-level aspect_ratio string?
    uses_image_size_object?: boolean;      // Requires/accepts nested image_size: { w, h } object?
}> = {
  "flux-1.1-pro-ultra": {
    "submit_url": "https://queue.fal.run/fal-ai/flux-pro/v1.1-ultra",
    "status_base_url": "https://queue.fal.run/fal-ai/flux-pro",
    "default_size": "1024x1024",
    "supports_size_param": true,
    "supports_aspect_ratio_param": true,
    "uses_image_size_object": true
  },
  "flux-1.1-pro": {
    "submit_url": "https://queue.fal.run/fal-ai/flux-pro/v1.1",
    "status_base_url": "https://queue.fal.run/fal-ai/flux-pro",
    "default_size": "1024x1024",
    "supports_size_param": true,
    "supports_aspect_ratio_param": true,
    "uses_image_size_object": true     
  },
  "flux-schnell": {
    "submit_url": "https://queue.fal.run/fal-ai/flux-schnell/submit", 
    "status_base_url": "https://queue.fal.run/fal-ai/flux-schnell",   
    "default_size": "1024x1024",
    "supports_size_param": true,
    "supports_aspect_ratio_param": true,
    "uses_image_size_object": true
  },
   "flux-dev": {
    "submit_url": "https://queue.fal.run/fal-ai/flux/dev",
    "status_base_url": "https://queue.fal.run/fal-ai/flux",
    "default_size": "1024x1024",
    "supports_size_param": true,
    "supports_aspect_ratio_param": true,
    "uses_image_size_object": true
  },
   "ideogram-v2a-turbo": {
    "submit_url": "https://queue.fal.run/fal-ai/ideogram/v2",
    "status_base_url": "https://queue.fal.run/fal-ai/ideogram",
    "default_size": "1024x1024",
    "supports_size_param": false,
    "supports_aspect_ratio_param": true,
    "uses_image_size_object": false
  },
  "imagen-3": {
    "submit_url": "https://queue.fal.run/fal-ai/google-imagen-3/submit",
    "status_base_url": "https://queue.fal.run/fal-ai/google-imagen-3",
    "default_size": "1024x1024",
    "supports_size_param": false,
    "supports_aspect_ratio_param": true, 
    "uses_image_size_object": false

  },
  "imagen-4": {
    "submit_url": "https://queue.fal.run/fal-ai/imagen4/preview/submit",
    "status_base_url": "https://queue.fal.run/fal-ai/imagen4/preview",
    "default_size": "1024x1024",
    "supports_size_param": false, 
    "supports_aspect_ratio_param": true,
    "uses_image_size_object": false
  },
  "luma-photon": {
    "submit_url": "https://queue.fal.run/fal-ai/luma-photon/submit",
    "status_base_url": "https://queue.fal.run/fal-ai/luma-photon",
    "default_size": "1024x1024",
    "supports_size_param": true,
    "supports_aspect_ratio_param": false,
    "uses_image_size_object": false
  }
};

// --- Helper Functions (gcd, calculateAspectRatio, parseSize, getRandomApiKey, extractAndValidateApiKey - unchanged) ---
function getRandomApiKey(): string {
  const randomIndex = Math.floor(Math.random() * AI_KEYS.length);
  return AI_KEYS[randomIndex];
}

interface AuthResult { valid: boolean; userKey?: string; apiKey?: string; error?: string; }

function extractAndValidateApiKey(request: Request): AuthResult {
  const authHeader = request.headers.get('Authorization') || '';
  let userKey: string | undefined;
  if (authHeader.startsWith('Bearer ')) userKey = authHeader.substring(7);
  else if (authHeader.startsWith('Key ')) userKey = authHeader.substring(4);
  else userKey = authHeader;
  if (!userKey) return { valid: false, userKey, error: "Authorization header missing or empty." };
  if (userKey !== CUSTOM_ACCESS_KEY) {
    console.log(`Authentication failed: Invalid user key provided.`);
    return { valid: false, userKey: "provided_but_invalid", error: "Invalid API key." };
  }
  try {
    const randomApiKey = getRandomApiKey();
    console.log(`Selected random Fal API key for request.`);
    return { valid: true, userKey, apiKey: randomApiKey };
  } catch (e: any) { return { valid: false, userKey, error: e.message }; }
}

function parseSize(sizeString?: string): { width: number; height: number } | null {
  if (!sizeString || typeof sizeString !== 'string') return null;
  const parts = sizeString.toLowerCase().split('x');
  if (parts.length === 2) {
    const width = parseInt(parts[0], 10); const height = parseInt(parts[1], 10);
    if (!isNaN(width) && !isNaN(height) && width > 0 && height > 0) return { width, height };
  } return null;
}

function gcd(a: number, b: number): number { while (b) { a %= b; [a, b] = [b, a]; } return a; }

function calculateAspectRatio(width: number, height: number): string {
  if (!width || !height || width <= 0 || height <= 0) {
    console.warn(`Invalid dimensions for aspect ratio calculation: ${width}x${height}. Defaulting to 1:1.`);
    return "1:1";
  }
  const divisor = gcd(width, height);
  return `${width / divisor}:${height / divisor}`;
}


// --- Endpoint Handlers ---
async function handleImageGenerations(request: Request): Promise<Response> {
  const authResult = extractAndValidateApiKey(request);
  if (!authResult.valid || !authResult.apiKey) {
    const message = authResult.error || "Authentication failed.";
    console.log(`Authentication attempt failed. Reason: ${message}`);
    return new Response(JSON.stringify({ error: { message: message, type: "authentication_error" } }), { status: Status.Unauthorized, headers: { 'Content-Type': 'application/json' } });
  }
  const { apiKey } = authResult;

  let openaiRequestPayload;
  try { openaiRequestPayload = await request.json(); } catch (error) {
    return new Response(JSON.stringify({ error: { message: "Missing or invalid JSON request body.", type: "invalid_request_error" } }), { status: Status.BadRequest, headers: { 'Content-Type': 'application/json' } });
  }

  const { prompt, model: requestedModel, n: requestedN, size: requestedSize, seed: requestedSeed } = openaiRequestPayload;
  const modelName = requestedModel || "flux-dev";
  const numImages = Math.max(1, Math.min(4, parseInt(requestedN) || 1));
  const seed = requestedSeed !== undefined && Number.isInteger(Number(requestedSeed)) ? Number(requestedSeed) : 42;

  if (!prompt || typeof prompt !== 'string' || prompt.trim() === "") {
    return new Response(JSON.stringify({ error: { message: "A 'prompt' is required.", type: "invalid_request_error" } }), { status: Status.BadRequest, headers: { 'Content-Type': 'application/json' } });
  }

  const modelConfig = MODEL_URLS[modelName];
  if (!modelConfig) {
    return new Response(JSON.stringify({ error: { message: `Model '${modelName}' not found or configured.`, type: "invalid_request_error" } }), { status: Status.BadRequest, headers: { 'Content-Type': 'application/json' } });
  }

  // --- Determine dimensions and aspect ratio ---
  let width: number | undefined;
  let height: number | undefined;
  let aspectRatio: string | undefined;

  const requestedDimensions = parseSize(requestedSize);
  const defaultDimensions = parseSize(modelConfig.default_size);

  if (requestedDimensions) {
    width = requestedDimensions.width; height = requestedDimensions.height;
  } else if (defaultDimensions) {
    width = defaultDimensions.width; height = defaultDimensions.height;
    if(requestedSize) console.log(`Warning: Invalid 'size' format: ${requestedSize}. Using model default size: ${modelConfig.default_size}`);
  } else if(requestedSize) {
    console.log(`Warning: Invalid 'size' format: ${requestedSize}. No default size for model. Size/Aspect Ratio might be omitted or default to Fal model's internal default.`);
  }

  // Calculate aspect ratio only if dimensions are valid
  if (width && height) {
      aspectRatio = calculateAspectRatio(width, height);
      console.log(`Determined dimensions: ${width}x${height}, Aspect Ratio: ${aspectRatio}`);
  } else {
      console.log(`Could not determine valid dimensions from size '${requestedSize}' or model default.`);
  }

  // --- Construct Fal Payload ---
  const falRequestPayload: Record<string, any> = {
    prompt: prompt,
    num_images: numImages,
    seed: seed,
    enable_safety_checker: false // Consistently add this as requested
  };

  // --- Add size/aspect parameters based on determined dimensions and model config ---
  if (width && height) { // Only add size/aspect if dimensions were determined
      if (modelConfig.uses_image_size_object) {
          falRequestPayload.image_size = { width: width, height: height };
          console.log(`Adding nested 'image_size: { width: ${width}, height: ${height} }' to Fal payload.`);
          // If image_size object is used, we might not need top-level width/height even if supported
      } else if (modelConfig.supports_size_param) {
          // Add top-level width/height only if image_size object is NOT used
          falRequestPayload.width = width;
          falRequestPayload.height = height;
          console.log(`Adding top-level 'width: ${width}, height: ${height}' to Fal payload.`);
      } else {
          console.log(`Warning: Dimensions ${width}x${height} determined, but model '${modelName}' config indicates no support for 'image_size' object or top-level 'width'/'height' parameters.`);
      }

      // Add aspect_ratio if supported, regardless of whether image_size or width/height were added
      // (Some APIs might accept both, though redundant)
      if (aspectRatio && modelConfig.supports_aspect_ratio_param) {
          falRequestPayload.aspect_ratio = aspectRatio;
          console.log(`Adding top-level 'aspect_ratio: ${aspectRatio}' to Fal payload.`);
      }

  } else {
       console.log(`Skipping size/aspect ratio parameters in Fal payload as dimensions could not be determined.`);
  }


  // --- Call Fal API ---
  const falSubmitUrl = modelConfig.submit_url;
  const falStatusBaseUrl = modelConfig.status_base_url;
  console.log(`Making request to Fal API model ${modelName}. Submit URL: ${falSubmitUrl}`);
  console.log(`Fal Payload: ${JSON.stringify(falRequestPayload)}`); // Log final payload

  try {
    const headers = { "Authorization": `Key ${apiKey}`, "Content-Type": "application/json" };
    const falSubmitResponse = await fetch(falSubmitUrl, { method: 'POST', headers: headers, body: JSON.stringify(falRequestPayload) });
    const submitResponseText = await falSubmitResponse.text();
    console.log(`Fal API submit response status: ${falSubmitResponse.status}`);
    console.log(`Fal API submit response text (first 200 chars): ${submitResponseText.substring(0,200)}`);

    if (falSubmitResponse.status !== Status.OK && falSubmitResponse.status !== Status.Accepted) { // 200 or 202
      let errorMessage = submitResponseText;
      try { const errorData = JSON.parse(submitResponseText); errorMessage = errorData.detail || errorData.message || errorData.error?.message || JSON.stringify(errorData); } catch (e) { /* Keep original text */ }
      console.error(`Fal API submission error: ${falSubmitResponse.status}, ${errorMessage}`);
      return new Response(JSON.stringify({ error: { message: `Fal API submission error: ${errorMessage}`, type: "fal_api_error", code: falSubmitResponse.status } }), { status: Status.InternalServerError, headers: { 'Content-Type': 'application/json' } });
    }

    const falSubmitData = JSON.parse(submitResponseText);
    const requestId = falSubmitData.request_id;
    if (!requestId) {
      console.error("No request_id found in Fal submission response.", falSubmitData);
      return new Response(JSON.stringify({ error: { message: "Fal API did not return a request_id.", type: "fal_api_error" } }), { status: Status.InternalServerError, headers: { 'Content-Type': 'application/json' } });
    }
    console.log(`Got request_id: ${requestId}`);

    // --- Polling for results (unchanged logic) ---
    const imageUrls: string[] = [];
    const maxAttempts = 45; const pollDelay = 2000;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await new Promise(resolve => setTimeout(resolve, pollDelay));
      console.log(`Polling attempt ${attempt + 1}/${maxAttempts} for request_id: ${requestId}`);
      const statusUrl = `${falStatusBaseUrl}/requests/${requestId}/status`; const resultUrl = `${falStatusBaseUrl}/requests/${requestId}`;
      try {
        const statusResponse = await fetch(statusUrl, { headers: { "Authorization": `Key ${apiKey}` } });
        if (statusResponse.ok) {
          const statusData = await statusResponse.json(); const status = statusData.status;
          console.log(`Current status: ${status}. Progress: ${statusData.progress ? JSON.stringify(statusData.progress) : 'N/A'}`);
          if (status === "COMPLETED") {
            const resultResponse = await fetch(resultUrl, { headers: { "Authorization": `Key ${apiKey}` } });
            if (resultResponse.ok) {
              const resultData = await resultResponse.json();
              // Image extraction logic (adapt as needed)
              if (resultData.images && Array.isArray(resultData.images)) resultData.images.forEach((img: any) => { if (img?.url) imageUrls.push(img.url); });
              else if (resultData.image?.url) imageUrls.push(resultData.image.url);
              else if (resultData.output && Array.isArray(resultData.output)) resultData.output.forEach((item: any) => { if (item?.url && item.content_type?.startsWith('image/')) imageUrls.push(item.url); });
              else if (Array.isArray(resultData)) resultData.forEach((item: any) => { if (item?.url) imageUrls.push(item.url); });

              if (imageUrls.length >= numImages || imageUrls.length > 0) { console.log("Image generation completed. URLs:", imageUrls); break; }
              else console.warn("Status COMPLETED, but no image URLs found in expected format. Result data:", JSON.stringify(resultData).substring(0, 500));
            } else console.warn(`Failed to fetch result for completed request ${requestId}. Status: ${resultResponse.status} ${await resultResponse.text()}`);
          } else if (status === "FAILED" || status === "ERROR") {
            let failureReason = `Polling status indicated ${status}.`;
            try {
              const resultResponse = await fetch(resultUrl, { headers: { "Authorization": `Key ${apiKey}` } }); const errorText = await resultResponse.text();
              console.log(`Fetching error details from ${resultUrl}, Status: ${resultResponse.status}, Body: ${errorText.substring(0, 500)}`);
              if (resultResponse.ok || resultResponse.status === 400) { const errorData = JSON.parse(errorText); failureReason = errorData.detail || errorData.message || errorData.error?.message || errorData.error || JSON.stringify(errorData.logs || errorData); }
              else failureReason = `Status ${resultResponse.status}: ${errorText}`;
            } catch (e:any) { console.warn(`Could not fetch or parse detailed failure reason: ${e.message}`); }
            console.error(`Image generation failed for request_id ${requestId}. Reason: ${failureReason}`);
            return new Response(JSON.stringify({ error: { message: `Image generation failed: ${failureReason}`, type: "generation_failed" } }), { status: Status.InternalServerError, headers: { 'Content-Type': 'application/json' } });
          }
        } else console.warn(`Error checking status for ${requestId}: ${statusResponse.status} ${await statusResponse.text()}`);
      } catch (e: any) { console.error(`Error during polling for ${requestId}: ${e.toString()}`, e); }
    } // End polling loop

    if (imageUrls.length === 0) {
      console.log("No images generated after polling attempts.");
      return new Response(JSON.stringify({ error: { message: "Unable to generate images or retrieve them after timeout.", type: "generation_timeout_or_error" } }), { status: Status.InternalServerError, headers: { 'Content-Type': 'application/json' } });
    }

    // --- Format OpenAI Response ---
    const responseData = { created: Math.floor(Date.now() / 1000), data: imageUrls.slice(0, numImages).map(imgUrl => ({ url: imgUrl, revised_prompt: prompt })) };
    return new Response(JSON.stringify(responseData), { headers: { 'Content-Type': 'application/json' } });

  } catch (e: any) {
    console.error(`Unhandled exception in handleImageGenerations: ${e.toString()}`, e.stack);
    return new Response(JSON.stringify({ error: { message: `Server error: ${e.toString()}`, type: "server_error" } }), { status: Status.InternalServerError, headers: { 'Content-Type': 'application/json' } });
  }
}

async function listModels(): Promise<Response> {
  const modelData = Object.keys(MODEL_URLS).map(id => ({
    id: id, object: "model", created: Math.floor(Date.now() / 1000) - Math.floor(Math.random() * 3000000),
    owned_by: "fal-openai-adapter-deno", permission: [], root: id, parent: null
  }));
  return new Response(JSON.stringify({ object: "list", data: modelData }), { headers: { 'Content-Type': 'application/json' } });
}


// --- Main Server Logic (added /health endpoint) ---
console.log(`Deno server starting on http://localhost:${PORT}`);
Deno.serve({ port: PORT }, async (request: Request) => {
  const url = new URL(request.url); const path = url.pathname;
  const startTime = Date.now();
  console.log(`[${new Date(startTime).toISOString()}] --> ${request.method} ${path}`);
  let response: Response;
  try {
      if (path === '/v1/images/generations' && request.method === 'POST') response = await handleImageGenerations(request);
      else if (path === '/v1/models' && request.method === 'GET') response = await listModels();
      else if (path === '/health' && request.method === 'GET') response = new Response(JSON.stringify({ status: "ok" }), { status: Status.OK, headers: { 'Content-Type': 'application/json' } });
      else response = new Response(JSON.stringify({ error: { message: "Not Found. Available endpoints: POST /v1/images/generations, GET /v1/models, GET /health", type: "not_found_error" } }), { status: Status.NotFound, headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
      console.error(`[${new Date().toISOString()}] Critical error handling ${request.method} ${path}:`, err);
      response = new Response(JSON.stringify({ error: { message: "Internal Server Error", type: "internal_server_error" } }), { status: Status.InternalServerError, headers: { 'Content-Type': 'application/json' } });
  }
  const duration = Date.now() - startTime;
  console.log(`[${new Date().toISOString()}] <-- ${request.method} ${path} ${response.status} (${duration}ms)`);
  return response;
});
