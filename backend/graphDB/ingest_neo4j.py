
import argparse
import os

import pandas as pd
from neo4j import GraphDatabase


def ingest(excel_path):
    df = pd.read_excel(
        excel_path,
        sheet_name="오류주의사항DB",
        dtype=str,
        keep_default_na=False,
    )

    df.columns = df.columns.str.strip()

    required = {"case_id", "case_title"}
    missing = required - set(df.columns)

    if missing:
        raise ValueError(f"필수 컬럼 누락: {sorted(missing)}")

    if df.empty:
        raise ValueError("오류사례 데이터가 없습니다.")

    df = df.fillna("")

    for col in df.columns:
        df[col] = df[col].astype(str).str.strip()

    if df["case_id"].eq("").any():
        raise ValueError("빈 case_id가 있습니다.")

    if df["case_id"].duplicated().any():
        raise ValueError("중복 case_id가 있습니다.")

    records = df.to_dict(orient="records")

    uri = os.getenv("NEO4J_URI", "bolt://localhost:7687")
    user = os.getenv("NEO4J_USER", "neo4j")
    password = os.getenv("NEO4J_PASSWORD")

    if not password:
        raise ValueError("NEO4J_PASSWORD 환경변수가 필요합니다.")

    driver = GraphDatabase.driver(
        uri,
        auth=(user, password),
    )

    try:
        driver.verify_connectivity()

        with driver.session(database="neo4j") as session:
            session.run("""
                CREATE CONSTRAINT error_case_id IF NOT EXISTS
                FOR (e:ErrorCase)
                REQUIRE e.case_id IS UNIQUE
            """).consume()

            session.run("""
                CREATE CONSTRAINT error_type_key IF NOT EXISTS
                FOR (t:ErrorType)
                REQUIRE t.key IS UNIQUE
            """).consume()

            session.run("""
                UNWIND $rows AS row
                MERGE (e:ErrorCase {case_id: row.case_id})
                SET e += row
            """, rows=records).consume()

            # 분류 코드가 있으면 코드 기준으로 묶고,
            # 없으면 오류 유형명 또는 대분류를 사용한다.
            session.run("""
                UNWIND $rows AS row
                WITH row,
                     CASE
                         WHEN trim(coalesce(row.error_type_code, '')) <> ''
                         THEN 'CODE:' + row.error_type_code
                         WHEN trim(coalesce(row.error_type, '')) <> ''
                         THEN 'TYPE:' + row.error_type
                         ELSE 'CATEGORY:' +
                              coalesce(row.error_category, '')
                     END AS type_key
                WHERE type_key <> 'CATEGORY:'

                MATCH (e:ErrorCase {case_id: row.case_id})
                MERGE (t:ErrorType {key: type_key})
                SET t.name = CASE
                    WHEN trim(coalesce(row.error_type, '')) <> ''
                    THEN row.error_type
                    ELSE row.error_category
                END
                MERGE (e)-[:HAS_TYPE]->(t)
            """, rows=records).consume()

            result = session.run("""
                MATCH (e:ErrorCase)
                RETURN count(e) AS total
            """).single()

            print(f"Neo4j 전체 오류사례: {result['total']}건")
            print(f"이번 엑셀 입력: {len(records)}건")

    finally:
        driver.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--file", required=True)
    args = parser.parse_args()

    ingest(args.file)
