import test from 'node:test';
import assert from 'node:assert/strict';

const flow = await import('./auth-flow.js').catch(() => ({}));
test('fresh navigation never restores a session, including a copied tab marker', () => {
  assert.equal(typeof flow.shouldRestoreSession, 'function');
  assert.equal(flow.shouldRestoreSession({navigationType:'navigate',tabAuthenticated:true}), false);
  assert.equal(flow.shouldRestoreSession({navigationType:'back_forward',tabAuthenticated:true}), false);
  assert.equal(flow.shouldRestoreSession({navigationType:'reload',tabAuthenticated:false}), false);
  assert.equal(flow.shouldRestoreSession({navigationType:'reload',tabAuthenticated:true,hash:'#login'}), false);
  assert.equal(flow.shouldRestoreSession({navigationType:'reload',tabAuthenticated:true}), true);
});
test('only the current authentication operation may admit a session', () => {
  assert.equal(typeof flow.createAuthFlow, 'function');
  const auth=flow.createAuthFlow(), old=auth.begin(), latest=auth.begin();
  const data={authenticated:true,csrf:'test-csrf',expiresAt:Date.now()+10000};
  assert.equal(auth.accept(old,data), false);
  assert.equal(auth.accept(latest,data), true);
  auth.invalidate();
  assert.equal(auth.isCurrent(latest), false);
  assert.equal(auth.accept(latest,data), false);
});
test('successful HTTP without a complete authenticated session is rejected', () => {
  assert.equal(typeof flow.createAuthFlow, 'function');
  const auth=flow.createAuthFlow(), current=auth.begin();
  for(const data of [{},null,{authenticated:false,csrf:'x',expiresAt:Date.now()+10000},
    {authenticated:true,csrf:'',expiresAt:Date.now()+10000},
    {authenticated:true,csrf:'x',expiresAt:0}]) assert.equal(auth.accept(current,data),false);
});
test('account scope is accepted only in valid lowercase opaque hex for an authenticated response', () => {
  assert.equal(typeof flow.accountScopeFrom, 'function');
  const good='a1b2c3d4e5f60718293a4b5c6d7e8f90';
  assert.equal(flow.accountScopeFrom({authenticated:true,csrf:'x',expiresAt:Date.now()+10000,accountScope:good}),good);
  for(const bad of [null,undefined,{authenticated:true},'','A'.repeat(32),'a'.repeat(31),'a'.repeat(33),
    'g'.repeat(32),'  '+good,'../etc','a'.repeat(32)+'<script>'])
    assert.equal(flow.accountScopeFrom({authenticated:true,csrf:'x',expiresAt:Date.now()+1000,accountScope:bad}),null,bad);
  // 匿名或未认证响应不提供账号上下文。
  assert.equal(flow.accountScopeFrom({authenticated:false,accountScope:good}),null);
});
