/** 校验当前 package.json.version 是否在 CHANGELOG.md 中存在对应章节。 */
export declare function verifyChangelogVersion(
  packageJsonPath?: string,
  changelogPath?: string,
): Promise<string>;
