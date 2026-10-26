
import os
from neo4j import GraphDatabase

URI = os.getenv("NEO4J_URI", "bolt://localhost:7687")
USER = os.getenv("NEO4J_USER", "neo4j")
PASSWORD = os.environ["NEO4J_PASSWORD"]

QUERY = """
MATCH (cr:PartFamily {part_id: 'CONNECTING_ROD'})
MATCH (cs:PartFamily {part_id: 'CRANKSHAFT'})

MERGE (i:Interface {
    interface_id: 'IF-CONROD-CRANK-001'
})
SET i.name = 'Connecting Rod - Crankshaft Interface',
    i.description = '크랭크핀 측 결합부 (개념 모델)',
    i.status = 'provisional',
    i.source = 'project_assumption'

MERGE (cr)-[:PARTICIPATES_IN]->(i)
MERGE (cs)-[:PARTICIPATES_IN]->(i)

RETURN i.interface_id AS interface_id,
       i.name AS name
"""

def main():
    with GraphDatabase.driver(
        URI,
        auth=(USER, PASSWORD)
    ) as driver:
        driver.verify_connectivity()

        records, _, _ = driver.execute_query(
            QUERY,
            database_="neo4j"
        )

        if not records:
            raise RuntimeError(
                "Connecting Rod 또는 Crankshaft 노드를 찾지 못했습니다."
            )

        print("Interface 생성 완료")
        print(dict(records[0]))

if __name__ == "__main__":
    main()
