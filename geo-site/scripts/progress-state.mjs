export function describeGitSync(ahead, behind, comparisonTarget) {
  if (ahead === 0 && behind === 0) return `已同步：本地 HEAD 与${comparisonTarget} 一致`;
  if (ahead > 0 && behind === 0) return `未推送：本地有 ${ahead} 个提交尚未进入 ${comparisonTarget}`;
  if (ahead === 0 && behind > 0) return `本地落后：${comparisonTarget} 有 ${behind} 个新提交`;
  return `已分叉：本地独有 ${ahead} 个提交，${comparisonTarget} 独有 ${behind} 个提交`;
}
