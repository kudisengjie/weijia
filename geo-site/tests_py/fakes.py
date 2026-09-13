from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, timezone
import copy


class FakeRepository:
    def __init__(self):
        self.users = {}
        self.failures = {}
        self.sessions = {}
        self.revoked = set()
        self.model_rows = {}
        self.ima = None
        self.admin_attempts = 0
        self.batches = {}
        self.batch_claims = set()
        self.batch_recoveries = set()

    def health(self):
        return {"database": "available", "schemaVersion": 1, "ready": True}

    def login_blocked(self, scope_hash, now):
        state = self.failures.get(scope_hash)
        return bool(state and state[0] >= 5 and (now - state[1]).total_seconds() < 900)

    def record_login_failure(self, scope_hash, now):
        count, started = self.failures.get(scope_hash, (0, now))
        if (now - started).total_seconds() >= 900:
            count, started = 0, now
        self.failures[scope_hash] = (count + 1, started)

    def clear_login_failures(self, scope_hash):
        self.failures.pop(scope_hash, None)

    def upsert_configured_user(self, username, password_hash):
        self.users.setdefault(username, {"id": "user-1", "username": username})
        self.users[username]["password_hash"] = password_hash
        return self.users[username]

    def create_session(self, user_id, stored):
        self.sessions[stored["token_hash"]] = {"user_id": user_id, **stored, "revoked_at": None}

    def get_session(self, token_hash):
        value = self.sessions.get(token_hash)
        if not value or value["revoked_at"] or value["expires_at"] <= datetime.now(timezone.utc):
            return None
        return value

    def revoke_session(self, token_hash):
        if token_hash in self.sessions:
            self.sessions[token_hash]["revoked_at"] = datetime.now(timezone.utc)
            self.revoked.add(token_hash)

    def load_model_settings(self, user_id, _master_key):
        return [dict(value) for (owner, _provider), value in self.model_rows.items() if owner == user_id]

    def save_model(self, user_id, model, api_key, remove_key, _master_key):
        for (owner, _provider), row in self.model_rows.items():
            if owner == user_id:
                row["selected"] = False
        key = (user_id, model["id"])
        previous = self.model_rows.get(key, {})
        stored_key = None if remove_key else api_key or previous.get("api_key")
        self.model_rows[key] = {
            "provider": model["id"],
            "slot": model["slot"],
            "model_id": model["modelId"],
            "api_key": stored_key,
            "selected": True,
        }

    def load_ima(self, _master_key):
        return dict(self.ima) if self.ima else None

    def save_ima(self, value, _master_key):
        self.ima = dict(value)

    def take_admin_attempt(self, _scope_hash, _now, limit=5):
        if self.admin_attempts >= limit:
            return False
        self.admin_attempts += 1
        return True

    def create_or_get_batch(self, user_id, batch_id, request_id_hash, state):
        existing = self.batches.get(batch_id)
        if existing:
            return copy.deepcopy(existing["state"])
        self.batches[batch_id] = {
            "user_id": user_id,
            "request_id_hash": request_id_hash,
            "state": copy.deepcopy(state),
        }
        return copy.deepcopy(state)

    def get_batch(self, user_id, batch_id):
        value = self.batches.get(batch_id)
        if not value or value["user_id"] != user_id:
            return None
        return copy.deepcopy(value["state"])

    def list_batches(self, user_id):
        return [copy.deepcopy(value["state"]) for value in self.batches.values() if value["user_id"] == user_id]

    def claim_step(self, batch_id, seq):
        key = (batch_id, seq)
        if key in self.batch_claims:
            return False
        self.batch_claims.add(key)
        return True

    def claim_is_stale(self, batch_id, seq, _now):
        return (batch_id, seq) in self.batch_claims and False

    def recover_step(self, batch_id, seq, _now, allow_failed=False):
        key = (batch_id, seq)
        if key in self.batch_recoveries:
            return False
        if not allow_failed and not self.claim_is_stale(batch_id, seq, _now):
            return False
        self.batch_recoveries.add(key)
        self.batch_claims.add(key)
        return True

    def save_batch(self, user_id, batch_id, state, expected_seq):
        value = self.batches.get(batch_id)
        if not value or value["user_id"] != user_id or value["state"]["seq"] != expected_seq:
            return False
        value["state"] = copy.deepcopy(state)
        return True


def repository_factory(repository):
    @contextmanager
    def factory():
        yield repository

    return factory
