import process from 'node:process';
import { fileURLToPath } from 'node:url';

// 只有明显会执行命令的工具才需要进入发布守卫判断，避免误拦普通编辑类操作。
const COMMAND_TOOL_NAME_PATTERNS = [
  /run_in_terminal/i,
  /create_and_run_task/i,
  /terminal/i,
  /shell/i,
  /^bash$/i,
];

// 直接本地 publish 会绕过 tag 驱动的正式发布链路，因此必须硬性拒绝。
const DIRECT_PUBLISH_PATTERN = /(?:^|[;&|]\s*)(?:pnpm|npm)\s+publish(?:\s|$)/i;
// `release:auto` 是新的总控入口；dry-run 可放行，真实执行则必须提醒确认。
const RELEASE_AUTO_PATTERN = /(?:^|[;&|]\s*)pnpm\s+release:auto(?:\s|$)/i;
// 这些命令都会改变本地或远端发布状态，至少要做一次确认拦截。
const MUTATING_RELEASE_PATTERN = /(?:^|[;&|]\s*)(?:pnpm\s+release:prepare|git\s+tag(?:\s|$)|git\s+push(?:\s|$))/i;
// 从 release:prepare 命令里提取目标版本，用于生成更具体的提示文案。
const RELEASE_PREPARE_TARGET_PATTERN = /(?:^|[;&|]\s*)pnpm\s+release:prepare\s+([^\s;&|]+)/i;
// 从 release:auto 命令里提取目标版本，方便推荐对应的 dry-run 命令。
const RELEASE_AUTO_TARGET_PATTERN = /(?:^|[;&|]\s*)pnpm\s+release:auto\s+([^\s;&|]+)/i;

// Hook 通过 stdin 接收 JSON 负载，这里只负责把原始输入完整读出来。
function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data));
    process.stdin.resume();
  });
}

// 多种 payload 结构并存时，统一取第一个有效字符串值，减少分支噪音。
function firstString(...values) {
  return values.find((value) => typeof value === 'string' && value.trim());
}

// 有些 hook 负载会把命令藏在嵌套对象或数组里，这里递归把它找出来。
function findCommandValue(value) {
  if (!value || typeof value !== 'object') return undefined;

  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = findCommandValue(item);
      if (nested) return nested;
    }
    return undefined;
  }

  const direct = firstString(value.command, value.cmd);
  if (direct) return direct;

  for (const nestedValue of Object.values(value)) {
    const nested = findCommandValue(nestedValue);
    if (nested) return nested;
  }

  return undefined;
}

// 不同宿主会用不同字段名描述工具名，这里统一做兼容读取。
function getToolName(payload) {
  return firstString(
    payload?.toolName,
    payload?.tool_name,
    payload?.tool?.name,
    payload?.tool?.id,
    payload?.name,
    payload?.hookEventData?.toolName,
    payload?.hookEventData?.tool_name,
    payload?.hookEventData?.tool?.name,
  );
}

// 尽可能兼容不同 hook payload 形状，把真正的命令文本提取出来参与守卫判断。
export function getCommandText(payload) {
  return firstString(
    payload?.toolInput?.command,
    payload?.tool_input?.command,
    payload?.arguments?.command,
    payload?.params?.command,
    payload?.input?.command,
    payload?.hookEventData?.toolInput?.command,
    payload?.hookEventData?.tool_input?.command,
    payload?.hookEventData?.arguments?.command,
    findCommandValue(payload),
  );
}

// 未知工具默认按“可能执行命令”处理，宁可多检查一步，也不要漏掉高风险动作。
function isCommandTool(toolName) {
  if (!toolName) return true;
  return COMMAND_TOOL_NAME_PATTERNS.some((pattern) => pattern.test(toolName));
}

// 统一组装 hook 返回结构，避免每个分支手写重复 JSON。
function createDecision(permissionDecision, reason, systemMessage) {
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision,
      permissionDecisionReason: reason,
    },
    systemMessage,
  };
}

// 对 `release:prepare` 生成更具体的阻断提示，让用户先看对应版本的 dry-run 结果。
function buildMutatingReleaseMessage(commandText) {
  const releasePrepareMatch = RELEASE_PREPARE_TARGET_PATTERN.exec(commandText);
  if (releasePrepareMatch) {
    const requestedVersion = releasePrepareMatch[1];
    return `这个命令会改动发布状态。建议先运行 \`pnpm release:dry-run ${requestedVersion}\`，确认当前版本、目标 tag、changelog 迁移和阻塞项；只有在用户已经明确要求继续执行真实发布动作时才应放行。`;
  }

  return '这个命令会改动发布状态（例如 release:prepare、tag、push）。只有在用户已经明确要求继续执行真实发布动作时才应放行。';
}

// `release:auto --dry-run` 仍是只读预演，应该允许直接执行。
function isReleaseAutoDryRun(commandText) {
  return RELEASE_AUTO_PATTERN.test(commandText) && /(?:^|\s)--dry-run(?:\s|$)/i.test(commandText);
}

// 对 `release:auto` 的提示要推荐完整 dry-run 入口，而不是只提示底层 prepare 命令。
function buildReleaseAutoMessage(commandText) {
  const releaseAutoMatch = RELEASE_AUTO_TARGET_PATTERN.exec(commandText);
  if (releaseAutoMatch) {
    const requestedVersion = releaseAutoMatch[1];
    return `这个命令会运行自动化发布流程。建议先运行 \`pnpm release:auto ${requestedVersion} --dry-run\` 预演完整步骤；只有在用户已经明确要求继续执行真实发布动作时才应放行。`;
  }

  return '这个命令会运行自动化发布流程。建议先使用 `pnpm release:auto <version-or-bump> --dry-run` 预演，再决定是否继续执行真实发布动作。';
}

// 发布守卫的核心判断入口：直接拒绝本地 publish，询问高风险命令，放行只读预演。
export function evaluateReleaseGuard(payload) {
  const toolName = getToolName(payload);
  const commandText = getCommandText(payload);

  if (!commandText || !isCommandTool(toolName)) {
    return null;
  }

  if (DIRECT_PUBLISH_PATTERN.test(commandText)) {
    return createDecision(
      'deny',
      'Local publish is blocked for this repository.',
      '请不要直接运行本地 npm/pnpm publish。这个仓库的正式发布链路依赖 `/release` 准备 tag，再由 GitHub Actions 根据 `v*` tag 发布并创建 GitHub Release。',
    );
  }

  if (RELEASE_AUTO_PATTERN.test(commandText)) {
    // 自动化 dry-run 不会改仓库状态，这里显式放行，避免影响只读预演体验。
    if (isReleaseAutoDryRun(commandText)) {
      return null;
    }

    return createDecision(
      'ask',
      'This command runs the automated release workflow.',
      buildReleaseAutoMessage(commandText),
    );
  }

  if (MUTATING_RELEASE_PATTERN.test(commandText)) {
    return createDecision(
      'ask',
      'This command changes local or remote release state.',
      buildMutatingReleaseMessage(commandText),
    );
  }

  return null;
}

// CLI hook 入口：读取 JSON、执行守卫判断，并把结果回写给宿主。
async function main() {
  const rawInput = await readStdin();
  if (!rawInput.trim()) return;

  let payload;
  try {
    payload = JSON.parse(rawInput);
  } catch {
    return;
  }

  const decision = evaluateReleaseGuard(payload);
  if (decision) {
    console.log(JSON.stringify(decision));
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
