import type { PrepareReleaseOptions, PrepareReleaseResult } from './prepare-release.mjs';
import type { ReleaseDryRunOptions, ReleaseDryRunPreview } from './release-dry-run.mjs';

/** `release:auto` 的命令行参数解析结果。 */
export interface ReleaseAutomationArgs {
  versionInput: string;
  dryRun: boolean;
  push: boolean;
  yes: boolean;
}

/** 自动化流程中使用的最小日志接口。 */
export interface ReleaseAutomationLogger {
  log: (...args: unknown[]) => void;
  error?: (...args: unknown[]) => void;
}

/** 二次确认阶段可见的上下文。 */
export interface ReleaseAutomationConfirmContext {
  push: boolean;
}

/** 自动化流程可注入的依赖，便于测试替身替换真实命令执行。 */
export interface ReleaseAutomationOptions {
  dryRun?: boolean;
  push?: boolean;
  yes?: boolean;
  logger?: ReleaseAutomationLogger;
  previewFn?: (
    versionInput: string,
    options?: ReleaseDryRunOptions,
  ) => Promise<ReleaseDryRunPreview>;
  formatPreviewFn?: (preview: ReleaseDryRunPreview) => string;
  confirmFn?: (
    preview: ReleaseDryRunPreview,
    context: ReleaseAutomationConfirmContext,
  ) => boolean | Promise<boolean>;
  runCommand?: (command: string, args: string[], options?: Record<string, unknown>) => string;
  prepareFn?: (
    versionInput: string,
    options?: PrepareReleaseOptions,
  ) => Promise<PrepareReleaseResult>;
  verifyFn?: (packageJsonPath?: string, changelogPath?: string) => Promise<string>;
  packageJsonPath?: string;
  changelogPath?: string;
}

export interface ReleaseAutomationDryRunResult {
  status: 'dry-run';
  preview: ReleaseDryRunPreview;
}

export interface ReleaseAutomationCancelledResult {
  status: 'cancelled';
  preview: ReleaseDryRunPreview;
}

export interface ReleaseAutomationPreparedResult {
  status: 'prepared';
  preview: ReleaseDryRunPreview;
  prepared: PrepareReleaseResult;
  verifiedVersion: string;
}

export interface ReleaseAutomationPushedResult {
  status: 'pushed';
  preview: ReleaseDryRunPreview;
  prepared: PrepareReleaseResult;
  verifiedVersion: string;
}

/** 自动化发布脚本的所有可能结果。 */
export type ReleaseAutomationResult =
  | ReleaseAutomationDryRunResult
  | ReleaseAutomationCancelledResult
  | ReleaseAutomationPreparedResult
  | ReleaseAutomationPushedResult;

/** 解析 `release:auto` 命令行参数。 */
export declare function parseReleaseAutomationArgs(argv: string[]): ReleaseAutomationArgs;

/** 运行自动化发布流程。 */
export declare function runReleaseAutomation(
  versionInput: string,
  options?: ReleaseAutomationOptions,
): Promise<ReleaseAutomationResult>;
