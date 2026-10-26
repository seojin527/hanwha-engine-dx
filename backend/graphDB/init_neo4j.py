
import os
from pathlib import Path
from neo4j import GraphDatabase

BASE_DIR = Path(__file__).resolve().parents[2]
SCHEMA_FILE = BASE_DIR / "neo4j" / "schema.cypher"

URI = os.getenv("NEO4J_URI", "bolt://localhost:7687")
USER = os.getenv("NEO4J_USER", "neo4j")
PASSWORD = os.environ["NEO4J_PASSWORD"]

def main():
    statements = [
        statement.strip()
        for statement in SCHEMA_FILE.read_text(
            encoding="utf-8"
        ).split(";")
        if statement.strip()
    ]

    with GraphDatabase.driver(
        URI,
        auth=(USER, PASSWORD)
    ) as driver:
        driver.verify_connectivity()

        with driver.session(database="neo4j") as session:
            for statement in statements:
                session.run(statement).consume()

    print(f"Neo4j 스키마 적용 완료: {len(statements)}개 명령")

if __name__ == "__main__":
    main()
