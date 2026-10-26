"""STEP AP214 assembly occurrence importer; does not infer mating/contact."""
import os
import re
from collections import Counter
from pathlib import Path
from neo4j import GraphDatabase

OCCURRENCE = re.compile(r"NEXT_ASSEMBLY_USAGE_OCCURRENCE\s*\(\s*'((?:[^']|'')+)'", re.I)


def extract_occurrences(step_path):
    content = Path(step_path).read_text(encoding='latin-1')
    names = OCCURRENCE.findall(content)
    if not names:
        raise ValueError('STEP assembly occurrences not found; check STEP schema/export')
    records = []
    for name in names:
        if ':' not in name:
            raise ValueError(f'Unexpected STEP occurrence name: {name}')
        part_code, index = name.rsplit(':', 1)
        if not index.isdigit():
            raise ValueError(f'Unexpected STEP instance index: {name}')
        records.append({'instance_id': name, 'cad_part_code': part_code, 'instance_index': int(index)})
    if len({r['instance_id'] for r in records}) != len(records):
        raise ValueError('Duplicate occurrence identifiers in STEP')
    return records


def import_step(step_path, uri=None, user=None, password=None):
    records = extract_occurrences(step_path)
    uri = uri or os.getenv('NEO4J_URI', 'bolt://localhost:7687')
    user = user or os.getenv('NEO4J_USER', 'neo4j')
    password = password or os.environ['NEO4J_PASSWORD']
    assembly_id = Path(step_path).stem
    with GraphDatabase.driver(uri, auth=(user, password)) as driver:
        driver.verify_connectivity()
        with driver.session() as session:
            session.run('CREATE CONSTRAINT assembly_instance_id IF NOT EXISTS FOR (i:PartInstance) REQUIRE i.instance_id IS UNIQUE').consume()
            session.run('CREATE CONSTRAINT cad_part_code IF NOT EXISTS FOR (p:CADPart) REQUIRE p.cad_part_code IS UNIQUE').consume()
            session.run('CREATE CONSTRAINT assembly_step_id IF NOT EXISTS FOR (a:STEPAssembly) REQUIRE a.assembly_id IS UNIQUE').consume()
            session.run('''MERGE (a:STEPAssembly {assembly_id:$id}) SET a.source_step=$source''', id=assembly_id, source=Path(step_path).name).consume()
            # Scope deletions to this STEP-derived assembly's old occurrence edges only.
            session.run('''MATCH (a:STEPAssembly {assembly_id:$id})-[r:HAS_INSTANCE]->(:PartInstance) DELETE r''', id=assembly_id).consume()
            session.run('''UNWIND $records AS rec
                MERGE (p:CADPart {cad_part_code:rec.cad_part_code})
                MERGE (i:PartInstance {instance_id:rec.instance_id})
                SET i.cad_part_code=rec.cad_part_code, i.instance_index=rec.instance_index, i.source_assembly=$id
                WITH p,i
                MATCH (a:STEPAssembly {assembly_id:$id})
                MERGE (a)-[:HAS_INSTANCE]->(i)
                MERGE (i)-[:INSTANCE_OF]->(p)''', records=records, id=assembly_id).consume()
    return {'assembly_id': assembly_id, 'instances': len(records), 'by_cad_part': dict(Counter(r['cad_part_code'] for r in records))}


if __name__ == '__main__':
    import argparse, json
    parser = argparse.ArgumentParser()
    parser.add_argument('step_path')
    args = parser.parse_args()
    print(json.dumps(import_step(args.step_path), ensure_ascii=False, indent=2))
