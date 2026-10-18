"""OCR 텍스트를 JSON으로 변환. 파이썬 표준 라이브러리만 사용. README 참조."""
import argparse
import json
import re
from pathlib import Path

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
    table = re.search(r'table\s+1:\s*(.+)', source)
    title = table[1].strip() if table else ''
    def field(start, end=None):
        pattern = re.escape(start)+r'\s+(.+?)'+(r'\s+'+re.escape(end) if end else r'$')
        match = re.search(pattern, title)
        return match[1].strip() if match else None
    doc = dict(schema_version='1.0', drawing_id=drawing_id,
               part_name=field('PART NAME','PART NO.'), part_no=field('PART NO.','MATERIAL'),
               material_raw=field('MATERIAL','QTY'), material_normalized=None,
               quantity=int(field('QTY','SCALE')) if field('QTY','SCALE') else None,
               drawing_scale=field('SCALE','UNIT'), unit=field('UNIT','PROJECTION'),
               projection=field('PROJECTION','DRAWN'), drawn_date=field('DRAWN'),
               image=dict(file=image_file, width_px=width, height_px=height, dpi=dpi,
                          coordinate_origin='top-left', coordinate_anchor='text_center'),
               title_table_raw=title,
               review_reasons=['재질 $US304는 OCR 원문이며 SUS304 등으로 자동 교정하지 않음'],
               items=[])
    section = None

    for line in source.splitlines():
        heading = re.fullmatch(r'\[\s*(.+?)\s*\]', line.strip())
        
        if heading:
            section = heading[1]
            continue

        match = re.match(r'^\s*(\d+)\s+(.+?)\s+\[(\d+),\s*(\d+)\]\s*$', line) if section == 'DIMENSIONS' else None
        gdt = re.match(r"^\s*(\d+)\.\s*\['(.+)',\s*\((\d+),\s*(\d+)\)\]\s*$", line) if section == 'GD&T' else None
        if not (match or gdt):
            continue
        number, raw, x, y = (match or gdt).groups()
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

        item = {
            'id': f'{category}_{int(number):03d}',
            'category': category,
            'raw_text': raw,
            'position': {'x': x, 'y': y},
            'original_position': {
                'x': original_x,
                'y': original_y
            },
        }

        if category == 'DIMENSION':
            item.update(parse_dimension(raw))
        else:
            item.update({
                'measurement_characteristic': 'GEOMETRIC_TOLERANCE',
                'requires_review': True,
                'review_reasons': [
                    '기하공차 종류, 기준 데이텀 및 공차역 해석 필요'
                ],
            })

        doc['items'].append(item)

    doc['item_count'] = len(doc['items'])
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