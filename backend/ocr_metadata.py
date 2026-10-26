"""eDOCr2 RAW TXT → 화면용 JSON. 치수는 frame 좌표, GD&T는 전체 좌표."""
import ast
import re

from general_tolerance import GENERAL_LABEL, general_deviation

NUMBER = r'\d+(?:\.\d+)?'
SIGNED = r'[+-]\d+(?:\.\d+)?'


def parse_dimension(raw, unit):
    """치수 원문 해석. 공차 출처(tolerance_source)
    DRAWING: 도면에 적힌 공차 (±0.05, +0.02/-0.01)
    GENERAL: 개별 공차가 없어 일반공차 ISO 2768-m 적용
    None   : 일반공차를 적용할 수 없음 (나사, 범위 밖 치수 등)
    """
    result = dict(feature_type='UNKNOWN', measurement_characteristic='UNKNOWN',
                  nominal_value=None, unit=unit, tol_type='UNSPECIFIED',
                  lower_limit=None, upper_limit=None, lower_deviation=None,
                  upper_deviation=None, tolerance_source=None,
                  requires_review=True, review_reasons=[])
    text = raw.strip()
    if text.startswith('M'):
        match = re.fullmatch(rf'M\s*({NUMBER})(?:\s*[x×]\s*({NUMBER}))?', text)
        if match:
            result.update(feature_type='THREAD', measurement_characteristic='THREAD_SPEC',
                          nominal_value=float(match[1]), tol_type='THREAD_SPEC',
                          thread_pitch=float(match[2]) if match[2] else None,
                          thread_class=None, thread_side=None)
            result['review_reasons'].append('나사 피치·등급·내외나사 여부 확인 필요')
            return result
        pattern = r'(?!)'
    else:
        prefix = ''
        if text.startswith(('⌀', 'Ø', 'ø')):
            prefix = r'[⌀Øø]\s*'
            result['measurement_characteristic'] = 'DIAMETER'
        elif text.startswith('C'):
            prefix = r'C\s*'
            result.update(feature_type='CHAMFER', measurement_characteristic='CHAMFER_SIZE')
        elif text.startswith('R'):
            prefix = r'R\s*'
            result.update(feature_type='RADIUS', measurement_characteristic='RADIUS')
        else:
            result['measurement_characteristic'] = 'LINEAR_DIMENSION'
        pattern = (prefix + rf'({NUMBER})'
                   rf'(?:\s*±\s*({NUMBER})|\s*({SIGNED})\s*/\s*({SIGNED}))?')
    match = re.fullmatch(pattern, text)
    if not match:
        result['tol_type'] = 'UNKNOWN'
        result['review_reasons'].append('깨졌거나 지원하지 않는 표기: 원문 확인 전 수치 확정 금지')
        return result
    nominal = float(match[1])
    result['nominal_value'] = nominal
    if match[2]:
        upper, lower = float(match[2]), -float(match[2])
    elif match[3]:
        upper, lower = float(match[3]), float(match[4])
        if lower > upper:
            upper, lower = lower, upper
    else:
        upper = lower = None
    if upper is not None:
        result.update(tol_type='DIMENSION', tolerance_source='DRAWING',
                      lower_limit=round(nominal+lower, 9), upper_limit=round(nominal+upper, 9),
                      upper_deviation=upper, lower_deviation=lower)
    else:
        deviation = general_deviation(result['measurement_characteristic'], nominal)
        if deviation is None:
            result['review_reasons'].append('개별 공차 없음: 일반공차 적용 범위 밖 — 특별 공차 입력 필요')
        else:
            result.update(tol_type='DIMENSION', tolerance_source='GENERAL',
                          lower_limit=round(nominal-deviation, 9),
                          upper_limit=round(nominal+deviation, 9),
                          upper_deviation=deviation, lower_deviation=-deviation)
            result['review_reasons'].append(
                f'개별 공차 없음: {GENERAL_LABEL} ±{deviation:g} 적용 — 특별 공차 여부 확인')
    if result['feature_type'] == 'UNKNOWN':
        result['review_reasons'].append('문자만으로 구멍·외경·측정면을 확정하지 않음')
    result['requires_review'] = bool(result['review_reasons'])
    return result


def title_fields(tables):
    """표 셀의 좌표로 행을 묶는다. 원문/셀 데이터도 그대로 보관한다."""
    rows = []
    for table in tables:
        cells = [c for c in table if isinstance(c, dict) and isinstance(c.get('text'), str)]
        for cell in sorted(cells, key=lambda c: (c.get('top', 0), c.get('left', 0))):
            cy = cell.get('top', 0) + cell.get('height', 0)/2
            row = next((r for r in rows if abs(r['y']-cy) <= max(5, cell.get('height', 0)*0.6)), None)
            if row is None:
                row = {'y': cy, 'cells': []}; rows.append(row)
            row['cells'].append(cell)
    lines = [' '.join(c['text'] for c in sorted(r['cells'], key=lambda c: c.get('left',0))) for r in sorted(rows,key=lambda r:r['y'])]
    fields = {}
    aliases = [('PART NAME', 'part_name'), ('PART NO.', 'part_no'), ('PART NO', 'part_no'),
               ('SCALE','drawing_scale'), ('MATERIAL','material_raw'), ('UNIT','unit'),
               ('DATE','drawn_date'), ('DRAWN','drawn_date'), ('OPERATOR','operator')]
    for line in lines:
        for label, key in aliases:
            match = re.match(re.escape(label) + r'\s+(.+)$', line, re.I)
            if match:
                fields[key] = match[1].strip(); break
    return fields, '\n'.join(lines)


def convert(source, drawing_id, image_file=None):
    size = re.search(r'Image size\s*:\s*(\d+)\s*x\s*(\d+)\s*px', source)
    offset = re.search(r'Frame offset\s*:\s*(-?\d+)\s*,\s*(-?\d+)', source)
    if not size or not offset:
        raise ValueError('Image size와 Frame offset이 필요합니다. 좌표를 추측하지 않습니다.')
    width, height = map(int, size.groups()); ox, oy = map(int, offset.groups())
    if width <= 0 or height <= 0: raise ValueError('잘못된 이미지 크기입니다.')
    dimensions, gdts, tables = [], [], []
    section = ''
    for line in source.splitlines():
        heading = re.fullmatch(r'\[\s*(.+?)\s*\]', line.strip())
        if heading: section=heading[1]; continue
        if section == 'DIMENSIONS':
            match = re.fullmatch(r'\s*(\d+)\s+(.+?)\s+\[(-?\d+),\s*(-?\d+)\]\s*', line)
            if match:
                n, raw, x, y = match.groups(); dimensions.append((int(n),raw,int(x),int(y)))
        elif section == 'GD&T':
            match = re.match(r'^\s*(\d+)\.\s*(\[.*\])\s*$',line)
            if match:
                raw, position = ast.literal_eval(match[2])
                if not isinstance(raw,str) or len(position)!=2: raise ValueError('GD&T 형식 오류')
                gdts.append((int(match[1]),raw,*position))
        elif section == 'TITLE / TABLE':
            match = re.match(r'^\s*table\s+\d+:\s*(.+)$',line)
            if match:
                try: value=ast.literal_eval(match[1])
                except (ValueError,SyntaxError): value=[]
                if isinstance(value,list):tables.append(value)
    # Recognized count must match parsed count: never silently drop an OCR item.
    for label, entries in [('dimensions', dimensions),('GD&T',gdts)]:
        count=re.search(r'Detected '+re.escape(label)+r'\s*:\s*(\d+)',source)
        if count and int(count[1])!=len(entries):
            raise ValueError(f'{label}: 추출 항목 수와 JSON 변환 수가 다릅니다.')
    fields, title = title_fields(tables)
    unit = fields.get('unit','').lower() or None
    doc=dict(schema_version='1.1', drawing_id=drawing_id, **fields,
             material_normalized=None, title_table_raw=title, table_cells=tables,
             review_status='unreviewed', review_reasons=['자동 OCR 결과: 원도면 대조·검수 필요'],
             image=dict(file=image_file, width_px=width,height_px=height,dpi=200,
                        coordinate_origin='top-left',coordinate_anchor='text_center',coordinate_status='FRAME_OFFSET_APPLIED'),items=[])
    doc['unit']=unit
    for category, entries in [('DIMENSION',dimensions),('GDT',gdts)]:
        for n,raw,x,y in entries:
            original={'x':x,'y':y}
            if category=='DIMENSION': x+=ox;y+=oy
            if not (isinstance(x,(int,float)) and isinstance(y,(int,float)) and 0<=x<width and 0<=y<height):
                raise ValueError(f'{category}_{n:03d}: 이미지 범위 밖 좌표 {x},{y}')
            item=dict(id=f'{category}_{n:03d}',category=category,raw_text=raw,
                      position={'x':x,'y':y},original_position=original)
            if category=='DIMENSION':item.update(parse_dimension(raw,unit))
            else:item.update(feature_type='UNKNOWN',tol_type='UNKNOWN',
                measurement_characteristic='GEOMETRIC_TOLERANCE',requires_review=True,
                review_reasons=['기하공차 원문·데이텀·공차역 확인 필요'])
            if unit is None:
                item['requires_review']=True;item['review_reasons'].append('단위 확인 필요')
            doc['items'].append(item)
    if not doc['items']:raise ValueError('추출된 측정항목이 없습니다.')
    doc['item_count']=len(doc['items'])
    return doc
