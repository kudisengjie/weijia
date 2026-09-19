"""Account-scoped encrypted workspace storage. Mutations require the account lock."""
import json

from .errors import ApiError


class WorkspaceRepositoryMixin:
    def count_open_workspaces(self, user_id):
        # 名额只按“同时进行的任务”计：未结束批次占用名额，草稿不占。
        return self.conn.execute("""
            SELECT COUNT(*) FROM batches WHERE user_id = %s AND status NOT IN ('completed', 'cancelled')
        """, (user_id,)).fetchone()[0]

    @staticmethod
    def _workspace_payload(user_id, tenant_id, workspace_id, draft):
        return json.dumps({'userId': user_id, 'tenantId': tenant_id, 'workspaceId': workspace_id, 'draft': draft}, ensure_ascii=False)

    def insert_workspace(self, user_id, tenant_id, workspace_id, request_hash, draft):
        self.conn.execute("""
            INSERT INTO workspaces(id, user_id, tenant_id, request_hash, status, state_cipher)
            VALUES (%s, %s, %s, %s, 'draft', pgp_sym_encrypt(%s, %s, 'cipher-algo=aes256'))
        """, (workspace_id, user_id, tenant_id, request_hash,
              self._workspace_payload(user_id, tenant_id, workspace_id, draft), self.master_key))

    def workspace_request_id(self, user_id, tenant_id, request_hash):
        row = self.conn.execute('SELECT id FROM workspaces WHERE user_id = %s AND tenant_id = %s AND request_hash = %s',
                                (user_id, tenant_id, request_hash)).fetchone()
        return row[0] if row else None

    def get_workspace(self, user_id, tenant_id, workspace_id):
        row = self.conn.execute("""
            SELECT id, status, version, batch_id, created_at, updated_at,
                   pgp_sym_decrypt(state_cipher, %s)::jsonb
            FROM workspaces WHERE user_id = %s AND tenant_id = %s AND id = %s
        """, (self.master_key, user_id, tenant_id, workspace_id)).fetchone()
        if row is None:
            return None
        payload = row[6]
        if (not isinstance(payload, dict) or payload.get('userId') != user_id
                or payload.get('tenantId') != tenant_id or payload.get('workspaceId') != workspace_id
                or not isinstance(payload.get('draft'), dict)):
            raise ApiError(503, '工作区加密记录校验失败，请联系管理员。', 'WORKSPACE_STATE_INVALID')
        return {'id': row[0], 'status': row[1], 'version': row[2], 'batchId': row[3],
                'createdAt': row[4].isoformat(), 'updatedAt': row[5].isoformat(), 'draft': payload['draft']}

    def list_workspace_ids(self, user_id, tenant_id):
        return [row[0] for row in self.conn.execute("""
            SELECT w.id FROM workspaces w LEFT JOIN batches b ON b.id = w.batch_id
            WHERE w.user_id = %s AND w.tenant_id = %s AND w.status <> 'archived'
            ORDER BY (w.status = 'draft' OR b.status NOT IN ('completed', 'cancelled')) DESC, w.updated_at DESC LIMIT 500
        """, (user_id, tenant_id)).fetchall()]

    def update_workspace(self, user_id, tenant_id, workspace_id, version, *, draft=None, status=None, batch_id=None, from_status='draft', clear_batch=False):
        if draft is not None:
            result = self.conn.execute("""
                UPDATE workspaces SET state_cipher = pgp_sym_encrypt(%s, %s, 'cipher-algo=aes256'),
                    version = version + 1, updated_at = NOW()
                WHERE id = %s AND user_id = %s AND tenant_id = %s AND version = %s AND status = 'draft'
            """, (self._workspace_payload(user_id, tenant_id, workspace_id, draft), self.master_key,
                  workspace_id, user_id, tenant_id, version))
        else:
            # from_status='draft' 保持旧语义；archive 等需要跨状态更新的调用传 None。
            # batch_id 仅在显式传入时更新；clear_batch=True 用于归档时解除批次绑定
            # （workspaces_check 要求 status='started' ⇔ batch_id 非空）。
            state_clause = " AND status = 'draft'" if from_status == 'draft' else ''
            batch_clause = ', batch_id = NULL' if clear_batch else (', batch_id = %s' if batch_id is not None else '')
            params = [status] + ([batch_id] if batch_id is not None and not clear_batch else []) + [workspace_id, user_id, tenant_id, version]
            result = self.conn.execute(f"""
                UPDATE workspaces SET status = %s{batch_clause}, version = version + 1, updated_at = NOW()
                WHERE id = %s AND user_id = %s AND tenant_id = %s AND version = %s{state_clause}
            """, params)
        if result.rowcount != 1:
            raise ApiError(409, '工作区已被另一页面更新，请重新读取后操作。', 'WORKSPACE_VERSION_CONFLICT')
        if result.rowcount != 1:
            raise ApiError(409, '工作区已被另一页面更新，请重新读取后操作。', 'WORKSPACE_VERSION_CONFLICT')
