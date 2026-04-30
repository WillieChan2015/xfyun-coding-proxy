/** 从完整 changelog 文本中提取指定 tag 对应的发布说明。 */
export declare function extractReleaseNotes(changelog: string, tagName: string): string;

/** 读取 changelog 并把指定 tag 的发布说明写入目标文件。 */
export declare function writeReleaseNotesFile(
  tagName: string,
  changelogPath: string,
  outputPath: string,
): Promise<void>;
