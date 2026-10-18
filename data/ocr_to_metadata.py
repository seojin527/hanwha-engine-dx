"""OCR 텍스트를 JSON으로 변환. 파이썬 표준 라이브러리만 사용. README 참조."""
import argparse
import json
import re
from pathlib import Path

from gdt_metadata import parse_frame_line, parse_gdt_frame
from titleblock_metadata import parse_title_block

NUMBER = r'\d+(?:\.\d+)?'

def parse_dimension(raw):
    result = dict(feature_type='UNKNOWN', measurement_characteristic='UNKNOWN',
                  nominal_value=None, unit='mm', tol_type='UNSPECIFIED',
                  upper_deviation=None, lower_deviation=None, lower_limit=None,
                  upper_limit=None, requires_review=False, review_reasons=[])
    text = raw.strip()
    # Diameter text does not distinguish a hole from an external shaft.
    if '⌀' in text:
        result['measurement_characteristic'] = 'DIAMETER'
        pattern = rf'⌀\s*({NUMBER})(?:\s*±\s*({NUMBER}))?'
    elif text.startswith('M'):
        match = re.fullmatch(rf'M\s*({NUMBER})(?:\s*[x×]\s*({NUMBER}))?', text)
        if match:
            result.update(feature_type='THREAD', measurement_characteristic='THREAD_SPEC',
                          nominal_value=float(match[1]), tol_type='THREAD_SPEC',
                          thread_pitch=float(match[2]) if match[2] else None,
                          thread_class=None, thread_side=None)
            result['review_reasons'].append('나사 피치·등급·내외나사 여부는 원도면/적용 규격 확인 필요')
            result['requires_review'] = True
            return result
        pattern = r'(?!)'
    elif text.startswith('C'):
        result.update(feature_type='CHAMFER', measurement_characteristic='CHAMFER_SIZE')
        pattern = rf'C\s*({NUMBER})(?:\s*±\s*({NUMBER}))?'
    elif text.startswith('R'):
        result.update(feature_type='RADIUS', measurement_characteristic='RADIUS')
        pattern = rf'R\s*({NUMBER})(?:\s*±\s*({NUMBER}))?'
    else:
        result['measurement_characteristic'] = 'LINEAR_DIMENSION'
        pattern = rf'({NUMBER})(?:\s*±\s*({NUMBER}))?'
    match = re.fullmatch(pattern, text)
    if not match:
        result.update(requires_review=True, tol_type='UNKNOWN')
        result['review_reasons'].append('표기가 깨졌거나 지원하지 않는 형식: 공차·명목값 자동 확정 금지')
        return result
    result['nominal_value'] = float(match[1])
    if match[2]:
        tolerance = float(match[2])
        nominal = result['nominal_value']
        result.update(tol_type='DIMENSION', upper_deviation=tolerance,
                      lower_deviation=-tolerance,
                      lower_limit=round(nominal-tolerance, 9),
                      upper_limit=round(nominal+tolerance, 9))
    else:
        result.update(requires_review=True)
        result['review_reasons'].append('개별 공차 없음: 일반공차/규격 확인 전 합격범위 계산 금지')
    if result['feature_type'] == 'UNKNOWN':
        result['review_reasons'].append('문자만으로 실제 형상/측정면 확정 불가')
        result['requires_review'] = True
    return result

def convert(source, drawing_id, image_file=None):
    frame_match = re.search(
        r'Frame offset\s*:\s*(-?\d+)\s*,\s*(-?\d+)',
        source
    )
    if frame_match:
        offset_x, offset_y = map(int, frame_match.groups())
    else:
        raise ValueError('Frame offset 정보가 없습니다.')

    size = re.search(r'Image size\s*:\s*(\d+)\s*x\s*(\d+)\s*px.*?PDF\s+(\d+)\s*dpi', source)
    if not size:
        raise ValueError('Image size / PDF dpi 정보가 필요합니다.')
    width, height, dpi = map(int, size.groups())
    # 표제란: 'table N:' 줄이 여러 개일 수 있고, 신버전은 단어별 좌표 리스트
    tables = re.findall(r'^\s*table\s+\d+\s*:\s*(.+?)\s*$', source, re.M | re.I)
    title = parse_title_block(tables)
    doc = dict(schema_version='1.0', drawing_id=drawing_id,
               part_name=title['part_name'], part_no=title['part_no'],
               material_raw=title['material_raw'], material_normalized=None,
               quantity=title['quantity'], drawing_scale=title['drawing_scale'],
               unit=title['unit'], unit_raw=title['unit_raw'],
               projection=title['projection'], sheet_size=title['sheet_size'],
               drawn_date=title['drawn_date'], operator=title['operator'],
               image=dict(file=image_file, width_px=width, height_px=height, dpi=dpi,
                          coordinate_origin='top-left', coordinate_anchor='text_center'),
               title_table_raw=title['title_table_raw'],
               review_reasons=title['review_reasons'],
               items=[])
    section = None

    for line in source.splitlines():
        heading = re.fullmatch(r'\[\s*(.+?)\s*\]', line.strip())
        
        if heading:
            section = heading[1]
            continue

        match = re.match(r'^\s*(\d+)\s+(.+?)\s+\[(\d+),\s*(\d+)\]\s*$', line) if section == 'DIMENSIONS' else None
        gdt = re.match(r'^\s*(\d+)\.\s+(\[.+\])\s*$', line) if section == 'GD&T' else None
        if not (match or gdt):
            continue
        if match:
            number, raw, x, y = match.groups()
        else:
            number = gdt[1]
            raw, x, y = parse_frame_line(gdt[2])     # raw: 진짜 줄바꿈이 들어간 프레임 텍스트
        x, y = int(x), int(y)
        if not (0 <= x < width and 0 <= y < height):
            raise ValueError(f'이미지 범위 밖 좌표: {x}, {y}')
        category = 'DIMENSION' if match else 'GDT'

        # 원본 OCR 좌표 보존
        original_x, original_y = x, y

        # 치수는 Frame 기준, GD&T는 전체 이미지 기준
        if category == 'DIMENSION':
            x += offset_x
            y += offset_y

        base = {
            'category': category,
            'position': {'x': x, 'y': y},
            'original_position': {'x': original_x, 'y': original_y},
        }

        if category == 'DIMENSION':
            item = {'id': f'DIMENSION_{int(number):03d}', **base, 'raw_text': raw}
            item.update(parse_dimension(raw))
            doc['items'].append(item)
        else:
            # 기하공차 프레임 1개 = 여러 줄 → 줄마다 항목 1개 (위치는 프레임 것을 공유)
            for row_no, row in enumerate(parse_gdt_frame(raw), start=1):
                item = {'id': f'GDT_{int(number):03d}_{row_no}', **base,
                        'frame_id': f'GDT_{int(number):03d}', 'row_index': row_no,
                        'measurement_characteristic': 'GEOMETRIC_TOLERANCE'}
                item.update(row)
                doc['items'].append(item)

    doc['item_count'] = len(doc['items'])
    gdt_rows = [i for i in doc['items'] if i['category'] == 'GDT']
    doc['counts'] = dict(dimensions=doc['item_count'] - len(gdt_rows), gdt_rows=len(gdt_rows),
                         gdt_frames=len({i['frame_id'] for i in gdt_rows}))
    return doc


def main():
    parser = argparse.ArgumentParser(
        description='검수 완료 OCR TXT를 Metadata JSON으로 변환'
    )

    parser.add_argument(
        'drawing_id',
        help='도면 이름 (예: HDH_63_05)'
    )

    args = parser.parse_args()

    # 프로젝트 data 폴더
    data_dir = Path(__file__).resolve().parent

    input_path = (
        data_dir / 'reviewed' /
        f'{args.drawing_id}_reviewed.txt'
    )

    output_dir = data_dir / 'normalized'
    output_dir.mkdir(parents=True, exist_ok=True)

    output_path = (
        output_dir / f'{args.drawing_id}_metadata.json'
    )

    if not input_path.is_file():
        print(f'[ERROR] 검수 완료 파일 없음: {input_path}')
        return

    source = input_path.read_text(encoding='utf-8-sig')

    metadata = convert(
        source,
        drawing_id=args.drawing_id,
        image_file=f'{args.drawing_id}_reviewed.jpg'
    )

    output_path.write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2),
        encoding='utf-8'
    )

    print(f'[INPUT] {input_path}')
    print(f'[SAVED] {output_path}')
    print(f'[ITEMS] {metadata["item_count"]}')


if __name__ == '__main__':
    main()