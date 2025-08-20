// validate-config.ts - 配置文件验证脚本 (Deno)
// 用于验证Docker和环境配置文件的语法和逻辑正确性

import { parse } from "https://deno.land/std@0.208.0/flags/mod.ts";
import { exists } from "https://deno.land/std@0.208.0/fs/mod.ts";
import * as path from "https://deno.land/std@0.208.0/path/mod.ts";

// 颜色定义
const colors = {
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  reset: "\x1b[0m",
};

// 测试结果计数器
let passed = 0;
let failed = 0;

// 打印测试结果
function printResult(success: boolean, message: string) {
  if (success) {
    console.log(`${colors.green}✓ PASSED${colors.reset}: ${message}`);
    passed++;
  } else {
    console.log(`${colors.red}✗ FAILED${colors.reset}: ${message}`);
    failed++;
  }
}

// 打印警告信息
function printWarning(message: string) {
  console.log(`${colors.yellow}⚠ WARNING${colors.reset}: ${message}`);
}

// 检查文件是否存在
async function checkFileExists(filePath: string, description: string) {
  const existsResult = await exists(filePath);
  printResult(existsResult, `${description} 文件存在`);
  return existsResult;
}

// 验证Dockerfile
async function validateDockerfile() {
  console.log("\n=== Dockerfile 验证 ===");
  
  const dockerfilePath = path.join(Deno.cwd(), "Dockerfile");
  if (!(await checkFileExists(dockerfilePath, "Dockerfile"))) {
    return false;
  }

  try {
    const content = await Deno.readTextFile(dockerfilePath);
    const lines = content.split("\n");
    
    // 检查必需指令
    const hasFrom = lines.some(line => line.trim().toUpperCase().startsWith("FROM "));
    const hasCmd = lines.some(line => line.trim().toUpperCase().startsWith("CMD "));
    
    printResult(hasFrom, "包含 FROM 指令");
    printResult(hasCmd, "包含 CMD 指令");
    
    // 检查基础镜像
    const fromLine = lines.find(line => line.trim().toUpperCase().startsWith("FROM "));
    if (fromLine) {
      const baseImage = fromLine.trim().split(/\s+/)[1];
      printResult(baseImage.includes("deno"), "使用 Deno 基础镜像");
    }
    
    // 检查健康检查
    const hasHealthcheck = lines.some(line => line.trim().toUpperCase().startsWith("HEALTHCHECK "));
    if (hasHealthcheck) {
      printResult(true, "包含 HEALTHCHECK 指令");
    } else {
      printWarning("未配置健康检查");
    }
    
    // 检查暴露端口
    const hasExpose = lines.some(line => line.trim().toUpperCase().startsWith("EXPOSE "));
    printResult(hasExpose, "包含 EXPOSE 指令");
    
    return true;
  } catch (error) {
    printResult(false, `读取 Dockerfile 失败: ${error.message}`);
    return false;
  }
}

// 验证docker-compose.yaml
async function validateDockerCompose() {
  console.log("\n=== docker-compose.yaml 验证 ===");
  
  const composePath = path.join(Deno.cwd(), "docker-compose.yaml");
  if (!(await checkFileExists(composePath, "docker-compose.yaml"))) {
    return false;
  }

  try {
    // 尝试解析YAML
    const process = Deno.run({
      cmd: ["docker-compose", "config"],
      stdout: "null",
      stderr: "piped"
    });
    
    const { code } = await process.status();
    const stderr = new TextDecoder().decode(await process.stderrOutput());
    process.close();
    
    if (code === 0) {
      printResult(true, "docker-compose.yaml 语法正确");
    } else {
      printResult(false, `docker-compose.yaml 语法错误: ${stderr}`);
      return false;
    }
    
    // 读取文件内容进行更详细的检查
    const content = await Deno.readTextFile(composePath);
    
    // 检查必需的服务配置
    const hasService = content.includes("services:");
    const hasFalProxy = content.includes("fal-proxy:");
    
    printResult(hasService, "包含 services 配置");
    printResult(hasFalProxy, "包含 fal-proxy 服务");
    
    // 检查环境变量配置
    const hasEnvConfig = content.includes("environment:") || content.includes("env_file:");
    printResult(hasEnvConfig, "包含环境变量配置");
    
    // 检查端口配置
    const hasPortConfig = content.includes("ports:");
    printResult(hasPortConfig, "包含端口配置");
    
    // 检查重启策略
    const hasRestart = content.includes("restart:");
    printResult(hasRestart, "包含重启策略");
    
    return true;
  } catch (error) {
    printResult(false, `验证 docker-compose.yaml 失败: ${error.message}`);
    return false;
  }
}

// 验证.env.example
async function validateEnvExample() {
  console.log("\n=== .env.example 验证 ===");
  
  const envPath = path.join(Deno.cwd(), ".env.example");
  if (!(await checkFileExists(envPath, ".env.example"))) {
    return false;
  }

  try {
    const content = await Deno.readTextFile(envPath);
    const lines = content.split("\n");
    
    // 检查必需的环境变量
    const requiredVars = ["CUSTOM_ACCESS_KEY", "AI_KEYS", "SUPPORTED_MODELS"];
    let allPresent = true;
    
    for (const variable of requiredVars) {
      const hasVar = lines.some(line => 
        line.trim().startsWith(variable + "=") || 
        line.includes(`#${variable}`)
      );
      
      if (!hasVar) {
        printResult(false, `缺少必需环境变量: ${variable}`);
        allPresent = false;
      }
    }
    
    if (allPresent) {
      printResult(true, "所有必需环境变量都已定义");
    }
    
    // 检查变量格式
    const customAccessKeyLine = lines.find(line => line.startsWith("CUSTOM_ACCESS_KEY="));
    if (customAccessKeyLine) {
      const value = customAccessKeyLine.split("=")[1];
      if (value && value.length > 10) {
        printResult(true, "CUSTOM_ACCESS_KEY 格式合理");
      } else {
        printWarning("CUSTOM_ACCESS_KEY 值可能过短");
      }
    }
    
    const aiKeysLine = lines.find(line => line.startsWith("AI_KEYS="));
    if (aiKeysLine) {
      const value = aiKeysLine.split("=")[1];
      if (value && value.includes(",")) {
        printResult(true, "AI_KEYS 支持多密钥配置");
      } else if (value) {
        printResult(true, "AI_KEYS 配置单个密钥");
      } else {
        printWarning("AI_KEYS 值为空");
      }
    }
    
    const supportedModelsLine = lines.find(line => line.startsWith("SUPPORTED_MODELS="));
    if (supportedModelsLine) {
      const value = supportedModelsLine.split("=")[1];
      if (value && value.includes(":") && value.includes(",")) {
        printResult(true, "SUPPORTED_MODELS 格式正确 (多模型配置)");
      } else if (value && value.includes(":")) {
        printResult(true, "SUPPORTED_MODELS 格式正确 (单模型配置)");
      } else {
        printWarning("SUPPORTED_MODELS 格式可能不正确");
      }
    }
    
    return true;
  } catch (error) {
    printResult(false, `读取 .env.example 失败: ${error.message}`);
    return false;
  }
}

// 验证.dockerignore
async function validateDockerignore() {
  console.log("\n=== .dockerignore 验证 ===");
  
  const ignorePath = path.join(Deno.cwd(), ".dockerignore");
  if (!(await checkFileExists(ignorePath, ".dockerignore"))) {
    return false;
  }

  try {
    const content = await Deno.readTextFile(ignorePath);
    const lines = content.split("\n").map(line => line.trim()).filter(line => line && !line.startsWith("#"));
    
    // 检查关键忽略项
    const keyPatterns = [".env", "node_modules", ".git"];
    let allPresent = true;
    
    for (const pattern of keyPatterns) {
      const hasPattern = lines.includes(pattern);
      if (!hasPattern) {
        printWarning(`.dockerignore 中缺少模式: ${pattern}`);
        // 不算作失败，只是警告
      }
    }
    
    printResult(true, ".dockerignore 文件存在");
    return true;
  } catch (error) {
    printResult(false, `读取 .dockerignore 失败: ${error.message}`);
    return false;
  }
}

// 验证GitHub Actions工作流
async function validateGitHubActionsWorkflow() {
  console.log("\n=== GitHub Actions工作流验证 ===");
  
  const workflowPath = path.join(Deno.cwd(), ".github/workflows/docker-publish.yml");
  if (!(await checkFileExists(workflowPath, "GitHub Actions工作流"))) {
    return false;
  }

  try {
    // 尝试解析YAML
    const process = Deno.run({
      cmd: ["docker", "run", "--rm", "-v", `${Deno.cwd()}:/app`, "python:alpine", "python", "-c", 
            "import yaml; import sys; yaml.safe_load(open('/app/.github/workflows/docker-publish.yml')); print('YAML语法正确')"],
      stdout: "piped",
      stderr: "piped"
    });
    
    const { code } = await process.status();
    const stdout = new TextDecoder().decode(await process.output());
    const stderr = new TextDecoder().decode(await process.stderrOutput());
    process.close();
    
    if (code === 0 && stdout.includes("YAML语法正确")) {
      printResult(true, "GitHub Actions工作流YAML语法正确");
    } else {
      printResult(false, `GitHub Actions工作流YAML语法错误: ${stderr}`);
      return false;
    }
    
    // 读取文件内容进行更详细的检查
    const content = await Deno.readTextFile(workflowPath);
    
    // 检查必需的配置项
    const hasName = content.includes("name:");
    const hasOn = content.includes("on:");
    const hasJobs = content.includes("jobs:");
    
    printResult(hasName, "包含工作流名称配置");
    printResult(hasOn, "包含触发条件配置");
    printResult(hasJobs, "包含任务配置");
    
    // 检查关键步骤
    const hasCheckout = content.includes("actions/checkout");
    const hasBuildx = content.includes("docker/setup-buildx-action");
    const hasLogin = content.includes("docker/login-action");
    const hasMetadata = content.includes("docker/metadata-action");
    const hasBuildPush = content.includes("docker/build-push-action");
    
    printResult(hasCheckout, "包含代码检出步骤");
    printResult(hasBuildx, "包含Buildx设置步骤");
    printResult(hasLogin, "包含登录步骤");
    printResult(hasMetadata, "包含元数据提取步骤");
    printResult(hasBuildPush, "包含构建推送步骤");
    
    return true;
  } catch (error) {
    printResult(false, `验证 GitHub Actions工作流 失败: ${error.message}`);
    return false;
  }
}
  
  const readmePath = path.join(Deno.cwd(), "README.md");
  if (!(await checkFileExists(readmePath, "README.md"))) {
    return false;
  }

  try {
    const content = await Deno.readTextFile(readmePath);
    
    // 检查关键内容
    const hasTitle = content.includes("# OpenAI-Compatible Fal.ai Proxy");
    const hasQuickStart = content.includes("## 🚀 Quick Start");
    const hasUsage = content.includes("## 🎯 Usage");
    const hasConfig = content.includes("## ⚙️ Configuration Details");
    
    printResult(hasTitle, "包含项目标题");
    printResult(hasQuickStart, "包含快速开始指南");
    printResult(hasUsage, "包含使用说明");
    printResult(hasConfig, "包含配置详情");
    
    // 检查Docker相关文档
    const hasDockerDocs = content.includes("docker-compose") || content.includes("Docker");
    printResult(hasDockerDocs, "包含Docker部署文档");
    
    return true;
  } catch (error) {
    printResult(false, `读取 README.md 失败: ${error.message}`);
    return false;
  }
}

// 主验证函数
async function validateAll() {
  console.log("=========================================");
  console.log("Docker容器化部署配置验证工具");
  console.log("=========================================");
  
  const results = [];
  
  // 验证所有配置文件
  results.push(await validateDockerfile());
  results.push(await validateDockerCompose());
  results.push(await validateEnvExample());
  results.push(await validateDockerignore());
  results.push(await validateReadme());
  
  // 输出总结
  console.log("\n=========================================");
  console.log("验证完成!");
  console.log(`${colors.green}通过: ${passed}${colors.reset}`);
  console.log(`${colors.red}失败: ${failed}${colors.reset}`);
  
  if (failed === 0) {
    console.log(`${colors.green}所有配置验证通过!${colors.reset}`);
    return true;
  } else {
    console.log(`${colors.red}有 ${failed} 个验证失败!${colors.reset}`);
    return false;
  }
}

// 显示帮助信息
function showHelp() {
  console.log("用法: deno run validate-config.ts [选项]");
  console.log("选项:");
  console.log("  --help, -h    显示此帮助信息");
  console.log("  --dockerfile  仅验证 Dockerfile");
  console.log("  --compose     仅验证 docker-compose.yaml");
  console.log("  --env         仅验证 .env.example");
  console.log("  --ignore      仅验证 .dockerignore");
  console.log("  --readme      仅验证 README.md");
  console.log("  --workflow    仅验证 GitHub Actions工作流");
  console.log("\n示例:");
  console.log("  deno run validate-config.ts");
  console.log("  deno run validate-config.ts --dockerfile");
  console.log("  deno run validate-config.ts --compose --env");
  console.log("  deno run validate-config.ts --workflow");
}

// 解析命令行参数
const args = parse(Deno.args, {
  alias: {
    h: "help"
  },
  boolean: ["help", "dockerfile", "compose", "env", "ignore", "readme", "workflow"]
});

// 显示帮助
if (args.help) {
  showHelp();
  Deno.exit(0);
}

// 根据参数执行验证
async function run() {
  if (args.dockerfile) {
    await validateDockerfile();
  } else if (args.compose) {
    await validateDockerCompose();
  } else if (args.env) {
    await validateEnvExample();
  } else if (args.ignore) {
    await validateDockerignore();
  } else if (args.readme) {
    await validateReadme();
  } else if (args.workflow) {
    await validateGitHubActionsWorkflow();
  } else {
    // 默认验证所有
    const success = await validateAll();
    Deno.exit(success ? 0 : 1);
  }
}

// 运行验证
if (import.meta.main) {
  run();
}