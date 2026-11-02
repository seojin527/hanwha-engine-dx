"""eDOCr2 RAW TXT → 화면용 JSON. 치수는 frame 좌표, GD&T는 전체 좌표."""
import ast
import re

from general_tolerance import GENERAL_LABEL, general_deviation

NUMBER = r'\d+(?:\.\d+)?'
# 표면 거칠기: 값 앞자리 0이 빠진 .8 도 읽는다 (OCR이 '0.8'을 '.8'로 읽는 경우가 있음)
ROUGH_NUMBER = r'\d+(?:\.\d+)?|\.\d+'
# 거칠기 기호 글자: R 뒤 숫자. OCR이 1을 i, I, l, L, | 로 읽는 경우를 같은 글자로 본다.
ROUGH_KEY_CHAR = r'[0-9iIlL|]'
# 범례 값(R2 = Ral.6)에서만 쓰는 느슨한 숫자: OCR이 1을 l·I·i·| 로, 0을 O·o 로 읽는 경우를 받는다.
# 진짜 숫자가 하나는 있어야 하고(Ra l, Ra O 는 읽지 않음), 'Rat.8' 처럼 t 가 섞인 건 읽지 않는다.
ROUGH_LEGEND_NUMBER = r'(?=[0-9iIl|oO.]*\d)[0-9iIl|oO]*\.?[0-9iIl|oO]+'
ROUGH_MISREAD = str.maketrans('iIl|oO', '111100')
ROUGH_LEGEND_RE = re.compile(rf'(?<![A-Za-z0-9])R\s*({ROUGH_KEY_CHAR})\s*[=:]\s*Ra\s*({ROUGH_LEGEND_NUMBER})')
ROUGH_KEY_RE = re.compile(rf'R\s*({ROUGH_KEY_CHAR})')


def roughness_text(value):
    """거칠기 값을 'Ra 0.8' 모양으로. 앞자리 0이 빠진 .8도 0.8로."""
    return f'Ra {float(value):g}'


def roughness_legend(title):
    """표제란 글자에서 'R1 = Ra 0.8' 범례를 찾는다. 같은 기호에 값이 다르면 그 기호는 읽지 않는다.

    반환: {'R1': {'text': 'Ra 0.8', 'misread': False, 'key_misread': False, 'raw': None}, ...}.
    misread 는 기호나 값의 글자를 OCR 오독으로 보고 보정했다는 뜻이다.
    key_misread: 기호의 1을 i/l 등으로 읽음 (Ri → R1). raw: 값의 글자를 보정했을 때 읽힌 그대로의 값 (Ral.6).
    """
    found, conflict = {}, set()
    for match in ROUGH_LEGEND_RE.finditer(title or ''):
        char = match[1]
        key = 'R' + (char if char.isdigit() else '1')
        raw_number = match[2]
        try:
            text = roughness_text(raw_number.translate(ROUGH_MISREAD))
        except ValueError:
            continue
        value_misread = any(ch not in '0123456789.' for ch in raw_number)
        key_misread = not char.isdigit()
        entry = {'text': text, 'misread': key_misread or value_misread,
                 'key_misread': key_misread, 'raw': raw_number if value_misread else None}
        if key in found and found[key]['text'] != entry['text']:
            conflict.add(key)
        elif key not in found or not entry['misread']:
            found[key] = entry
    return {key: value for key, value in found.items() if key not in conflict}


def apply_roughness_legend(item, legend):
    """표제란 범례에 있는 기호(R1, R2)로 적힌 치수는 반지름이 아니라 표면 거칠기로 본다.

    원문(raw_text)은 그대로 둔다. 진짜 반지름이면 관리자가 확정 표기를 R1 로 되돌리면 된다.
    """
    match = ROUGH_KEY_RE.fullmatch(item['raw_text'].strip())
    if not match or not legend:
        return
    key = 'R' + (match[1] if match[1].isdigit() else '1')
    entry = legend.get(key)
    if entry is None:
        return
    item.update(feature_type='SURFACE', measurement_characteristic='SURFACE_ROUGHNESS',
                tol_type='UNSPECIFIED', nominal_value=None, unit='µm',
                surface_roughness=entry['text'], roughness_symbol=key,
                upper_deviation=None, lower_deviation=None, lower_limit=None, upper_limit=None)
    item.pop('tolerance_source', None)
    reasons = [f'표제란 범례 {key} = {entry["text"]}: 표면 거칠기로 읽음 (반지름이면 확정 표기를 {key}로 고치세요)']
    if match[1] != key[1]:
        reasons.append(f'기호 {match[0]!r}는 {key}의 OCR 오독으로 봄: 도면 확인 필요')
    if entry.get('key_misread'):
        reasons.append(f'범례의 {key} 글자가 OCR에서 다르게 읽힘: 도면 확인 필요')
    if entry.get('raw'):
        reasons.append(f'범례 값 {entry["raw"]!r}를 {entry["text"]}로 읽음 (1을 l 등으로 읽은 OCR 오독 보정): 도면과 대조하세요')
    reasons.append('합격 기준은 관리자가 지정 (도면에서 임의로 만들지 않음)')
    item['review_reasons'] = reasons
    item['requires_review'] = True
SIGNED = r'[+-]\d+(?:\.\d+)?'
# 공차 한쪽 값: 부호가 있는 숫자 (+0.08, -0.16, OCR이 앞자리 0을 빼먹은 +.08) 또는 부호 없는 0.
# 부호 없는 0 이 아닌 값(0.07)은 상·하한 구분이 불가능해 읽지 않는다.
DEVIATION = r'(?:[+-](?:\d+(?:\.\d+)?|\.\d+)|0(?:\.0+)?)'


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
    rough = re.fullmatch(rf'Ra\s*({ROUGH_NUMBER})', text)
    if rough:
        result.update(feature_type='SURFACE', measurement_characteristic='SURFACE_ROUGHNESS',
                      unit='µm', surface_roughness=roughness_text(rough[1]))
        result['review_reasons'].append('표면 거칠기: 합격 기준은 관리자가 지정 (도면에서 임의로 만들지 않음)')
        return result
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
        # 공차 표기: ±0.05 / +0.02/-0.01 / (+0.08/0) 괄호 / 0 은 부호 생략 가능
        pattern = (prefix + rf'({NUMBER})'
                   rf'(?:\s*±\s*({NUMBER})'
                   rf'|\s*\(\s*({DEVIATION})\s*/\s*({DEVIATION})\s*\)'
                   rf'|\s*({DEVIATION})\s*/\s*({DEVIATION}))?')
    match = re.fullmatch(pattern, text)
    if not match:
        result['tol_type'] = 'UNKNOWN'
        result['review_reasons'].append('깨졌거나 지원하지 않는 표기: 원문 확인 전 수치 확정 금지')
        return result
    nominal = float(match[1])
    result['nominal_value'] = nominal
    if match[2]:
        upper, lower = float(match[2]), -float(match[2])
    elif match[3] or match[5]:
        # 괄호 표기(3·4번 그룹)와 괄호 없는 표기(5·6번 그룹) 중 하나
        upper = float(match[3] or match[5])
        lower = float(match[4] or match[6])
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


SCALE_VALUE_RE = re.compile(r'\d+(?:\.\d+)?\s*:\s*\d+(?:\.\d+)?')


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
    # 라벨 칸(SCALE / SHEET SIZE 두 줄)과 값 칸('1:20, A3')의 세로 위치가 어긋나면 서로 다른 줄로 갈라진다.
    # 라벨만 있는 SCALE 줄 바로 다음 줄이 '1:20' 모양일 때만 그 줄을 축척으로 읽는다.
    if 'drawing_scale' not in fields:
        for before, line in zip(lines, lines[1:]):
            if re.fullmatch(r'SCALE', before.strip(), re.I) and SCALE_VALUE_RE.match(line.strip()):
                fields['drawing_scale'] = line.strip(); break
    # 축척 칸에 용지 크기가 함께 읽힌 경우('1:20, A3') 비율 부분만 쓴다. 비율 모양이 아니면 원문 그대로 둔다.
    found = SCALE_VALUE_RE.match(fields.get('drawing_scale', ''))
    if found:
        fields['drawing_scale'] = re.sub(r'\s+', '', found[0])
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
    legend = roughness_legend(title)
    unit = fields.get('unit','').lower() or None
    doc=dict(schema_version='1.1', drawing_id=drawing_id, **fields,
             material_normalized=None, title_table_raw=title, table_cells=tables,
             review_status='unreviewed', review_reasons=['자동 OCR 결과: 원도면 대조·검수 필요'],
             image=dict(file=image_file, width_px=width,height_px=height,dpi=200,
                        coordinate_origin='top-left',coordinate_anchor='text_center',coordinate_status='FRAME_OFFSET_APPLIED'),items=[])
    doc['unit']=unit
    if legend:
        doc['roughness_legend']={key: value['text'] for key, value in legend.items()}
    for category, entries in [('DIMENSION',dimensions),('GDT',gdts)]:
        for n,raw,x,y in entries:
            original={'x':x,'y':y}
            if category=='DIMENSION': x+=ox;y+=oy
            if not (isinstance(x,(int,float)) and isinstance(y,(int,float)) and 0<=x<width and 0<=y<height):
                raise ValueError(f'{category}_{n:03d}: 이미지 범위 밖 좌표 {x},{y}')
            item=dict(id=f'{category}_{n:03d}',category=category,raw_text=raw,
                      position={'x':x,'y':y},original_position=original)
            if category=='DIMENSION':
                item.update(parse_dimension(raw,unit))
                apply_roughness_legend(item, legend)
            else:item.update(feature_type='UNKNOWN',tol_type='UNKNOWN',
                measurement_characteristic='GEOMETRIC_TOLERANCE',requires_review=True,
                review_reasons=['기하공차 원문·데이텀·공차역 확인 필요'])
            if unit is None:
                item['requires_review']=True;item['review_reasons'].append('단위 확인 필요')
            doc['items'].append(item)
    if not doc['items']:raise ValueError('추출된 측정항목이 없습니다.')
    doc['item_count']=len(doc['items'])
    return doc
