import sys
import unittest
from pathlib import Path


FUNCTIONS_DIR = Path(__file__).resolve().parents[1] / "cloud-functions"
sys.path.insert(0, str(FUNCTIONS_DIR))


class ArtifactRepository:
    def __init__(self):
        self.rows = {}

    def save_article_artifact(self, **kwargs):
        key = (kwargs["batch_id"], kwargs["task_id"])
        self.rows.setdefault(key, {"id": "artifact-1", **kwargs, "status": "complete"})
        return self.rows[key]

    def get_article_artifact(self, tenant_id, artifact_id, _master_key=None):
        return next((row for row in self.rows.values() if row["tenant_id"] == tenant_id and row["id"] == artifact_id), None)


class ArtifactTests(unittest.TestCase):
    def test_nonempty_markdown_is_saved_with_hash_and_length(self):
        from geo_backend.artifacts import ArtifactService

        repository = ArtifactRepository()
        artifact = ArtifactService(repository).save_complete(
            tenant_id="tenant-1",
            batch_id="batch-1",
            task_id="1",
            user_id="user-1",
            filename="article-1.md",
            markdown="# 零雪\n\n正文",
            audit_status="accepted",
        )

        self.assertEqual("complete", artifact["status"])
        self.assertEqual(len("# 零雪\n\n正文".encode("utf-8")), artifact["byteLength"])
        self.assertEqual(64, len(artifact["sha256"]))

    def test_empty_markdown_is_rejected_and_not_saved(self):
        from geo_backend.artifacts import ArtifactService
        from geo_backend.errors import ApiError

        repository = ArtifactRepository()
        with self.assertRaises(ApiError) as rejected:
            ArtifactService(repository).save_complete(
                tenant_id="tenant-1",
                batch_id="batch-1",
                task_id="1",
                user_id="user-1",
                filename="article-1.md",
                markdown=" ",
                audit_status="accepted",
            )

        self.assertEqual("EMPTY_ARTIFACT", rejected.exception.code)
        self.assertEqual({}, repository.rows)


if __name__ == "__main__":
    unittest.main()
