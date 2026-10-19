"""표제란(TITLE / TABLE) 파싱. 파이썬 표준 라이브러리만 사용.

입력: OCR TXT 의 `table N: ...` 줄 뒤쪽 내용 (여러 개면 리스트로).
  - 신버전: [{'text': 'PART', 'left': 1479, 'top': 959, 'width': 79, 'height': 25}, ...]
            단어마다 좌표가 있음 → 같은 행(top이 비슷한 것)끼리 묶어서 읽는다.
  - 구버전: PART NAME PISTON ROD PART NO. PR-04 MATERIAL $US304 ...   (한 줄 문자열)

방식: 라벨(PART NAME, PART NO., MATERIAL, SCALE ...)을 찾고,
      "라벨 뒤 ~ 다음 라벨 전" 단어를 그 라벨의 값으로 본다. (같은 행 안에서만)
      그래서 라벨 순서가 도면마다 달라도, 칸 하나가 비어 있어도 동작한다.

원칙: 값은 OCR 원문 그대로 둔다. 의심스러우면 고치지 않고 review_reasons 에 이유를 적는다.
"""
import ast
import re
from statistics import median

# 표준 이름 -> 라벨로 인정할 단어열들 (대문자, 끝의 . : 는 무시)
LABELS = {
    'part_name': [('PART', 'NAME')],
    'part_no': [('PART', 'NO'), ('PART', 'NUMBER'), ('PART', 'NUM')],
    'material': [('MATERIAL',)],
    'quantity': [('QTY',), ('QUANTITY',)],
    'scale': [('SCALE',)],
    'unit': [('UNIT',), ('UNITS',)],
    'projection': [('PROJECTION',)],
    'sheet_size': [('SHEET', 'SIZE')],
    'date': [('DATE',)],
    'drawn': [('DRAWN', 'BY'), ('DRAWN',)],      # 구버전 도면은 DRAWN 뒤에 날짜가 옴
    'operator': [('OPERATOR',)],
}
REQUIRED = ('part_name', 'part_no', 'material', 'scale', 'unit')
LABEL_KO = {'part_name': 'PART NAME', 'part_no': 'PART NO.', 'material': 'MATERIAL',
            'scale': 'SCALE', 'unit': 'UNIT'}

# 긴 라벨이 먼저 맞도록 (DRAWN BY 가 DRAWN 보다 먼저)
_PATTERNS = sorted(((seq, key) for key, seqs in LABELS.items() for seq in seqs),
                   key=lambda p: -len(p[0]))

SCALE_RE = re.compile(r'\d+(?:\.\d+)?\s*:\s*\d+(?:\.\d+)?')
DATE_RE = re.compile(r'(\d{4})\s*[-./]\s*(\d{1,2})\s*[-./]\s*(\d{1,2})')
UNIT_MAP = {'MM': 'mm', 'MILLIMETER': 'mm', 'MILLIMETERS': 'mm',
            'IN': 'inch', 'INCH': 'inch', 'INCHES': 'inch'}


def _norm(word):
    return word.upper().rstrip('.:')


def _load_words(raw):
    """`table N:` 뒤 내용 -> [{'text','left','top','width','height'}]. 좌표 없으면 left/top 이 None."""
    raw = raw.strip()
    if raw.startswith('['):
        try:
            data = ast.literal_eval(raw)
        except (ValueError, SyntaxError):
            data = None
        if isinstance(data, list) and data and all(isinstance(w, dict) and 'text' in w for w in data):
            return [dict(text=str(w['text']), left=w.get('left'), top=w.get('top'),
                         width=w.get('width') or 0, height=w.get('height') or 0) for w in data]
    return [dict(text=t, left=None, top=None, width=0, height=0) for t in raw.split()]


def _group_rows(words):
    """top 이 비슷한 단어끼리 한 행으로 묶고 왼쪽→오른쪽 정렬. 좌표 없으면 전체가 한 행."""
    if not words or any(w['top'] is None or w['left'] is None for w in words):
        return [list(words)] if words else []
    heights = [w['height'] for w in words if w['height']]
    tolerance = 0.6 * (median(heights) if heights else 20)
    rows = []
    for w in sorted(words, key=lambda w: (w['top'] + w['height'] / 2, w['left'])):
        center = w['top'] + w['height'] / 2
        if rows and abs(center - rows[-1]['center']) <= tolerance:
            rows[-1]['words'].append(w)
            rows[-1]['center'] = sum(x['top'] + x['height'] / 2 for x in rows[-1]['words']) / len(rows[-1]['words'])
        else:
            rows.append(dict(center=center, words=[w]))
    return [sorted(r['words'], key=lambda w: w['left']) for r in rows]


def _split_row(row):
    """한 행을 [(라벨키, [값 단어...]), ...] 로 나눈다. 값이 없는 라벨은 빈 리스트."""
    norms = [_norm(w['text']) for w in row]
    found, i = [], 0
    while i < len(row):
        hit = next(((seq, key) for seq, key in _PATTERNS if tuple(norms[i:i + len(seq)]) == seq), None)
        if hit:
            found.append((hit[1], i, i + len(hit[0])))
            i += len(hit[0])
        else:
            i += 1
    out = []
    for n, (key, _, end) in enumerate(found):
        stop = found[n + 1][1] if n + 1 < len(found) else len(row)
        out.append((key, row[end:stop]))
    return out


def extract_fields(table_raws):
    """표 원문 -> (필드 dict {표준이름: 원문 값 문자열}, 행 텍스트 목록)"""
    if isinstance(table_raws, str):
        table_raws = [table_raws]
    fields, row_texts = {}, []
    for raw in table_raws:
        for row in _group_rows(_load_words(raw)):
            row_texts.append(' '.join(w['text'] for w in row))
            for key, value_words in _split_row(row):
                value = ' '.join(w['text'] for w in value_words).strip()
                if value and key not in fields:          # 같은 라벨이 또 나오면 처음 값 유지
                    fields[key] = value
    return fields, row_texts


def _normalize_date(value):
    m = DATE_RE.fullmatch(value.strip())
    if not m:
        return None
    y, mo, d = (int(g) for g in m.groups())
    return f'{y:04d}-{mo:02d}-{d:02d}' if 1 <= mo <= 12 and 1 <= d <= 31 else None


def parse_title_block(table_raws):
    """표제란 -> 메타데이터 필드 dict. 못 찾은 값은 None, 의심 사유는 review_reasons."""
    fields, row_texts = extract_fields(table_raws)
    reasons = []

    part_name = fields.get('part_name')
    part_no = fields.get('part_no')
    material = fields.get('material')

    # 수량
    quantity = None
    if 'quantity' in fields:
        if fields['quantity'].isdigit():
            quantity = int(fields['quantity'])
        else:
            reasons.append(f"QTY 값 '{fields['quantity']}' 을 숫자로 읽지 못함: 원도면 확인 필요")

    # 척도
    scale = fields.get('scale')
    if scale is not None:
        if SCALE_RE.fullmatch(scale):
            scale = re.sub(r'\s*:\s*', ':', scale)
        else:
            reasons.append(f"SCALE 값 '{scale}' 이 비율(예: 1:1, 1.5:1) 형식이 아님: 원도면 확인 필요")

    # 단위 (OCR은 MM 대문자로 나올 수 있어 소문자 표기로 통일, 원문은 unit_raw 에 보존)
    unit_raw = fields.get('unit')
    unit = None
    if unit_raw is not None:
        unit = UNIT_MAP.get(unit_raw.upper().rstrip('.'))
        if unit is None:
            unit = unit_raw
            reasons.append(f"UNIT 값 '{unit_raw}' 은 알려진 단위(mm, inch)가 아님: 원도면 확인 필요")

    # 날짜: DATE 라벨 우선, 없으면 구버전의 DRAWN 뒤 날짜
    drawn_date = None
    for key in ('date', 'drawn'):
        if key in fields:
            drawn_date = _normalize_date(fields[key])
            if drawn_date:
                break
    if drawn_date is None and ('date' in fields or 'drawn' in fields):
        reasons.append(f"날짜 '{fields.get('date') or fields.get('drawn')}' 을 YYYY-MM-DD 로 읽지 못함: 원도면 확인 필요")

    # 작업자: OPERATOR, 또는 DRAWN BY (구버전 DRAWN 은 날짜 칸이므로 날짜가 아닐 때만)
    operator = fields.get('operator')
    if operator is None and 'drawn' in fields and _normalize_date(fields['drawn']) is None:
        operator = fields['drawn']

    # 재질: 원문 그대로 보관, 자동 교정·확정 안 함
    if material is not None:
        if part_name and material.upper() == part_name.upper():
            reasons.append(f"MATERIAL 칸의 값 '{material}' 이 PART NAME 과 같음: 실제 재질인지 원도면 확인 필요 (자동 확정 안 함)")
        elif not re.search(r'\d', material) and len(material.split()) > 1:
            reasons.append(f"MATERIAL 값 '{material}' 이 재질 표기처럼 보이지 않음: 원도면 확인 필요")
        elif re.search(r'[^A-Za-z0-9\-_/. ]', material):
            reasons.append(f"재질 '{material}' 은 OCR 원문이며 특수문자가 있어 SUS304 등으로 자동 교정하지 않음")

    for key in REQUIRED:
        if key not in fields:
            reasons.append(f'표제란에서 {LABEL_KO[key]} 값을 찾지 못함: 원도면 확인 필요')

    return dict(
        part_name=part_name, part_no=part_no,
        material_raw=material, material_normalized=None,
        quantity=quantity, drawing_scale=scale,
        unit=unit, unit_raw=unit_raw,
        projection=fields.get('projection'),
        sheet_size=fields.get('sheet_size'),
        drawn_date=drawn_date, operator=operator,
        title_table_raw=' | '.join(row_texts),
        review_reasons=reasons,
    )


if __name__ == '__main__':
    # 빠른 확인:  python titleblock_metadata.py reviewed/HDH_63_05_reviewed.txt
    import json
    import sys
    from pathlib import Path
    text = Path(sys.argv[1]).read_text(encoding='utf-8-sig')
    tables = re.findall(r'^\s*table\s+\d+\s*:\s*(.+?)\s*$', text, re.M | re.I)
    print(json.dumps(parse_title_block(tables), ensure_ascii=False, indent=2))
