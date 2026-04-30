/** 发布守卫支持的拦截决策。 */
export type ReleaseGuardPermissionDecision = 'deny' | 'ask';

/** Hook 返回给宿主的守卫决策结构。 */
export interface ReleaseGuardDecision {
  hookSpecificOutput: {
    hookEventName: 'PreToolUse';
    permissionDecision: ReleaseGuardPermissionDecision;
    permissionDecisionReason: string;
  };
  systemMessage: string;
}

/** 从 hook payload 中提取实际要执行的命令文本。 */
export declare function getCommandText(payload: unknown): string | undefined;

/** 对发布相关命令执行预检守卫。 */
export declare function evaluateReleaseGuard(payload: unknown): ReleaseGuardDecision | null;
