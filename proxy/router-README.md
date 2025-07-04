# OpenAI-Compatible Fal.ai Proxy

> A high-performance Deno proxy that makes Fal.ai's powerful models available through the standard OpenAI `/v1/images/generations` API.

[![Deno](https://img.shields.io/badge/Deno-000000?style=for-the-badge&logo=deno&logoColor=white)](https://deno.land/)
[![OpenAI](https://img.shields.io/badge/OpenAI-Compatible-00A67E?style=for-the-badge&logo=openai&logoColor=white)](https://openai.com/)
[![Fal.ai](https://img.shields.io/badge/Fal.ai-Powered-FF6B35?style=for-the-badge)](https://fal.ai/)

## ✨ Key Features

-   **🔌 Drop-in Compatibility**: Use Fal.ai models with any existing OpenAI-compatible client or library.
-   **⚙️ Configuration-Driven**: All settings, including the list of supported models, are managed in a simple `.env` file. No code changes needed.
-   **🧠 Dynamic Model Adaptation**: Automatically fetches and analyzes each model's OpenAPI schema to intelligently map parameters like `size`, `width`/`height`, and `aspect_ratio`.
-   **⚡ High Performance**: Features an on-startup cache for model schemas, reducing API latency for all subsequent requests.
-   **🔐 Centralized API Key Management**: Securely manage your Fal.ai keys on the server and provide a single, custom access key to your clients.
-   **🌐 CORS Ready**: Built-in CORS support allows direct access from web applications.

## 🚀 Quick Start

#### 1. Get the code
Download `router.ts` or clone the repository.

#### 2. Create your configuration
Create a `.env` file in the same directory and populate it with your keys and desired models.

**.env file example:**
```bash
# Your secret key to access THIS proxy
CUSTOM_ACCESS_KEY="my-super-secret-proxy-key"

# A comma-separated list of your Fal.ai API keys
AI_KEYS="fal-key-123abc,fal-key-456def"

# (Optional) Port to run the server on
PORT="8000"

# (Optional) Enable detailed console logs
DEBUG_MODE="true"

# Define the models you want to expose
# Format: "friendly-name:fal-ai/endpoint/id,another-name:another/endpoint"
SUPPORTED_MODELS="flux-dev:fal-ai/flux/dev,sdxl:fal-ai/stable-diffusion-xl,flux-schnell:fal-ai/flux-schnell"
```

#### 3. Run the server
Start the Deno process with the necessary permissions.
```bash
deno run --allow-net --allow-read=.env --allow-env router.ts
```
The server will start, pre-load all model configurations, and be ready to accept requests.

## 🎯 Usage (API Endpoints)

### Generating an Image
Send a `POST` request to `/v1/images/generations`. The proxy will translate it and forward it to the appropriate Fal.ai model.

**Example with `curl`:**
```bash
curl -X POST http://localhost:8000/v1/images/generations \
  -H "Authorization: Bearer my-super-secret-proxy-key" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "A majestic dragon soaring through clouds, cinematic lighting",
    "model": "flux-dev",
    "size": "1024x1024",
    "n": 1
  }'
```

### Other Endpoints
-   **List Models**: `GET /v1/models` - Returns a list of all models configured in your `.env` file, formatted like the OpenAI models API.
-   **Health Check**: `GET /health` - A simple endpoint that returns `{ "status": "ok" }` for monitoring.

## ⚙️ Configuration Details

All configuration is managed via the `.env` file.

| Variable            | Description                                                                                                                              | Example                                                                                    |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `CUSTOM_ACCESS_KEY` | **Required.** The secret key your clients will use in the `Authorization: Bearer` header to access this proxy.                             | `"my-secure-key-123"`                                                                      |
| `AI_KEYS`           | **Required.** A comma-separated list of your actual Fal.ai API keys. The proxy will rotate through them for each request.                  | `"fal-key-abc,fal-key-def"`                                                                |
| `SUPPORTED_MODELS`  | **Required.** A comma-separated list defining the models to expose. The format is `your-model-name:fal-ai/endpoint/id`.                   | `"sdxl:fal-ai/stable-diffusion-xl,flux:fal-ai/flux/dev"`                                   |
| `PORT`              | *Optional.* The port for the proxy server to listen on.                                                                                  | `8000` (default)                                                                           |
| `DEBUG_MODE`        | *Optional.* Set to `true` to enable verbose logging of requests, payloads, and schema parsing, which is useful for troubleshooting.       | `true`                                                                                     |