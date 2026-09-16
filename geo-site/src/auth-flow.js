// This marker permits a reload check only. The server cookie remains the sole credential.
export const AUTH_TAB_MARKER = 'lxue.geo.authenticated-tab';
export function shouldRestoreSession({navigationType,tabAuthenticated,hash=''}) {
  return navigationType === 'reload' && tabAuthenticated === true && hash !== '#login';
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
