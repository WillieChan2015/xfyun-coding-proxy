/** 本地 release 准备脚本的可选路径参数。 */
export interface PrepareReleaseOptions {
  packageJsonPath?: string;
  changelogPath?: string;
}

/** 本地 release 准备成功后的版本与 tag 信息。 */
export interface PrepareReleaseResult {
  version: string;
  tagName: string;
}

/** 发版后重建的 Unreleased 模板常量。 */
export declare const UNRELEASED_TEMPLATE: string;

/** 按目标版本生成新的 changelog 文本。 */
export declare function prepareChangelogForRelease(
  changelog: string,
  version: string,
  releaseDate?: string,
): string;

/** 执行本地 release 准备：升级版本、同步 changelog、创建 commit 与 tag。 */
export declare function prepareRelease(
  versionInput: string,
  options?: PrepareReleaseOptions,
): Promise<PrepareReleaseResult>;
