
import os
from neo4j import GraphDatabase

URI = os.getenv("NEO4J_URI", "bolt://localhost:7687")
USER = os.getenv("NEO4J_USER", "neo4j")
PASSWORD = os.environ["NEO4J_PASSWORD"]


def get_interface(interface_id):
    query = """
    MATCH (p:Part)-[:PARTICIPATES_IN]->(i:Interface {
        interface_id: $interface_id
    })

    OPTIONAL MATCH (i)-[:INVOLVES_FEATURE]->(f:Feature)
    OPTIONAL MATCH (f)-[:HAS_SPEC]->(s:MeasurementSpec)

    RETURN
        i.interface_id AS interface_id,
        i.name AS interface_name,
        i.status AS status,
        collect(DISTINCT {
            part_id: p.part_id,
            part_name: p.name
        }) AS parts,
        collect(DISTINCT {
            feature_id: f.feature_id,
            feature_name: f.name,
            spec_id: s.spec_id,
            nominal: s.nominal,
            tolerance: s.tolerance
        }) AS measurements
    """

    with GraphDatabase.driver(
        URI,
        auth=(USER, PASSWORD)
    ) as driver:
        records, _, _ = driver.execute_query(
            query,
            interface_id=interface_id,
            database_="neo4j"
        )

        if not records:
            return None

        result = dict(records[0])

        # 아직 Feature가 없으면 빈 목록으로 반환
        result["measurements"] = [
            m for m in result["measurements"]
            if m["feature_id"] is not None
        ]

        return result


if __name__ == "__main__":
    from pprint import pprint

    result = get_interface("IF-CONROD-CRANK-001")
    pprint(result, sort_dicts=False)
