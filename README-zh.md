# OpenAI 兼容的 Fal.ai 代理网关

> 一个高性能的 Deno 代理服务，旨在无缝桥接 OpenAI 的图像生成 API 与 Fal.ai 强大的 AI 模型。

[English Version](README.md)

[![Deno](https://img.shields.io/badge/Deno-000000?style=for-the-badge&logo=deno&logoColor=white)](https://deno.land/)
[![OpenAI](https://img.shields.io/badge/OpenAI-Compatible-00A67E?style=for-the-badge&logo=openai&logoColor=white)](https://openai.com/)
[![Fal.ai](https://img.shields.io/badge/Fal.ai-Powered-FF6B35?style=for-the-badge)](https://fal.ai/)

## ✨ 核心特性

-   **🔌 即插即用**: 无需修改任何代码，即可将此代理集成到任何支持 OpenAI 的客户端或现有应用中。
-   **⚙️ 配置驱动**: 所有设置（包括支持的模型列表）都通过简单的 `.env` 文件进行管理，灵活且无需重启服务。
-   **🧠 动态模型适配**: 启动时自动获取并解析每个 Fal.ai 模型的 OpenAPI Schema，智能地映射 `size`、`width`/`height` 和 `aspect_ratio` 等参数。
-   **⚡ 高性能**: 服务启动时预热模型配置缓存，显著降低后续请求的延迟。
-   **🔐 集中式密钥管理**: 在服务器端安全地管理您的多个 Fal.ai API 密钥，并为客户端提供统一的访问凭证。
-   **🌐 CORS 就绪**: 内置完整的 CORS 支持，允许从任何 Web 前端应用直接调用。

## 🚀 快速上手

#### 1. 获取代码
下载 `router.ts` 文件，或克隆整个代码仓库。

#### 2. 创建配置文件
在 `router.ts` 所在的目录下创建一个名为 `.env` 的文件，并填入您的密钥和模型配置。

**.env 配置文件示例:**
```bash
# 用于访问此代理服务的自定义密钥
CUSTOM_ACCESS_KEY="my-super-secret-proxy-key"

# 您的 Fal.ai API 密钥，多个请用逗号分隔
AI_KEYS="fal-key-123abc,fal-key-456def"

# (可选) 服务运行的端口
PORT="8000"

# (可选) 设为 true 以开启详细的调试日志
DEBUG_MODE="true"

# 定义您希望通过代理暴露的模型
# 格式为 "自定义模型名:fal-ai/官方端点ID,另一个模型名:另一个端点ID"
SUPPORTED_MODELS="flux-dev:fal-ai/flux/dev,sdxl:fal-ai/stable-diffusion-xl,flux-schnell:fal-ai/flux-schnell"
```

#### 3. 启动服务

##### 方法1：直接运行（推荐用于开发）
使用 Deno 启动脚本，并授予必要的权限。
```bash
deno run --allow-net --allow-read=.env --allow-env router.ts
```
服务启动后，将自动加载所有模型配置，并准备好接收 API 请求。

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

## 🎯 API 使用说明

### 图像生成
向 `/v1/images/generations` 端点发送 `POST` 请求。代理服务会自动将其转换为 Fal.ai 的格式并调用相应的模型。

**`curl` 调用示例:**
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

### 其他端点
-   **获取模型列表**: `GET /v1/models` - 返回您在 `.env` 文件中配置的所有模型列表，格式与 OpenAI 的模型 API 一致。
-   **健康检查**: `GET /health` - 用于服务监控的简单接口，会返回 `{ "status": "ok" }`。

## ⚙️ 配置详解

所有配置均通过 `.env` 文件管理。

| 环境变量           | 描述                                                                                                   | 示例                                                               |
| ------------------ | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `CUSTOM_ACCESS_KEY`| **必需。** 您的客户端在 `Authorization: Bearer` 头中使用的、用于访问此代理服务的密钥。                 | `"my-secure-key-123"`                                              |
| `AI_KEYS`          | **必需。** 您真实的 Fal.ai API 密钥，以逗号分隔。代理会在每次请求时轮换使用。                           | `"fal-key-abc,fal-key-def"`                                        |
| `SUPPORTED_MODELS` | **必需。** 定义要暴露的模型列表，格式为 `自定义模型名:fal-ai/官方端点ID`，多个模型用逗号分隔。           | `"sdxl:fal-ai/stable-diffusion-xl,flux:fal-ai/flux/dev"`           |
| `PORT`             | *可选。* 代理服务器监听的端口。                                                                        | `8000` (默认)                                                      |
| `DEBUG_MODE`       | *可选。* 设为 `true` 以在控制台打印详细的请求、载荷和 Schema 解析日志，便于问题排查。                  | `true`                                                             |