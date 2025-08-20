// validate-workflow-config.ts - GitHub Actions工作流配置验证工具 (Deno)
// 用于验证GitHub Actions工作流配置文件的语法和逻辑正确性

import { parse } from "https://deno.land/std@0.208.0/flags/mod.ts";
import { exists } from "https://deno.land/std@0.208.0/fs/mod.ts";
import * as path from "https://deno.land/std@0.208.0/path/mod.ts";
import * as yaml from "https://deno.land/std@0.208.0/yaml/mod.ts";

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

// 验证GitHub Actions工作流配置
async function validateGitHubActionsWorkflow() {
  console.log("\n=== GitHub Actions工作流配置验证 ===");
  
  const workflowPath = path.join(Deno.cwd(), ".github/workflows/docker-publish.yml");
  if (!(await checkFileExists(workflowPath, "GitHub Actions工作流"))) {
    return false;
  }

  try {
    const content = await Deno.readTextFile(workflowPath);
    const workflow = yaml.parse(content) as any;
    
    // 验证基本结构
    if (!workflow.name) {
      printResult(false, "缺少工作流名称");
      return false;
    } else {
      printResult(true, `工作流名称: ${workflow.name}`);
    }
    
    if (!workflow.on) {
      printResult(false, "缺少触发条件配置");
      return false;
    } else {
      printResult(true, "触发条件配置存在");
    }
    
    // 检查触发条件
    if (workflow.on.push && workflow.on.push.branches) {
      const branches = workflow.on.push.branches;
      if (branches.includes("main")) {
        printResult(true, "包含main分支触发条件");
      } else {
        printWarning("未找到main分支触发条件");
      }
    }
    
    // 检查工作流调度触发
    if (workflow.on.schedule) {
      printResult(true, "包含计划触发条件");
    }
    
    // 检查手动触发
    if (workflow.on.workflow_dispatch) {
      printResult(true, "包含手动触发条件");
    }
    
    // 验证环境变量
    if (workflow.env) {
      const requiredEnv = ["REGISTRY", "IMAGE_NAME"];
      let allPresent = true;
      
      for (const envVar of requiredEnv) {
        if (!workflow.env[envVar]) {
          printResult(false, `缺少环境变量: ${envVar}`);
          allPresent = false;
        }
      }
      
      if (allPresent) {
        printResult(true, "所有必需环境变量都已定义");
        printResult(workflow.env.REGISTRY === "ghcr.io", "使用正确的Registry (ghcr.io)");
      }
    }
    
    // 验证任务配置
    if (!workflow.jobs || !workflow.jobs["build-and-push"]) {
      printResult(false, "缺少构建和推送任务");
      return false;
    }
    
    const job = workflow.jobs["build-and-push"];
    if (!job.steps || job.steps.length === 0) {
      printResult(false, "任务步骤未定义");
      return false;
    }
    
    printResult(true, "构建和推送任务配置正确");
    
    // 检查必需的步骤
    const requiredSteps = [
      "Checkout repository",
      "Set up QEMU",
      "Set up Docker Buildx",
      "Log in to the Container registry",
      "Extract metadata (tags, labels) for Docker",
      "Build and push Docker image"
    ];
    
    const stepNames = job.steps.map((step: any) => step.name);
    const missingSteps = requiredSteps.filter(step => !stepNames.includes(step));
    
    if (missingSteps.length > 0) {
      printResult(false, `缺少必需步骤: ${missingSteps.join(', ')}`);
      return false;
    } else {
      printResult(true, "所有必需步骤都已定义");
    }
    
    // 验证特定步骤配置
    const checkoutStep = job.steps.find((step: any) => step.name === "Checkout repository");
    if (checkoutStep && checkoutStep.uses) {
      printResult(checkoutStep.uses.includes("actions/checkout"), "Checkout步骤使用正确的Action");
    }
    
    const qemuStep = job.steps.find((step: any) => step.name === "Set up QEMU");
    if (qemuStep && qemuStep.uses) {
      printResult(qemuStep.uses.includes("docker/setup-qemu-action"), "QEMU步骤使用正确的Action");
    }
    
    const buildxStep = job.steps.find((step: any) => step.name === "Set up Docker Buildx");
    if (buildxStep && buildxStep.uses) {
      printResult(buildxStep.uses.includes("docker/setup-buildx-action"), "Buildx步骤使用正确的Action");
    }
    
    const loginStep = job.steps.find((step: any) => step.name === "Log in to the Container registry");
    if (loginStep && loginStep.uses) {
      printResult(loginStep.uses.includes("docker/login-action"), "登录步骤使用正确的Action");
      if (loginStep.with && loginStep.with.registry) {
        printResult(loginStep.with.registry === "${{ env.REGISTRY }}", "登录步骤使用正确的Registry变量");
      }
    }
    
    const metadataStep = job.steps.find((step: any) => step.name === "Extract metadata (tags, labels) for Docker");
    if (metadataStep && metadataStep.uses) {
      printResult(metadataStep.uses.includes("docker/metadata-action"), "元数据步骤使用正确的Action");
      
      if (metadataStep.with && metadataStep.with.tags) {
        const tags = metadataStep.with.tags as string;
        if (tags.includes("type=raw,value=latest") && tags.includes("type=raw,value={{date 'YYYY-MM-DD'}}")) {
          printResult(true, "标签配置正确");
        } else {
          printWarning("标签配置可能不完整");
        }
      }
    }
    
    const buildPushStep = job.steps.find((step: any) => step.name === "Build and push Docker image");
    if (buildPushStep && buildPushStep.uses) {
      printResult(buildPushStep.uses.includes("docker/build-push-action"), "构建推送步骤使用正确的Action");
      
      if (buildPushStep.with) {
        printResult(buildPushStep.with.context === ".", "构建上下文配置正确");
        printResult(buildPushStep.with.push === true, "推送配置已启用");
        
        if (buildPushStep.with.platforms) {
          const platforms = buildPushStep.with.platforms as string;
          if (platforms.includes("linux/amd64") && platforms.includes("linux/arm64")) {
            printResult(true, "多平台构建配置正确");
          } else {
            printWarning("多平台构建配置可能不完整");
          }
        }
      }
    }
    
    // 验证权限配置
    if (job.permissions) {
      const requiredPermissions = ["contents", "packages", "pull-requests"];
      let allPermissionsPresent = true;
      
      for (const permission of requiredPermissions) {
        if (!job.permissions[permission]) {
          printWarning(`缺少权限配置: ${permission}`);
          // 不算作失败，只是警告
        }
      }
      
      if (allPermissionsPresent || Object.keys(job.permissions).length > 0) {
        printResult(true, "权限配置存在");
      }
    } else {
      printWarning("未明确配置权限");
    }
    
    return true;
  } catch (error) {
    printResult(false, `验证GitHub Actions工作流失败: ${error.message}`);
    return false;
  }
}

// 验证Dockerfile（增强版）
async function validateDockerfileEnhanced() {
  console.log("\n=== Dockerfile增强验证 ===");
  
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
      printResult(baseImage.includes("deno") && baseImage.includes("alpine"), "使用 Deno Alpine 基础镜像");
    }
    
    // 检查健康检查
    const hasHealthcheck = lines.some(line => line.trim().toUpperCase().startsWith("HEALTHCHECK "));
    if (hasHealthcheck) {
      printResult(true, "包含 HEALTHCHECK 指令");
      
      // 检查健康检查命令
      const healthcheckLine = lines.find(line => line.trim().toUpperCase().startsWith("HEALTHCHECK "));
      if (healthcheckLine && healthcheckLine.includes("deno eval")) {
        printResult(true, "健康检查使用Deno命令");
      } else {
        printWarning("健康检查未使用Deno命令");
      }
    } else {
      printWarning("未配置健康检查");
    }
    
    // 检查暴露端口
    const hasExpose = lines.some(line => line.trim().toUpperCase().startsWith("EXPOSE "));
    printResult(hasExpose, "包含 EXPOSE 指令");
    
    // 检查端口变量使用
    const exposeLine = lines.find(line => line.trim().toUpperCase().startsWith("EXPOSE "));
    if (exposeLine && exposeLine.includes("${PORT}")) {
      printResult(true, "EXPOSE指令使用PORT变量");
    } else if (exposeLine) {
      printWarning("EXPOSE指令未使用PORT变量");
    }
    
    // 检查用户设置
    const hasUser = lines.some(line => line.trim().toUpperCase().startsWith("USER "));
    if (hasUser) {
      const userLine = lines.find(line => line.trim().toUpperCase().startsWith("USER "));
      if (userLine && userLine.includes("deno")) {
        printResult(true, "使用deno用户运行");
      } else {
        printWarning("未使用deno用户运行");
      }
    } else {
      printWarning("未明确设置运行用户");
    }
    
    return true;
  } catch (error) {
    printResult(false, `读取 Dockerfile 失败: ${error.message}`);
    return false;
  }
}

// 验证docker-compose.yaml（增强版）
async function validateDockerComposeEnhanced() {
  console.log("\n=== docker-compose.yaml增强验证 ===");
  
  const composePath = path.join(Deno.cwd(), "docker-compose.yaml");
  if (!(await checkFileExists(composePath, "docker-compose.yaml"))) {
    return false;
  }

  try {
    // 尝试解析YAML
    const content = await Deno.readTextFile(composePath);
    const compose = yaml.parse(content) as any;
    
    // 检查版本
    if (compose.version) {
      printResult(true, `docker-compose版本: ${compose.version}`);
    } else {
      printWarning("未指定docker-compose版本");
    }
    
    // 检查必需的服务配置
    if (!compose.services) {
      printResult(false, "缺少 services 配置");
      return false;
    }
    
    if (!compose.services["fal-proxy"]) {
      printResult(false, "缺少 fal-proxy 服务");
      return false;
    }
    
    const service = compose.services["fal-proxy"];
    printResult(true, "包含 fal-proxy 服务");
    
    // 检查构建配置
    if (service.build) {
      printResult(true, "包含构建配置");
    } else {
      printResult(false, "缺少构建配置");
      return false;
    }
    
    // 检查端口配置
    if (service.ports) {
      printResult(true, "包含端口配置");
      
      // 检查端口变量使用
      const portConfig = service.ports[0];
      if (typeof portConfig === "string" && portConfig.includes("${PORT:-8000}")) {
        printResult(true, "端口配置使用变量");
      } else {
        printWarning("端口配置未使用变量");
      }
    } else {
      printResult(false, "缺少端口配置");
      return false;
    }
    
    // 检查环境变量配置
    if (service.environment) {
      printResult(true, "包含环境变量配置");
      
      // 检查必需的环境变量
      const requiredEnvVars = ["CUSTOM_ACCESS_KEY", "AI_KEYS", "SUPPORTED_MODELS", "PORT"];
      const envVars = Array.isArray(service.environment) ? service.environment : Object.keys(service.environment);
      let allPresent = true;
      
      for (const envVar of requiredEnvVars) {
        const hasVar = envVars.some((varEntry: string) => {
          if (typeof varEntry === "string") {
            return varEntry.startsWith(envVar);
          } else {
            return varEntry === envVar;
          }
        });
        
        if (!hasVar) {
          printWarning(`缺少环境变量配置: ${envVar}`);
        }
      }
    } else {
      printResult(false, "缺少环境变量配置");
      return false;
    }
    
    // 检查重启策略
    if (service.restart) {
      printResult(true, `重启策略: ${service.restart}`);
    } else {
      printWarning("未配置重启策略");
    }
    
    // 检查健康检查
    if (service.healthcheck) {
      printResult(true, "包含健康检查配置");
      
      if (service.healthcheck.test) {
        const test = service.healthcheck.test;
        if (Array.isArray(test) && test.includes("deno")) {
          printResult(true, "健康检查使用Deno命令");
        } else if (typeof test === "string" && test.includes("deno")) {
          printResult(true, "健康检查使用Deno命令");
        } else {
          printWarning("健康检查未使用Deno命令");
        }
      }
    } else {
      printWarning("未配置健康检查");
    }
    
    // 检查安全配置
    if (service.security_opt) {
      if (service.security_opt.includes("no-new-privileges:true")) {
        printResult(true, "禁止特权升级配置正确");
      } else {
        printWarning("缺少禁止特权升级配置");
      }
    } else {
      printWarning("未配置安全选项");
    }
    
    if (service.read_only === true) {
      printResult(true, "只读文件系统配置正确");
    } else {
      printWarning("未配置只读文件系统");
    }
    
    if (service.tmpfs) {
      if (Array.isArray(service.tmpfs) && service.tmpfs.includes("/tmp")) {
        printResult(true, "临时文件系统配置正确");
      } else if (service.tmpfs === "/tmp") {
        printResult(true, "临时文件系统配置正确");
      } else {
        printWarning("临时文件系统配置可能不正确");
      }
    } else {
      printWarning("未配置临时文件系统");
    }
    
    // 检查资源限制
    if (service.deploy && service.deploy.resources) {
      const resources = service.deploy.resources;
      if (resources.limits && resources.limits.memory) {
        printResult(true, `内存限制: ${resources.limits.memory}`);
      }
      
      if (resources.reservations && resources.reservations.memory) {
        printResult(true, `预留内存: ${resources.reservations.memory}`);
      }
    } else {
      printWarning("未配置资源限制");
    }
    
    // 检查网络配置
    if (service.networks) {
      printResult(true, "包含网络配置");
    } else {
      printWarning("未配置网络");
    }
    
    return true;
  } catch (error) {
    printResult(false, `验证 docker-compose.yaml 失败: ${error.message}`);
    return false;
  }
}

// 验证.env.example（增强版）
async function validateEnvExampleEnhanced() {
  console.log("\n=== .env.example增强验证 ===");
  
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
    
    // 检查可选环境变量
    const optionalVars = ["PORT", "DEBUG_MODE"];
    for (const variable of optionalVars) {
      const hasVar = lines.some(line => 
        line.trim().startsWith(variable + "=") || 
        line.includes(`#${variable}`)
      );
      
      if (hasVar) {
        printResult(true, `包含可选环境变量: ${variable}`);
      } else {
        printWarning(`缺少可选环境变量: ${variable}`);
      }
    }
    
    // 检查安全建议
    const securityNotes = lines.filter(line => line.includes("安全建议") || line.includes("安全配置"));
    if (securityNotes.length > 0) {
      printResult(true, "包含安全配置建议");
    } else {
      printWarning("缺少安全配置建议");
    }
    
    return true;
  } catch (error) {
    printResult(false, `读取 .env.example 失败: ${error.message}`);
    return false;
  }
}

// 验证.dockerignore
async function validateDockerignoreEnhanced() {
  console.log("\n=== .dockerignore增强验证 ===");
  
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
    
    // 检查特定项目忽略项
    const projectPatterns = [
      "web-tester.ts",
      "web-tester.html",
      "test-docker.sh",
      "test-docker.bat",
      "README.md",
      "TESTING.md",
      "integration-tests.md",
      "CLAUDE.md"
    ];
    
    for (const pattern of projectPatterns) {
      const hasPattern = lines.includes(pattern);
      if (hasPattern) {
        printResult(true, `.dockerignore 中包含项目特定忽略项: ${pattern}`);
      } else {
        printWarning(`.dockerignore 中缺少项目特定忽略项: ${pattern}`);
      }
    }
    
    printResult(true, ".dockerignore 文件存在");
    return true;
  } catch (error) {
    printResult(false, `读取 .dockerignore 失败: ${error.message}`);
    return false;
  }
}

// 验证README.md（增强版）
async function validateReadmeEnhanced() {
  console.log("\n=== README.md增强验证 ===");
  
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
    
    // 检查GitHub Actions相关文档
    const hasWorkflowDocs = content.includes("GitHub Actions") || content.includes("工作流") || content.includes("CI/CD");
    printResult(hasWorkflowDocs, "包含GitHub Actions文档");
    
    // 检查自动化构建文档
    const hasAutoBuildDocs = content.includes("自动化构建") || content.includes("自动构建") || content.includes("自动化");
    printResult(hasAutoBuildDocs, "包含自动化构建文档");
    
    // 检查镜像标签文档
    const hasTagDocs = content.includes("镜像标签") || content.includes("标签策略") || content.includes("latest");
    printResult(hasTagDocs, "包含镜像标签文档");
    
    // 检查安全配置文档
    const hasSecurityDocs = content.includes("安全配置") || content.includes("安全建议") || content.includes("权限");
    printResult(hasSecurityDocs, "包含安全配置文档");
    
    return true;
  } catch (error) {
    printResult(false, `读取 README.md 失败: ${error.message}`);
    return false;
  }
}

// 主验证函数
async function validateAll() {
  console.log("=========================================");
  console.log("GitHub Actions Docker自动化构建配置验证工具");
  console.log("=========================================");
  
  const results = [];
  
  // 验证所有配置文件
  results.push(await validateGitHubActionsWorkflow());
  results.push(await validateDockerfileEnhanced());
  results.push(await validateDockerComposeEnhanced());
  results.push(await validateEnvExampleEnhanced());
  results.push(await validateDockerignoreEnhanced());
  results.push(await validateReadmeEnhanced());
  
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
  console.log("用法: deno run validate-workflow-config.ts [选项]");
  console.log("选项:");
  console.log("  --help, -h              显示此帮助信息");
  console.log("  --workflow              仅验证 GitHub Actions工作流");
  console.log("  --dockerfile            仅验证 Dockerfile");
  console.log("  --compose               仅验证 docker-compose.yaml");
  console.log("  --env                   仅验证 .env.example");
  console.log("  --ignore                仅验证 .dockerignore");
  console.log("  --readme                仅验证 README.md");
  console.log("\n示例:");
  console.log("  deno run validate-workflow-config.ts");
  console.log("  deno run validate-workflow-config.ts --workflow");
  console.log("  deno run validate-workflow-config.ts --workflow --dockerfile");
}

// 解析命令行参数
const args = parse(Deno.args, {
  alias: {
    h: "help"
  },
  boolean: ["help", "workflow", "dockerfile", "compose", "env", "ignore", "readme"]
});

// 显示帮助
if (args.help) {
  showHelp();
  Deno.exit(0);
}

// 根据参数执行验证
async function run() {
  if (args.workflow) {
    await validateGitHubActionsWorkflow();
  } else if (args.dockerfile) {
    await validateDockerfileEnhanced();
  } else if (args.compose) {
    await validateDockerComposeEnhanced();
  } else if (args.env) {
    await validateEnvExampleEnhanced();
  } else if (args.ignore) {
    await validateDockerignoreEnhanced();
  } else if (args.readme) {
    await validateReadmeEnhanced();
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