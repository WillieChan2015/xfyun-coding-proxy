/** dry-run 预演时可覆盖的输入路径与日期。 */
export interface ReleaseDryRunOptions {
  packageJsonPath?: string;
  changelogPath?: string;
  releaseDate?: string;
}

/** 预演结果中的 changelog 迁移说明。 */
export interface ReleaseDryRunChangelogPlan {
  source: string;
  existingTargetHeading: boolean;
  releaseHeading: string;
  releaseSectionPreview: string;
  unreleasedTemplate: string;
  unreleasedSectionPreview: string;
}

/** 完整的 release dry-run 结构化结果。 */
export interface ReleaseDryRunPreview {
  requestedInput: string;
  currentVersion: string;
  targetVersion: string;
  targetTag: string;
  isPrerelease: boolean;
  releaseCommitMessage: string;
  releaseNotes: string;
  blockers: string[];
  nextStep: string;
  changelogPlan: ReleaseDryRunChangelogPlan;
}

/** 解析显式版本或 npm bump 关键字，得到最终目标版本。 */
export declare function resolveTargetVersion(
  currentVersion: string,
  versionInput: string,
): Promise<string>;

/** 生成只读的 release 预演结果。 */
export declare function previewReleaseDryRun(
  versionInput: string,
  options?: ReleaseDryRunOptions,
): Promise<ReleaseDryRunPreview>;

/** 把结构化 dry-run 结果格式化为 CLI 可读文本。 */
export declare function formatReleaseDryRunPreview(preview: ReleaseDryRunPreview): string;
