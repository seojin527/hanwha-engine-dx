"""기하공차(GD&T) 구조화. 파이썬 표준 라이브러리만 사용.

OCR TXT 의 기하공차 한 칸(프레임)은 여러 줄일 수 있다:
    01. ['⏥|0.048|A\\n⫽|0.022', (868, 854)]      ← 프레임 1개, 줄 2개
줄 하나는 `기호|공차값|데이텀|데이텀...` 형식이다:
    ⏥|0.048|A   →  평면도, 공차값 0.048, 데이텀 A

이 모듈이 하는 일
  1. 프레임 줄을 파이썬 리터럴로 읽어서 \\n 을 진짜 줄바꿈으로 바꾼다.
  2. 줄마다 gdt_type / tolerance_value / datum_references 로 나눈다.
  3. 해석이 애매하면 값을 지어내지 않고 requires_review + 이유를 남긴다.

데이텀: datum_references 는 그 줄에 적힌 것만, frame_datum_references 는 같은 프레임 전체.
        (데이텀을 첫 줄에만 쓰는 도면이 있어서, 그 줄에 적용되는지는 도면을 봐야 한다)
한계: 데이텀은 글자(A, B)만 안다. A 가 도면의 어느 면인지는 도면을 봐야 한다.
"""
import ast
import re

# eDOCr2 기하공차 기호 (backend/ocr_review/review.py 의 SYMBOL_NAMES 와 같은 집합)
# 기호 -> (gdt_type, 한글 이름, 분류, 데이텀 필요 여부)  필요 여부: 'no' | 'yes' | 'maybe'
SYMBOLS = {
    '⏤': ('STRAIGHTNESS', '진직도', 'FORM', 'no'),
    '⏥': ('FLATNESS', '평면도', 'FORM', 'no'),
    '○': ('CIRCULARITY', '진원도', 'FORM', 'no'),
    '⌭': ('CYLINDRICITY', '원통도', 'FORM', 'no'),
    '⌒': ('PROFILE_OF_LINE', '선의 윤곽도', 'PROFILE', 'maybe'),
    '⌓': ('PROFILE_OF_SURFACE', '면의 윤곽도', 'PROFILE', 'maybe'),
    '⏊': ('PERPENDICULARITY', '직각도', 'ORIENTATION', 'yes'),
    '⊥': ('PERPENDICULARITY', '직각도', 'ORIENTATION', 'yes'),
    '∠': ('ANGULARITY', '경사도', 'ORIENTATION', 'yes'),
    '⫽': ('PARALLELISM', '평행도', 'ORIENTATION', 'yes'),
    '⌖': ('POSITION', '위치도', 'LOCATION', 'maybe'),
    '◎': ('CONCENTRICITY', '동심도', 'LOCATION', 'yes'),
    '⌯': ('SYMMETRY', '대칭도', 'LOCATION', 'yes'),
    '↗': ('CIRCULAR_RUNOUT', '원주 흔들림', 'RUNOUT', 'yes'),
    '⌰': ('TOTAL_RUNOUT', '온 흔들림', 'RUNOUT', 'yes'),
}

VALUE_RE = re.compile(r'(?P<dia>[⌀Ø∅])?\s*(?P<num>\d+(?:\.\d+)?|\.\d+)(?P<mod>[ⓂⓁ])?')
DATUM_CELL_RE = re.compile(r'[A-Z](?:\s*-\s*[A-Z])*|[A-Z]{2,3}')
NUMPY_SCALAR_RE = re.compile(r'np\.\w+\((-?[\d.eE+]+)\)')   # numpy 2 표기: np.int64(825)


def parse_frame_line(body):
    """`['⏥|0.048|A\\n⫽|0.022', (868, 854)]` -> (text, x, y). 읽을 수 없으면 ValueError."""
    try:
        value = ast.literal_eval(NUMPY_SCALAR_RE.sub(r'\1', body.strip()))
        text, pos = value[0], value[1]
        if not isinstance(text, str):
            raise ValueError
        return text, int(pos[0]), int(pos[1])
    except (ValueError, SyntaxError, IndexError, TypeError):
        # 마지막 수단: 예전 정규식 방식 (따옴표 한 종류만, \\n 은 직접 변환)
        m = re.fullmatch(r"\[\s*'(.+)',\s*[\[(]\s*(-?\d+)\s*,\s*(-?\d+)\s*[\])]\s*\]", body.strip())
        if not m:
            raise ValueError(f'기하공차 줄을 읽을 수 없음: {body[:60]}')
        return m[1].replace('\\n', '\n'), int(m[2]), int(m[3])


def _find_symbol(cell):
    """첫 칸에서 알려진 기호를 찾는다. (기호, 기호 외 남은 글자)"""
    for ch in cell:
        if ch in SYMBOLS:
            return ch, cell.replace(ch, '', 1).strip()
    return None, cell.strip()


def parse_gdt_row(row):
    """기하공차 한 줄 -> 구조화 dict."""
    out = dict(raw_text=row, gdt_symbol=None, gdt_type='UNKNOWN', gdt_name_ko=None,
               gdt_category='UNKNOWN', tolerance_value=None, tolerance_zone=None,
               material_condition=None, datum_references=[],
               requires_review=False, review_reasons=[])
    reasons = out['review_reasons']
    cells = [c.strip() for c in row.split('|')]

    symbol, leftover = _find_symbol(cells[0])
    if symbol is None:
        reasons.append(f"기하공차 기호 '{cells[0]}' 를 알 수 없음: 종류 확정 불가")
        need_datum = 'maybe'
    else:
        gtype, name, category, need_datum = SYMBOLS[symbol]
        out.update(gdt_symbol=symbol, gdt_type=gtype, gdt_name_ko=name, gdt_category=category)
        if leftover:
            reasons.append(f"기호 칸에 기호 외 글자 '{leftover}' 가 섞여 있음: 원도면 확인 필요")

    # 공차값
    if len(cells) < 2 or not cells[1]:
        reasons.append('공차값 칸이 비어 있음')
    else:
        m = VALUE_RE.fullmatch(cells[1])
        if not m:
            reasons.append(f"공차값 '{cells[1]}' 을 숫자로 읽지 못함 (글자 깨짐 가능): 값 확정 금지")
        else:
            out['tolerance_value'] = float(m['num'])
            out['tolerance_zone'] = 'DIAMETER' if m['dia'] else 'WIDTH'
            out['material_condition'] = {'Ⓜ': 'MMC', 'Ⓛ': 'LMC'}.get(m['mod'])
            if out['tolerance_value'] == 0:
                reasons.append('공차값이 0: 원도면 확인 필요')

    # 데이텀: 칸마다 하나('A') 또는 붙여 쓴 형태('AB'), 'A-B' 도 허용
    for cell in cells[2:]:
        if not cell:
            continue
        if not DATUM_CELL_RE.fullmatch(cell):
            reasons.append(f"데이텀 '{cell}' 형식을 읽지 못함: 원도면 확인 필요")
            continue
        out['datum_references'].extend(re.findall(r'[A-Z]', cell))

    datums = out['datum_references']
    if len(set(datums)) != len(datums):
        reasons.append(f"데이텀 {datums} 에 같은 글자가 반복됨: 원도면 확인 필요")
    # 데이텀이 필요한지/불필요한지는 줄 하나만 보고 판단하지 않는다 (parse_gdt_frame 에서 프레임 단위로 확인)

    out['requires_review'] = bool(reasons)
    return out


def parse_gdt_frame(text):
    """프레임 텍스트(여러 줄) -> 줄별 구조화 리스트."""
    rows = [parse_gdt_row(r.strip()) for r in text.split('\n') if r.strip()]
    # 여러 줄 프레임은 데이텀을 첫 줄에만 적는 경우가 많다 → 프레임 전체의 데이텀을 함께 기록
    frame_datums = []
    for r in rows:
        frame_datums += [d for d in r['datum_references'] if d not in frame_datums]
    for r in rows:
        r['frame_datum_references'] = list(frame_datums)
        needs = SYMBOLS.get(r['gdt_symbol'], (None, None, None, 'maybe'))[3]
        if needs == 'yes' and not frame_datums:
            r['review_reasons'].append(f"{r['gdt_name_ko']}는 데이텀이 필요한데 프레임 어디에서도 읽히지 않음: 원도면 확인 필요")
            r['requires_review'] = True
    return rows
