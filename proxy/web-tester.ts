// web-tester.ts
// A self-contained Deno web server to provide a UI for testing the OpenAI-compatible proxy.
// It now dynamically fetches the model list from the proxy's /v1/models endpoint.
// To run: deno run --allow-net web-tester.ts

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";

// --- Configuration ---
const WEB_TESTER_PORT = 8080;
const PROXY_API_PORT = 8000;
// Define the base URL for the proxy API
const PROXY_BASE_URL = `http://localhost:${PROXY_API_PORT}/v1`;
const PROXY_GENERATIONS_URL = `${PROXY_BASE_URL}/images/generations`;
const PROXY_MODELS_URL = `${PROXY_BASE_URL}/models`;


// --- HTML, CSS, and JavaScript for the Frontend ---
const HTML_CONTENT = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Fal.ai API Proxy Tester</title>
    <style>
        :root { --primary-color: #4f46e5; --border-color: #d1d5db; --background-color: #f9fafb; --text-color: #111827; --card-bg: #ffffff; --error-color: #ef4444; --success-color: #22c55e; }
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background-color: var(--background-color); color: var(--text-color); margin: 0; padding: 2rem; display: flex; justify-content: center; }
        .container { width: 100%; max-width: 900px; }
        h1 { color: var(--primary-color); text-align: center; }
        .form-card { background-color: var(--card-bg); border-radius: 8px; padding: 2rem; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1); margin-bottom: 2rem; }
        .form-group { margin-bottom: 1.5rem; }
        label { display: block; font-weight: 500; margin-bottom: 0.5rem; }
        input, select, textarea { width: 100%; padding: 0.75rem; border: 1px solid var(--border-color); border-radius: 6px; box-sizing: border-box; font-size: 1rem; transition: border-color 0.2s; }
        textarea { min-height: 100px; resize: vertical; }
        input:focus, select:focus, textarea:focus { outline: none; border-color: var(--primary-color); box-shadow: 0 0 0 2px rgba(79, 70, 229, 0.2); }
        select:disabled { background-color: #e5e7eb; cursor: not-allowed; }
        .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1.5rem; }
        button { width: 100%; padding: 0.8rem 1rem; border: none; background-color: var(--primary-color); color: white; font-size: 1.1rem; font-weight: 600; border-radius: 6px; cursor: pointer; transition: background-color 0.2s; display: flex; align-items: center; justify-content: center; gap: 0.5rem; }
        button:hover { background-color: #4338ca; }
        button:disabled { background-color: #a5b4fc; cursor: not-allowed; }
        .spinner { width: 20px; height: 20px; border: 3px solid rgba(255, 255, 255, 0.3); border-radius: 50%; border-top-color: #fff; animation: spin 1s ease-in-out infinite; display: none; }
        @keyframes spin { to { transform: rotate(360deg); } }
        #results-container { display: grid; grid-template-columns: repeat(auto-fit, minmax(256px, 1fr)); gap: 1rem; margin-top: 1rem; }
        #results-container img { width: 100%; height: auto; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        #log-output { background-color: #1f2937; color: #d1d5db; padding: 1rem; border-radius: 6px; white-space: pre-wrap; word-wrap: break-word; font-family: "Courier New", Courier, monospace; margin-top: 2rem; }
        .api-key-note { font-size: 0.875rem; color: #6b7280; margin-top: 0.5rem; }
    </style>
</head>
<body>
    <div class="container">
        <h1>Fal.ai API Proxy Tester</h1>
        <div class="form-card">
            <form id="generation-form">
                <div class="form-group">
                    <label for="prompt-input">Prompt</label>
                    <textarea id="prompt-input" required placeholder="A cinematic shot of a red car driving on a rainy night..."></textarea>
                </div>
                <div class="grid">
                    <div class="form-group">
                        <label for="model-select">Model</label>
                        <!-- MODIFIED: This select is now empty and will be populated by JavaScript -->
                        <select id="model-select" disabled>
                            <option>Loading models...</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label for="size-select">Size</label>
                        <select id="size-select">
                            <option value="1024x1024">1024x1024 (Square)</option>
                            <option value="1280x768">1280x768 (Landscape)</option>
                            <option value="768x1280">768x1280 (Portrait)</option>
                            <option value="1536x1024">1536x1024 (Landscape 3:2)</option>
                            <option value="1024x1536">1024x1536 (Portrait 2:3)</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label for="n-input">Number of Images (n)</label>
                        <input id="n-input" type="number" value="1" min="1" max="4">
                    </div>
                </div>
                <div class="form-group">
                    <label for="api-key-input">Proxy API Key</label>
                    <input id="api-key-input" type="password" required>
                    <p class="api-key-note">Enter the <code>CUSTOM_ACCESS_KEY</code> you set for your proxy server.</p>
                </div>
                <button type="submit" id="generate-button">
                    <div class="spinner" id="spinner"></div>
                    <span>Generate Image</span>
                </button>
            </form>
        </div>
        <div id="results-container"></div>
        <pre id="log-output">API responses and errors will appear here.</pre>
    </div>

    <script>
        const form = document.getElementById('generation-form');
        const generateButton = document.getElementById('generate-button');
        const spinner = document.getElementById('spinner');
        const resultsContainer = document.getElementById('results-container');
        const logOutput = document.getElementById('log-output');
        const modelSelect = document.getElementById('model-select');

        // NEW: Function to fetch models from the proxy and populate the dropdown
        async function populateModels() {
            logOutput.textContent = 'Fetching available models from proxy...';
            try {
                const response = await fetch('${PROXY_MODELS_URL}');
                if (!response.ok) {
                    throw new Error(\`Failed to fetch models: \${response.status} \${response.statusText}\`);
                }
                const data = await response.json();

                if (!data.data || !Array.isArray(data.data)) {
                    throw new Error('Invalid response format from /v1/models endpoint.');
                }
                
                // Clear the 'Loading...' option
                modelSelect.innerHTML = ''; 

                // Populate with fetched models
                data.data.forEach(model => {
                    const option = document.createElement('option');
                    option.value = model.id;
                    option.textContent = model.id;
                    modelSelect.appendChild(option);
                });

                // Enable the dropdown now that it's populated
                modelSelect.disabled = false;
                logOutput.textContent = \`Successfully loaded \${data.data.length} models. Ready to generate.\`;

            } catch (error) {
                console.error('Error populating models:', error);
                logOutput.textContent = \`Error: Could not load models from the proxy server. Please ensure the proxy is running on port ${PROXY_API_PORT} and is accessible. \\n\\nDetails: \${error.message}\`;
                modelSelect.innerHTML = '<option>Error loading models</option>';
                // Keep the dropdown disabled if loading fails
            }
        }

        // Fetch models when the page loads
        document.addEventListener('DOMContentLoaded', populateModels);

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const prompt = document.getElementById('prompt-input').value;
            const model = document.getElementById('model-select').value;
            const size = document.getElementById('size-select').value;
            const n = parseInt(document.getElementById('n-input').value, 10);
            const apiKey = document.getElementById('api-key-input').value;

            if (!apiKey) { logOutput.textContent = 'Error: API Key is required.'; return; }
            if (modelSelect.disabled) { logOutput.textContent = 'Error: Models are not loaded yet or failed to load.'; return; }

            generateButton.disabled = true;
            spinner.style.display = 'block';
            resultsContainer.innerHTML = '';
            logOutput.textContent = 'Sending request to proxy...';

            const requestBody = { prompt, model, size, n };

            try {
                const response = await fetch('${PROXY_GENERATIONS_URL}', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': \`Bearer \${apiKey}\` },
                    body: JSON.stringify(requestBody),
                });
                const responseData = await response.json();
                if (!response.ok) throw responseData;
                
                logOutput.textContent = 'Success! Received images:\\n' + JSON.stringify(responseData, null, 2);
                if (responseData.data && Array.isArray(responseData.data)) {
                    responseData.data.forEach(imageObj => {
                        const imgElement = document.createElement('img');
                        imgElement.src = imageObj.url;
                        imgElement.alt = prompt;
                        resultsContainer.appendChild(imgElement);
                    });
                }
            } catch (error) {
                console.error('API call failed:', error);
                logOutput.textContent = 'API call failed!\\n\\n' + JSON.stringify(error, null, 2);
            } finally {
                generateButton.disabled = false;
                spinner.style.display = 'none';
            }
        });
    </script>
</body>
</html>
`;

// --- Deno Web Server ---
console.log(`Starting web tester server on http://localhost:${WEB_TESTER_PORT}`);
console.log(`It will try to connect to your proxy API at: ${PROXY_BASE_URL}`);

serve(async (req: Request) => {
    const url = new URL(req.url);
    if (req.method === "GET" && url.pathname === "/") {
        return new Response(HTML_CONTENT, {
            headers: { "Content-Type": "text/html; charset=utf-8" },
        });
    }
    return new Response("Not Found", { status: 404 });
}, { port: WEB_TESTER_PORT });