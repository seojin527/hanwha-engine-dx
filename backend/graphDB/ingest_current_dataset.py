"""Fresh/current Hanwha Engine dataset importer.
Run from project root: python -m backend.graphDB.ingest_current_dataset
Requires: pip install neo4j openpyxl; NEO4J_PASSWORD environment variable.
Does NOT delete existing graph. Only explicitly listed files are imported.
"""
from pathlib import Path
from collections import Counter
import json, os
from openpyxl import load_workbook
from neo4j import GraphDatabase

ROOT = Path(__file__).resolve().parents[2]
JSON_FILES = ['HDH_PR_01.json','HDH_CR_01.json','HDH_CS_01.json','HDH_CH_04.json','HDH_PH_01.json']
ERROR_FILES = [
 'RAGFlow_피스톤로드_오류DB (1).xlsx',
 'RAGFlow_커넥팅로드_오류DB.xlsx',
 'RAGFlow_크랭크샤프트_오류DB(1).xlsx',
 'RAGFlow_크로스헤드_오류DB.xlsx',
 'RAGFlow_피스톤헤드_오류DB.xlsx',
]
FAMILIES = {'PR':('PISTON_ROD','피스톤로드',True),'CR':('CONNECTING_ROD','커넥팅로드',True),
            'CS':('CRANKSHAFT','크랭크샤프트',True),'CH':('CROSSHEAD','크로스헤드',True),
            'PH':('PISTON','피스톤헤드',False)}

def prepare_drawings():
    output=[]
    for filename in JSON_FILES:
        path=ROOT/'data'/'normalized'/filename
        data=json.loads(path.read_text(encoding='utf-8-sig'))
        info=data['partInfo']; part_no=info['partNo']; code=part_no.split('-')[1]
        family_id, family_name, implementation=FAMILIES[code]
        items=data['items']; ids=[str(i['id']) for i in items]
        if len(ids)!=len(set(ids)): raise ValueError(f'{filename}: duplicate item ids')
        drawing_id=path.stem
        specs=[]
        for item in items:
            pos=item.get('position') or {}
            tol=item.get('tolerance')
            specs.append(dict(spec_id=f'{drawing_id}:{item["id"]}',source_item_id=str(item['id']),
                category=item.get('category'),kind=item.get('kind'),raw_text=item.get('text'),
                nominal_value=item.get('nominal'),unit=item.get('unit'),fit=item.get('fit'),
                tolerance_value=tol if isinstance(tol,(int,float)) else None,
                tolerance_json=json.dumps(tol,ensure_ascii=False) if tol is not None else None,
                gdt_type=item.get('characteristic'),datum_references=item.get('datums') or [],
                position_x=pos.get('xPercent'),position_y=pos.get('yPercent'),
                position_unit='percent',source_json=json.dumps(item,ensure_ascii=False)))
        output.append(dict(drawing_id=drawing_id,part_no=part_no,part_name=info.get('partName'),
            family_id=family_id,family_name=family_name,implementation_target=implementation,
            source_file=filename,source_pdf=data.get('source',{}).get('file'),specs=specs))
    return output

def prepare_errors():
    rows=[]
    for filename in ERROR_FILES:
        path=ROOT/'data'/'errors'/filename
        wb=load_workbook(path,read_only=True,data_only=True)
        ws=wb['오류주의사항DB']
        it=ws.values; headers=[str(h).strip() for h in next(it)]
        if 'case_id' not in headers or 'case_title' not in headers: raise ValueError(f'{filename}: missing columns')
        for values in it:
            row={k:(str(v).strip() if v is not None else '') for k,v in zip(headers,values)}
            if not row.get('case_id'):continue
            row['source_file']=filename
            rows.append(row)
        wb.close()
    counts=Counter(r['case_id'] for r in rows)
    dup=[k for k,v in counts.items() if v>1]
    if dup:raise ValueError(f'Duplicate case_id across input files: {dup[:20]}')
    return rows

def main():
    drawings=prepare_drawings(); errors=prepare_errors()
    print('사전검증:',[(d['drawing_id'],d['part_no'],len(d['specs'])) for d in drawings])
    print('도면 측정규격',sum(len(d['specs']) for d in drawings),'개 / 오류사례',len(errors),'건')
    pw=os.getenv('NEO4J_PASSWORD')
    if not pw:raise RuntimeError('NEO4J_PASSWORD 환경변수를 설정하세요.')
    with GraphDatabase.driver(os.getenv('NEO4J_URI','bolt://localhost:7687'),
                              auth=(os.getenv('NEO4J_USER','neo4j'),pw)) as driver:
        driver.verify_connectivity()
        with driver.session(database=os.getenv('NEO4J_DATABASE','neo4j')) as session:
            for label,key in [('PartFamily','part_id'),('Part','part_id'),('Drawing','drawing_id'),
                              ('MeasurementSpec','spec_id'),('ErrorCase','case_id'),('ErrorType','key')]:
                session.run(f'CREATE CONSTRAINT IF NOT EXISTS FOR (n:{label}) REQUIRE n.{key} IS UNIQUE').consume()
            def write(tx):
                for d in drawings:
                    tx.run('''
                        MERGE (f:PartFamily {part_id:$family_id})
                        SET f.name=$family_name, f.implementation_target=$implementation_target
                        MERGE (p:Part {part_id:$part_no})
                        SET p.part_no=$part_no,p.name=$part_name,p.record_type='drawing_part'
                        MERGE (f)-[:HAS_PART]->(p)
                        MERGE (dw:Drawing {drawing_id:$drawing_id})
                        SET dw.source_file=$source_file,dw.source_pdf=$source_pdf
                        MERGE (dw)-[:DESCRIBES]->(p)
                        WITH dw
                        UNWIND $specs AS spec
                        MERGE (s:MeasurementSpec {spec_id:spec.spec_id})
                        SET s += spec
                        MERGE (dw)-[:HAS_SPEC]->(s)
                    ''',**d).consume()
                tx.run('''
                    UNWIND $rows AS row
                    MERGE (e:ErrorCase {case_id:row.case_id})
                    SET e += row
                    WITH e,row,
                      CASE WHEN trim(coalesce(row.error_type_code,'')) <> '' THEN 'CODE:'+row.error_type_code
                           WHEN trim(coalesce(row.error_type,'')) <> '' THEN 'TYPE:'+row.error_type
                           ELSE 'CATEGORY:'+coalesce(row.error_category,'') END AS type_key
                    FOREACH (_ IN CASE WHEN type_key <> 'CATEGORY:' THEN [1] ELSE [] END |
                      MERGE (t:ErrorType {key:type_key})
                      SET t.name=coalesce(row.error_type,row.error_category)
                      MERGE (e)-[:HAS_TYPE]->(t)
                    )
                ''',rows=errors).consume()
            session.execute_write(write)
            result=session.run('''
                MATCH (d:Drawing)-[:HAS_SPEC]->(s:MeasurementSpec)
                WHERE d.drawing_id IN $ids
                RETURN count(DISTINCT d) AS drawings,count(s) AS specs
            ''',ids=[d['drawing_id'] for d in drawings]).single()
            err_count=session.run('MATCH (e:ErrorCase) WHERE e.case_id IN $ids RETURN count(e) AS n',ids=[r['case_id'] for r in errors]).single()['n']
            print(f"적재 완료: 도면 {result['drawings']}개, 측정규격 {result['specs']}개, 오류사례 {err_count}건")
if __name__=='__main__': main()
