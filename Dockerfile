# 使用最小的Deno基础镜像
FROM denoland/deno:alpine AS base

# 定义端口参数，默认为8000
ARG PORT=8000

# 设置工作目录
WORKDIR /app

# 复制源代码
COPY router.ts .
COPY web-tester.ts .

# 缓存依赖项（如果Deno有依赖文件的话）
# RUN deno cache router.ts

# 设置用户
USER deno

# 暴露端口
EXPOSE ${PORT}

# 健康检查 - 使用Deno内置的fetch而不是curl
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD deno eval "const port = Deno.env.get('PORT') || '8000'; fetch('http://localhost:' + port + '/health').then(res => res.ok ? 0 : 1).catch(() => 1)" || exit 1

# 启动命令
CMD ["deno", "run", "--allow-net", "--allow-read=.env", "--allow-env", "router.ts"]