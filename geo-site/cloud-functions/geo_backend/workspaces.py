"""Five durable workspaces per account, with atomic draft-to-batch handoff."""
import hashlib
import json
import re
import uuid

from .errors import ApiError
from .models import SettingsService, model_selection
from .tenant_access import TenantAccessService

WORKSPACE_LIMIT = 5


def validate_draft(draft):
    allowed = {'title', 'taskFileName', 'sheetName', 'rows', 'companies', 'model'}
    if not isinstance(draft, dict) or set(draft) - allowed:
        raise ApiError(400, '工作区草稿格式不正确。', 'INVALID_WORKSPACE_DRAFT')
    result = {}
    for name, limit, default in [('title', 160, '新建任务'), ('taskFileName', 255, ''), ('sheetName', 160, '')]:
        value = draft.get(name, default)
        if not isinstance(value, str) or len(value) > limit or '\x00' in value:
            raise ApiError(400, '工作区名称或文件名称过长/格式不正确。', 'INVALID_WORKSPACE_DRAFT')
        result[name] = value
    rows, companies = draft.get('rows', []), draft.get('companies', [])
    if (not isinstance(rows, list) or len(rows) > 1001 or any(not isinstance(row, list) or len(row) > 100 for row in rows)
            or any(type(cell) not in (str, int, float, bool, type(None)) for row in rows for cell in row)
            or not isinstance(companies, list) or len(companies) > 100):
        raise ApiError(400, '草稿行列数或文档数量超出限制。', 'INVALID_WORKSPACE_DRAFT')
    for company in companies:
        if (not isinstance(company, dict) or set(company) - {'name', 'brand', 'text'}
                or any(not isinstance(company.get(key, ''), str) for key in ('name', 'brand', 'text'))):
            raise ApiError(400, '公司文档格式不正确。', 'INVALID_WORKSPACE_DRAFT')
    model = draft.get('model')
    if (not isinstance(model, dict) or set(model) - {'id', 'slot', 'modelId', 'provider', 'model', 'label'}
            or any(not isinstance(model.get(key, ''), str) for key in ('id', 'slot', 'modelId'))):
        raise ApiError(400, '请选择此工作区使用的模型。', 'INVALID_WORKSPACE_DRAFT')
    result.update(rows=rows, companies=companies, model=model_selection(model.get('id'), model.get('slot'), model.get('modelId', '')))
    try:
        encoded = json.dumps(result, ensure_ascii=False, allow_nan=False)
    except (ValueError, TypeError) as error:
        raise ApiError(400, '草稿包含不支持的值。', 'INVALID_WORKSPACE_DRAFT') from error
    if len(encoded.encode()) > 4 * 1024 * 1024:
        raise ApiError(413, '工作区资料超过 4 MB，请拆分后提交。', 'WORKSPACE_TOO_LARGE')
    return result


class WorkspaceService:
    def __init__(self, repository, master_key, context, batch_service):
        self.repository, self.master_key, self.context, self.batches = repository, master_key, context, batch_service
        self.tenant_id = str(context['tenantId'])

    def _require_active(self, user_id):
        current = TenantAccessService(self.repository).require(user_id)
        if current['tenantId'] != self.context['tenantId']:
            raise ApiError(403, '工作区归属已变化，请重新登录。', 'TENANT_ACCESS_REQUIRED')

    def _get(self, workspace_id, user_id):
        if not re.fullmatch(r'[0-9a-f]{32}', str(workspace_id)):
            raise ApiError(404, '工作区不存在。', 'WORKSPACE_NOT_FOUND')
        result = self.repository.get_workspace(user_id, self.tenant_id, workspace_id)
        if not result:
            raise ApiError(404, '工作区不存在或不属于当前账号。', 'WORKSPACE_NOT_FOUND')
        return result

    @staticmethod
    def _editable(workspace, version):
        if workspace['status'] != 'draft':
            raise ApiError(409, '已启动或归档的工作区不能修改，请新建任务。', 'WORKSPACE_LOCKED')
        if type(version) is not int or workspace['version'] != version:
            raise ApiError(409, '草稿已在另一页面更新，请重新读取后再操作。', 'WORKSPACE_VERSION_CONFLICT')

    def get(self, workspace_id, user_id):
        result = self._get(workspace_id, user_id)
        result['batch'] = self.batches.get(result['batchId'], user_id) if result['batchId'] else None
        return result

    def list(self, user_id):
        workspaces = []
        for workspace_id in self.repository.list_workspace_ids(user_id, self.tenant_id):
            item = self.get(workspace_id, user_id)
            draft = item.pop('draft')
            item.update(title=draft['title'], model=draft['model'])
            if item['batch']:
                item['batch'].pop('articles', None)
            workspaces.append(item)
        return {'workspaces': workspaces, 'occupied': self.repository.count_open_workspaces(user_id), 'limit': WORKSPACE_LIMIT}

    def create(self, request_id, user_id):
        if not isinstance(request_id, str) or not re.fullmatch(r'[A-Za-z0-9-]{16,80}', request_id):
            raise ApiError(400, '缺少有效的工作区提交标识。', 'INVALID_WORKSPACE_REQUEST')
        request_hash = hashlib.sha256(request_id.encode()).hexdigest()
        with self.repository.transaction():
            self.repository.lock_user(user_id)
            self._require_active(user_id)
            existing = self.repository.workspace_request_id(user_id, self.tenant_id, request_hash)
            if existing:
                return self.get(existing, user_id)
            if self.repository.count_open_workspaces(user_id) >= WORKSPACE_LIMIT:
                raise ApiError(409, '最多保留五个未结束工作区，请完成、取消任务或关闭草稿后再新建。', 'WORKSPACE_LIMIT_REACHED')
            workspace_id = uuid.uuid4().hex
            model = SettingsService(self.repository, self.master_key).private(user_id)['model']
            draft = validate_draft({'model': model})
            self.repository.insert_workspace(user_id, self.tenant_id, workspace_id, request_hash, draft)
            return self.get(workspace_id, user_id)

    def save(self, workspace_id, user_id, version, draft):
        draft = validate_draft(draft)
        with self.repository.transaction():
            self.repository.lock_user(user_id)
            self._require_active(user_id)
            workspace = self._get(workspace_id, user_id)
            self._editable(workspace, version)
            self.repository.update_workspace(user_id, self.tenant_id, workspace_id, version, draft=draft)
            return self.get(workspace_id, user_id)

    def start(self, workspace_id, user_id, version, expires_at):
        with self.repository.transaction():
            self.repository.lock_user(user_id)
            workspace = self._get(workspace_id, user_id)
            if workspace['status'] == 'started':
                return self.get(workspace_id, user_id)
            self._require_active(user_id)
            self._editable(workspace, version)
            batch = self.batches.create({}, user_id, expires_at, workspace_id=workspace_id)
            self.repository.update_workspace(user_id, self.tenant_id, workspace_id, version, status='started', batch_id=batch['id'])
            return self.get(workspace_id, user_id)

    def archive(self, workspace_id, user_id, version):
        with self.repository.transaction():
            self.repository.lock_user(user_id)
            workspace = self._get(workspace_id, user_id)
            if workspace['status'] == 'archived':
                return self.get(workspace_id, user_id)
            self._editable(workspace, version)
            self.repository.update_workspace(user_id, self.tenant_id, workspace_id, version, status='archived')
            return self.get(workspace_id, user_id)
