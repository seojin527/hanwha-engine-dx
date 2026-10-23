
import os
from neo4j import GraphDatabase

URI = os.getenv("NEO4J_URI", "bolt://localhost:7687")
USER = os.getenv("NEO4J_USER", "neo4j")
PASSWORD = os.environ["NEO4J_PASSWORD"]

QUERY = """
MERGE (a:Assembly {assembly_id: 'ASM-001'})
SET a.name = 'Crosshead Engine Assembly',
    a.status = 'provisional'

WITH a
UNWIND [
    {id: 'PISTON', name: 'Piston'},
    {id: 'PISTON_ROD', name: 'Piston Rod'},
    {id: 'CROSSHEAD', name: 'Crosshead'},
    {id: 'CONNECTING_ROD', name: 'Connecting Rod'},
    {id: 'CRANKSHAFT', name: 'Crankshaft'}
] AS item

MERGE (p:Part {part_id: item.id})
SET p.name = item.name,
    p.record_type = 'conceptual',
    p.status = 'provisional'
MERGE (a)-[:CONTAINS]->(p)
"""

REL_QUERY = """
UNWIND [
    ['PISTON', 'PISTON_ROD'],
    ['PISTON_ROD', 'CROSSHEAD'],
    ['CROSSHEAD', 'CONNECTING_ROD'],
    ['CONNECTING_ROD', 'CRANKSHAFT']
] AS pair

MATCH (a:Part {part_id: pair[0]})
MATCH (b:Part {part_id: pair[1]})

MERGE (a)-[r:CONNECTED_TO]->(b)
SET r.status = 'provisional',
    r.source = 'project_assumption'
"""

with GraphDatabase.driver(
    URI,
    auth=(USER, PASSWORD)
) as driver:
    driver.verify_connectivity()

    driver.execute_query(
        QUERY,
        database_="neo4j"
    )
    driver.execute_query(
        REL_QUERY,
        database_="neo4j"
    )

print("엔진 조립 관계 입력 완료")
