"""Read-only assembly composition endpoints backed by Neo4j."""
import os
from fastapi import APIRouter, HTTPException
from neo4j import GraphDatabase

router = APIRouter(prefix='/api/assembly', tags=['조립관계'])


def get_driver():
    password = os.getenv('NEO4J_PASSWORD')
    if not password:
        raise HTTPException(status_code=503, detail='NEO4J_PASSWORD is not configured')
    return GraphDatabase.driver(os.getenv('NEO4J_URI', 'bolt://localhost:7687'), auth=(os.getenv('NEO4J_USER', 'neo4j'), password))


@router.get('/{assembly_id}/parts')
def list_parts(assembly_id: str):
    query = '''MATCH (a:STEPAssembly {assembly_id:$assembly_id})-[:HAS_INSTANCE]->(i:PartInstance)-[:INSTANCE_OF]->(p:CADPart)
               RETURN p.cad_part_code AS cad_part_code, count(i) AS quantity
               ORDER BY cad_part_code'''
    try:
        with get_driver() as driver:
            with driver.session() as session:
                rows = [dict(r) for r in session.run(query, assembly_id=assembly_id)]
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f'Neo4j connection/query failed: {type(exc).__name__}') from exc
    if not rows:
        raise HTTPException(status_code=404, detail='Assembly not found or has no imported instances')
    return {'assembly_id': assembly_id, 'parts': rows}


@router.get('/{assembly_id}/parts/{cad_part_code}/connections')
def part_connections(assembly_id: str, cad_part_code: str):
    """Only confirmed STEP co-membership, not direct mating/contact."""
    query = '''MATCH (a:STEPAssembly {assembly_id:$assembly_id})-[:HAS_INSTANCE]->(i:PartInstance)-[:INSTANCE_OF]->(p:CADPart {cad_part_code:$code})
               WITH a, p, count(i) AS quantity
               MATCH (a)-[:HAS_INSTANCE]->(other:PartInstance)-[:INSTANCE_OF]->(q:CADPart)
               WHERE q <> p
               RETURN quantity, q.cad_part_code AS cad_part_code, count(other) AS other_quantity
               ORDER BY cad_part_code'''
    try:
        with get_driver() as driver:
            with driver.session() as session:
                rows = [dict(r) for r in session.run(query, assembly_id=assembly_id, code=cad_part_code)]
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f'Neo4j connection/query failed: {type(exc).__name__}') from exc
    if not rows:
        raise HTTPException(status_code=404, detail='Part not found in assembly (or no other parts)')
    return {'assembly_id': assembly_id, 'cad_part_code': cad_part_code, 'quantity': rows[0]['quantity'], 'relation': 'SAME_ASSEMBLY', 'direct_mating_verified': False, 'related_parts': [{'cad_part_code':r['cad_part_code'], 'quantity':r['other_quantity']} for r in rows]}
