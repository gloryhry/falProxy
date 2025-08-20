# 使用最小的Deno基础镜像
FROM denoland/deno:alpine AS base

# 设置工作目录
WORKDIR /app

# 复制依赖文件（先复制配置文件以优化缓存层）
COPY .env.example ./
COPY CLAUDE.md ./ 2>/dev/null || true

# 复制源代码
COPY router.ts .
COPY web-tester.ts ./ 2>/dev/null || true

# 缓存依赖项（如果Deno有依赖文件的话）
# RUN deno cache router.ts

# 设置用户
USER deno

# 暴露端口
EXPOSE 8000

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:8000/health || exit 1

# 启动命令
CMD ["deno", "run", "--allow-net", "--allow-read=.env", "--allow-env", "router.ts"]