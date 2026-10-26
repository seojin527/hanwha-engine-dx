"""Import eDOCr2 metadata JSON into Neo4j without inventing physical Features.
Run: python -m backend.graphDB.ingest_drawings path/to/HDH_63_01_metadata.json
Environment: NEO4J_PASSWORD (required), NEO4J_URI and NEO4J_USER (optional).
"""
import argparse
import json
import os
from pathlib import Path
from neo4j import GraphDatabase

FAMILY_IDS = {'PISTON ROD': 'PISTON_ROD', 'CONNECTING ROD': 'CONNECTING_ROD', 'CRANKSHAFT': 'CRANKSHAFT'}

def convert_item(drawing_id, item):
    p = item.get('position') or {}
    original = item.get('original_position') or {}
    spec = {
        'spec_id': f'{drawing_id}:{item["id"]}',
        'source_item_id': item['id'],
        'category': item.get('category'),
        'raw_text': item.get('raw_text'),
        'measurement_characteristic': item.get('measurement_characteristic'),
        'feature_type_ocr': item.get('feature_type'),
        'nominal_value': item.get('nominal_value'),
        'unit': item.get('unit'),
        'tol_type': item.get('tol_type'),
        'upper_deviation': item.get('upper_deviation'),
        'lower_deviation': item.get('lower_deviation'),
        'lower_limit': item.get('lower_limit'),
        'upper_limit': item.get('upper_limit'),
        'position_x': p.get('x'),
        'position_y': p.get('y'),
        'original_position_x': original.get('x'),
        'original_position_y': original.get('y'),
        'requires_review': item.get('requires_review', False),
        'review_reasons': item.get('review_reasons') or [],
        'frame_id': item.get('frame_id'),
        'row_index': item.get('row_index'),
        'gdt_symbol': item.get('gdt_symbol'),
        'gdt_type': item.get('gdt_type'),
        'gdt_name_ko': item.get('gdt_name_ko'),
        'gdt_category': item.get('gdt_category'),
        'tolerance_value': item.get('tolerance_value'),
        'tolerance_zone': item.get('tolerance_zone'),
        'material_condition': item.get('material_condition'),
        'datum_references': item.get('datum_references') or [],
        'frame_datum_references': item.get('frame_datum_references') or [],
        'thread_pitch': item.get('thread_pitch'),
        'thread_class': item.get('thread_class'),
        'thread_side': item.get('thread_side'),
    }
    # Neo4j does not allow null property values; omit absent optional values.
    return {k: v for k, v in spec.items() if v is not None}

def import_json(tx, data):
    drawing_id = data['drawing_id']
    part_no = data['part_no']
    part_name = data['part_name'].strip()
    family_id = FAMILY_IDS.get(part_name.upper())
    if not family_id:
        raise ValueError(f'알 수 없는 부품 종류: {part_name!r}; FAMILY_IDS 매핑을 확인하세요.')
    metadata = {
        'drawing_id': drawing_id,
        'schema_version': data.get('schema_version'),
        'drawing_scale': data.get('drawing_scale'),
        'unit': data.get('unit'),
        'sheet_size': data.get('sheet_size'),
        'drawn_date': data.get('drawn_date'),
        'operator': data.get('operator'),
        'material_raw': data.get('material_raw'),
        'material_normalized': data.get('material_normalized'),
        'title_table_raw': data.get('title_table_raw'),
        'review_reasons': data.get('review_reasons') or [],
        'image_file': (data.get('image') or {}).get('file'),
        'image_width_px': (data.get('image') or {}).get('width_px'),
        'image_height_px': (data.get('image') or {}).get('height_px'),
        'coordinate_origin': (data.get('image') or {}).get('coordinate_origin'),
        'coordinate_anchor': (data.get('image') or {}).get('coordinate_anchor'),
    }
    metadata = {k: v for k, v in metadata.items() if v is not None}
    tx.run('''
        MERGE (f:PartFamily {part_id:$family_id})
        ON CREATE SET f.name=$part_name
        MERGE (p:Part {part_id:$part_no})
        SET p.part_no=$part_no, p.name=$part_name, p.record_type='drawing_part'
        MERGE (f)-[:HAS_PART]->(p)
        MERGE (d:Drawing {drawing_id:$drawing_id})
        SET d += $metadata
        MERGE (d)-[:DESCRIBES]->(p)
    ''', family_id=family_id, part_no=part_no, part_name=part_name, drawing_id=drawing_id, metadata=metadata).consume()
    specs = [convert_item(drawing_id, item) for item in data['items']]
    if len({s['spec_id'] for s in specs}) != len(specs):
        raise ValueError('JSON 내 중복 측정항목 ID가 있습니다.')
    tx.run('''
        MATCH (d:Drawing {drawing_id:$drawing_id})
        UNWIND $specs AS row
        MERGE (s:MeasurementSpec {spec_id:row.spec_id})
        SET s = row
        MERGE (d)-[:HAS_SPEC]->(s)
    ''', drawing_id=drawing_id, specs=specs).consume()
    return len(specs)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('json_files', nargs='+', type=Path)
    args = parser.parse_args()
    password = os.getenv('NEO4J_PASSWORD')
    if not password:
        raise RuntimeError('NEO4J_PASSWORD 환경변수를 설정하세요.')
    uri = os.getenv('NEO4J_URI', 'bolt://localhost:7687')
    user = os.getenv('NEO4J_USER', 'neo4j')
    with GraphDatabase.driver(uri, auth=(user, password)) as driver:
        driver.verify_connectivity()
        with driver.session() as session:
            for constraint in [
                'CREATE CONSTRAINT partfamily_id_unique IF NOT EXISTS FOR (f:PartFamily) REQUIRE f.part_id IS UNIQUE',
                'CREATE CONSTRAINT drawing_id_unique IF NOT EXISTS FOR (d:Drawing) REQUIRE d.drawing_id IS UNIQUE',
                'CREATE CONSTRAINT part_id_unique IF NOT EXISTS FOR (p:Part) REQUIRE p.part_id IS UNIQUE',
                'CREATE CONSTRAINT spec_id_unique IF NOT EXISTS FOR (s:MeasurementSpec) REQUIRE s.spec_id IS UNIQUE',
            ]:
                session.run(constraint).consume()
            for file in args.json_files:
                data = json.loads(file.read_text(encoding='utf-8-sig'))
                if not isinstance(data.get('items'), list):
                    raise ValueError(f'{file}: items 배열이 없습니다.')
                count = session.execute_write(import_json, data)
                print(f'적재 완료: {file.name} / {data["drawing_id"]} / {count}개 MeasurementSpec')

if __name__ == '__main__':
    main()
    