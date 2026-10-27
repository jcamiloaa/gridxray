import os

# Must be set before gridxray modules read settings.
os.environ["DATABASE_URL"] = "sqlite+pysqlite:///:memory:"
os.environ["SECRET_KEY"] = "test-secret-key-at-least-32-bytes-long"
