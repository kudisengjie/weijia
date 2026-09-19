// This marker permits a reload/return check only. The server cookie remains the sole credential.
export const AUTH_TAB_MARKER = 'lxue.geo.authenticated-tab';
// 吕老师 2026-09-19：从官网等页面返回（back_forward / 同标签页再次进入）时也要尝试
// 静默恢复会话——原来只在 reload 时恢复，导致返回工作台就被强制登出、运行中的任务全部中断。
export function shouldRestoreSession({navigationType,tabAuthenticated,hash=''}) {
  if (tabAuthenticated !== true || hash === '#login') return false;
  return navigationType === 'reload' || navigationType === 'back_forward' || navigationType === 'navigate';
}
// 服务端派生的非秘密本地命名标识：只用于 IndexedDB 键隔离，不是授权凭证。
export function accountScopeFrom(data) {
  if (!data || data.authenticated !== true) return null;
  const scope = data.accountScope;
  return typeof scope === 'string' && /^[0-9a-f]{32}$/.test(scope) ? scope : null;
}
export function createAuthFlow() {
  let epoch=0;
  return {
    get epoch(){return epoch;},
    begin(){return ++epoch;},
    invalidate(){++epoch;},
    isCurrent(operation){return operation===epoch;},
    accept(operation,data){
      return operation===epoch && data?.authenticated===true
        && typeof data.csrf==='string' && data.csrf.length>0
        && Number.isFinite(data.expiresAt) && data.expiresAt>Date.now();
    },
  };
}
