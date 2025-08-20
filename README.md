# OpenAI-Compatible Fal.ai Proxy

> A high-performance Deno proxy that makes Fal.ai's powerful models available through the standard OpenAI `/v1/images/generations` API.

[中文版](README-zh.md)

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

##### 方法1：直接运行（推荐用于开发）
Start the Deno process with the necessary permissions.
```bash
deno run --allow-net --allow-read=.env --allow-env router.ts
```
The server will start, pre-load all model configurations, and be ready to accept requests.

##### 方法2：使用Docker（推荐用于生产环境）
项目提供了Docker支持，可以更方便地部署和管理。

1. 首先复制环境配置文件：
```bash
cp .env.example .env
```

2. 编辑 `.env` 文件，填入你的实际配置值

3. 使用Docker Compose启动服务：
```bash
# 生产环境部署
docker-compose up -d

# 开发环境部署（包含Web测试器）
cp docker-compose.override.yaml.example docker-compose.override.yaml
docker-compose up -d
```

服务将在配置的端口上运行，并包含健康检查和自动重启功能。

##### Docker自动化构建
本项目配置了GitHub Actions工作流，用于自动构建和推送到GitHub Container Registry (GHCR)。

###### 工作流特性
- **触发条件**：每当代码推送到`main`分支时自动触发
- **多平台支持**：构建支持linux/amd64和linux/arm64架构的镜像
- **版本管理**：使用日期格式版本（YYYY-MM-DD格式）
- **标签策略**：自动更新`latest`标签指向最新构建
- **目标Registry**：GitHub Container Registry (ghcr.io)

###### 镜像标签
构建的Docker镜像将被推送并标记为：
- `latest` - 指向最新的构建
- `YYYY-MM-DD`格式的日期标签 - 例如`2025-08-20`

###### 拉取镜像
你可以从GHCR拉取镜像（将 `YOUR_GITHUB_USERNAME` 替换为你的实际GitHub用户名）：
```bash
# 拉取最新版本
docker pull ghcr.io/YOUR_GITHUB_USERNAME/falproxy:latest

# 拉取特定日期版本
docker pull ghcr.io/YOUR_GITHUB_USERNAME/falproxy:2025-08-20
```

###### 构建配置
- 不使用Docker层缓存
- 使用GitHub Actions默认超时设置
- 无特殊通知机制
- 无并行构建

构建仅在生产环境中进行，确保代码质量和稳定性。

##### Docker故障排除

如果遇到问题，请检查以下几点：

1. **端口冲突**：确保配置的端口没有被其他服务占用
   ```bash
   # 检查端口占用情况
   netstat -tulpn | grep :8000
   ```

2. **权限问题**：确保Docker有权限访问项目目录和.env文件

3. **健康检查失败**：
   - 检查容器日志：`docker logs fal-proxy`
   - 确认环境变量配置正确
   - 验证Fal.ai API密钥有效

4. **构建问题**：
   - 清理Docker缓存：`docker builder prune`
   - 重新构建镜像：`docker-compose build --no-cache`

5. **容器无法启动**：
   - 检查环境变量是否正确设置
   - 确认.env文件格式正确（无多余的空格或特殊字符）

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

### Docker环境变量配置

当使用Docker部署时，可以通过以下方式配置环境变量：

1. **通过.env文件**（推荐）：
   ```bash
   # 复制示例配置
   cp .env.example .env
   # 编辑.env文件填入实际值
   ```

2. **通过docker-compose.yaml中的environment字段**：
   ```yaml
   environment:
     - CUSTOM_ACCESS_KEY=your-custom-key
     - AI_KEYS=your-fal-ai-keys
     - SUPPORTED_MODELS=model1:fal-ai/model1,model2:fal-ai/model2
   ```

3. **通过命令行**：
   ```bash
   CUSTOM_ACCESS_KEY=your-key AI_KEYS=your-keys docker-compose up -d
   ```

### 安全配置建议

1. **文件权限**：设置.env文件权限为600以防止未授权访问
   ```bash
   chmod 600 .env
   ```

2. **密钥轮换**：定期更换CUSTOM_ACCESS_KEY和AI_KEYS

3. **网络隔离**：在生产环境中使用防火墙限制对代理端口的访问

4. **Docker安全**：
   - 不要将敏感文件添加到Docker镜像中
   - 使用.dockerignore文件排除不必要的文件
   - 使用只读文件系统和临时文件系统增强容器安全性