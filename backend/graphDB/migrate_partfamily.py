"""One-time, idempotent migration: conceptual Part -> PartFamily.
Run from project root: python -m backend.graphDB.migrate_partfamily
"""
import os
from neo4j import GraphDatabase

IDS = ['PISTON', 'PISTON_ROD', 'CROSSHEAD', 'CONNECTING_ROD', 'CRANKSHAFT']

def main():
    uri = os.getenv('NEO4J_URI', 'bolt://localhost:7687')
    user = os.getenv('NEO4J_USER', 'neo4j')
    password = os.getenv('NEO4J_PASSWORD')
    if not password:
        raise RuntimeError('NEO4J_PASSWORD 환경변수를 설정하세요.')
    with GraphDatabase.driver(uri, auth=(user, password)) as driver:
        driver.verify_connectivity()
        with driver.session() as session:
            session.run('CREATE CONSTRAINT partfamily_id_unique IF NOT EXISTS FOR (f:PartFamily) REQUIRE f.part_id IS UNIQUE').consume()
            result = session.run('''
                MATCH (p:Part)
                WHERE p.part_id IN $ids
                SET p:PartFamily
                REMOVE p:Part
                RETURN collect(p.part_id) AS ids
            ''', ids=IDS).single()
            print('PartFamily로 전환:', result['ids'])
            print('기존 관계는 그대로 유지됩니다.')

if __name__ == '__main__':
    main()