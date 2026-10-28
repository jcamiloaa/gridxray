import os
import tempfile

# Must be set before gridxray modules read settings. A file database (not :memory:) so the
# background investigation threads get their own SQLite connections.
os.environ["DATABASE_URL"] = f"sqlite+pysqlite:///{tempfile.mkdtemp(prefix='gridxray-test-')}/test.db"
os.environ["SECRET_KEY"] = "test-secret-key-at-least-32-bytes-long"
