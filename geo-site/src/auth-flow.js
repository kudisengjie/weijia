// This marker permits a reload check only. The server cookie remains the sole credential.
export const AUTH_TAB_MARKER = 'lxue.geo.authenticated-tab';
export function shouldRestoreSession({navigationType,tabAuthenticated,hash=''}) {
  return navigationType === 'reload' && tabAuthenticated === true && hash !== '#login';
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
