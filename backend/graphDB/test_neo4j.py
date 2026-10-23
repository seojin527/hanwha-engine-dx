
import os
from neo4j import GraphDatabase

URI = "bolt://localhost:7687"
USER = "neo4j"
PASSWORD = os.environ["NEO4J_PASSWORD"]

with GraphDatabase.driver(
    URI,
    auth=(USER, PASSWORD)
) as driver:
    driver.verify_connectivity()

    records, summary, keys = driver.execute_query(
        """
        MATCH (e:ErrorCase)-[:HAS_TYPE]->(t:ErrorType)
        RETURN
            e.case_id AS case_id,
            e.case_title AS title,
            t.name AS error_type
        LIMIT 10
        """,
        database_="neo4j"
    )

    for record in records:
        print(
            record["case_id"],
            record["title"],
            record["error_type"]
        )
