from app.infrastructure.config import settings
from app.infrastructure.db import Database

if __name__ == "__main__":
    Database(settings.database_url).migrate()
    print("Schema revision 5 ready (PostgreSQL + pgvector).")
