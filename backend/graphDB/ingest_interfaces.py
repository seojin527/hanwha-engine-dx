"""Import HDH assembly interfaces into existing Neo4j. No SQLite mutations.

Run from C:\\hanwha-engine-dx\\backend::
  python -m graphDB.ingest_interfaces --interfaces "C:\\...\\interfaces_v4.csv" --occurrences "C:\\...\\interface_occurrences_v4.csv"
  python -m graphDB.ingest_interfaces --interfaces "C:\\...\\interfaces_v4.csv" --occurrences "C:\\...\\interface_occurrences_v4.csv" --apply

The default is validation-only; --apply writes to Neo4j. The first real write
should be to a backup/disposable Neo4j database, never the shared instance.
"""
import argparse
import csv
import os
from pathlib import Path

FAMILY_ID = {"PH": "PISTON", "PR": "PISTON_ROD", "CH": "CROSSHEAD", "CR": "CONNECTING_ROD", "CS": "CRANKSHAFT"}
FAMILY_NAME = {"PH": "Piston Head", "PR": "Piston Rod", "CH": "Crosshead", "CR": "Connecting Rod", "CS": "Crankshaft"}
EXPECTED_PAIRS = {"IF-001": ("PH", "PR"), "IF-002": ("PR", "CH"), "IF-003": ("CH", "CR"), "IF-004": ("CR", "CS")}


def read_csv(path, required):
    with open(path, newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        if not reader.fieldnames or not set(required) <= set(reader.fieldnames):
            raise ValueError(f"{path}: required columns missing: {set(required)-set(reader.fieldnames or [])}")
        return [{k: (v.strip() if isinstance(v, str) else v) for k,v in row.items()} for row in reader]


def load_and_validate(interfaces_path, occurrences_path):
    interfaces = read_csv(interfaces_path, ("interface_id", "part_a", "part_b", "as_label", "relation_status", "geometry_status", "fit_status", "source_document"))
    occurrences = read_csv(occurrences_path, ("instance_interface_id", "interface_id", "cylinder_no", "occurrence_a", "occurrence_b", "relation_status", "source_document"))
    if len(interfaces) != 4 or {r['interface_id'] for r in interfaces} != set(EXPECTED_PAIRS):
        raise ValueError("Expected exactly IF-001..IF-004")
    if len(occurrences) != 24 or len({r['instance_interface_id'] for r in occurrences}) != 24:
        raise ValueError("Expected exactly 24 unique interface occurrences")
    for r in interfaces:
        if (r['part_a'],r['part_b']) != EXPECTED_PAIRS[r['interface_id']]:
            raise ValueError(f"Unexpected pairing for {r['interface_id']}")
        if r['fit_status'] != 'NOT_EVALUATED':
            raise ValueError(f"Fit must not be marked evaluated: {r['interface_id']}")
        r['part_a_id'],r['part_b_id'] = FAMILY_ID[r['part_a']],FAMILY_ID[r['part_b']]
        r['hole_count_reference'] = int(r['hole_count_reference']) if r.get('hole_count_reference') else None
    ids = set()
    counts = {}
    for r in occurrences:
        pair=EXPECTED_PAIRS.get(r['interface_id'])
        cyl=int(r['cylinder_no'])
        if pair is None or not 1 <= cyl <= 6: raise ValueError('Invalid interface or cylinder')
        if (r['interface_id'],cyl) in ids: raise ValueError('Duplicate interface per cylinder')
        ids.add((r['interface_id'],cyl))
        for side,family in [('a',pair[0]),('b',pair[1])]:
            name = r[f'occurrence_{side}']
            expected_suffix = ':1' if family=='CS' else f':{cyl}'
            if not name.startswith(f'HDH_{family}_6001:') or not name.endswith(expected_suffix):
                raise ValueError(f"Occurrence mismatch: {name}, expected {family} cylinder {cyl}")
        r['cylinder_no'] = cyl
        counts[r['interface_id']] = counts.get(r['interface_id'],0)+1
    if set(counts) != set(EXPECTED_PAIRS) or any(v != 6 for v in counts.values()):
        raise ValueError('Each interface must occur in all six cylinders')
    occ = {}
    for r in occurrences:
        for key,family in [('occurrence_a',EXPECTED_PAIRS[r['interface_id']][0]),('occurrence_b',EXPECTED_PAIRS[r['interface_id']][1])]:
            name=r[key]
            occ[name] = {'occurrence_id':name,'part_id':FAMILY_ID[family], 'part_family':family, 'cylinder_no':None if family=='CS' else r['cylinder_no']}
    if len(occ) != 25: raise ValueError(f'Expected 25 unique occurrences; got {len(occ)}')
    families = [{'id':id,'name':FAMILY_NAME[code], 'code':code} for code,id in FAMILY_ID.items()]
    return interfaces,occurrences,list(occ.values()),families


CYPHER_FAMILIES = """
MERGE (a:Assembly {assembly_id: 'ASM-001'})
SET a.name = 'Crosshead Engine Assembly'
WITH a
UNWIND $rows AS row
MERGE (p:PartFamily {part_id: row.id})
SET p.name = row.name, p.code = row.code
MERGE (a)-[:CONTAINS]->(p)
"""
CYPHER_INTERFACES = """
UNWIND $rows AS row
MATCH (left:PartFamily {part_id: row.part_a_id})
MATCH (right:PartFamily {part_id: row.part_b_id})
MERGE (it:Interface {interface_id: row.interface_id})
SET it.name = row.part_a + ' - ' + row.part_b,
    it.as_label = row.as_label, it.part_a = row.part_a, it.part_b = row.part_b,
    it.mating_region = row.mating_region, it.nominal_reference = row.nominal_reference,
    it.hole_count_reference = row.hole_count_reference, it.connection_type = row.connection_type,
    it.relation_status = row.relation_status, it.geometry_status = row.geometry_status,
    it.fit_status = row.fit_status, it.source_document = row.source_document, it.notes = row.notes
MERGE (left)-[:PARTICIPATES_IN {role: 'PART_A'}]->(it)
MERGE (right)-[:PARTICIPATES_IN {role: 'PART_B'}]->(it)
"""
CYPHER_OCCURRENCES = """
UNWIND $rows AS row
MATCH (p:PartFamily {part_id: row.part_id})
MERGE (o:PartOccurrence {occurrence_id: row.occurrence_id})
SET o.part_family = row.part_family, o.cylinder_no = row.cylinder_no
MERGE (o)-[:INSTANCE_OF]->(p)
"""
CYPHER_INTERFACE_OCCURRENCES = """
UNWIND $rows AS row
MATCH (it:Interface {interface_id: row.interface_id})
MATCH (a:PartOccurrence {occurrence_id: row.occurrence_a})
MATCH (b:PartOccurrence {occurrence_id: row.occurrence_b})
MERGE (io:InterfaceOccurrence {instance_interface_id: row.instance_interface_id})
SET io.cylinder_no = row.cylinder_no, io.relation_status = row.relation_status,
    io.source_document = row.source_document
MERGE (io)-[:INSTANCE_OF_INTERFACE]->(it)
MERGE (io)-[:PART_A]->(a)
MERGE (io)-[:PART_B]->(b)
"""

def write_tx(tx, interfaces, occurrence_links, occurrences, families):
    for statement,rows in ((CYPHER_FAMILIES,families),(CYPHER_INTERFACES,interfaces),
                           (CYPHER_OCCURRENCES,occurrences),(CYPHER_INTERFACE_OCCURRENCES,occurrence_links)):
        tx.run(statement, rows=rows).consume()


def main():
    p=argparse.ArgumentParser(description='Validate / import HDH interfaces (no SQLite changes)')
    p.add_argument('--interfaces',type=Path,required=True)
    p.add_argument('--occurrences',type=Path,required=True)
    p.add_argument('--apply',action='store_true',help='Write to Neo4j (default: only validate CSVs)')
    p.add_argument('--database',default='neo4j')
    args=p.parse_args()
    interfaces, links, occurrences, families = load_and_validate(args.interfaces,args.occurrences)
    print(f'CSV checked: {len(interfaces)} interfaces, {len(links)} interface occurrences, {len(occurrences)} parts, {len(families)} families')
    if not args.apply:
        print('VALIDATION ONLY: no DB connection and no writes. Add --apply after reviewing backups.')
        return
    try:
        from neo4j import GraphDatabase
    except ImportError as exc:
        raise SystemExit('neo4j Python package missing: python -m pip install neo4j') from exc
    password=os.getenv('NEO4J_PASSWORD')
    if not password: raise SystemExit('NEO4J_PASSWORD not set; no writes performed')
    uri=os.getenv('NEO4J_URI','bolt://localhost:7687')
    user=os.getenv('NEO4J_USER','neo4j')
    with GraphDatabase.driver(uri,auth=(user,password)) as driver:
        driver.verify_connectivity()
        with driver.session(database=args.database) as session:
            session.execute_write(write_tx,interfaces,links,occurrences,families)
    print('Neo4j upsert completed: 4 interfaces and 24 cylinder interface occurrences')

if __name__ == '__main__':
    main()
