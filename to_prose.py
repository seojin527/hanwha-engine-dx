"""해석 TXT(practice.txt 형식) → 줄글(문장) TXT
사용법: python to_prose.py practice.txt
결과:   practice_줄글.txt  (한글 줄글 + English prose)
"""
import sys, re, os

src = sys.argv[1]
lines = open(src, encoding='utf-8').read().splitlines()

# ---------- 1. 읽기 ----------
items, sec, title_region = [], None, None
for i, ln in enumerate(lines):
    if ln.startswith('[ 치수'): sec = 'D'; continue
    if ln.startswith('[ 기하공차'): sec = 'G'; continue
    if ln.startswith('[ 표제란'): sec = 'T'; continue
    m = re.match(r'^\s*(\d+)\. \[(\d+), (\d+)\]\s+(.+?)\s*$', ln)
    if m and sec:
        ko = lines[i + 1].strip().lstrip('→').strip() if i + 1 < len(lines) else ''
        en = lines[i + 2].strip()[3:].strip() if i + 2 < len(lines) and lines[i + 2].strip().startswith('EN:') else ''
        items.append(dict(sec=sec, no=int(m[1]), x=int(m[2]), y=int(m[3]), raw=m[4], ko=ko, en=en))
note_general = any('일반공차' in ln and '표기가 없음' in ln for ln in lines)

dims = [it for it in items if it['sec'] == 'D']
gdts = [it for it in items if it['sec'] == 'G']
tbl = [it for it in items if it['sec'] == 'T']

# ---------- 2. 위치 말로 바꾸기 (도면 안 치수들 범위 기준) ----------
view = dims + gdts
xs = [it['x'] for it in view] or [0]; ys = [it['y'] for it in view] or [0]
def where(it):
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    rx = (it['x'] - x0) / ((x1 - x0) or 1); ry = (it['y'] - y0) / ((y1 - y0) or 1)
    h = '왼쪽' if rx < 0.33 else '오른쪽' if rx > 0.67 else '가운데'
    v = '위' if ry < 0.33 else '아래' if ry > 0.67 else ''
    he = 'left' if rx < 0.33 else 'right' if rx > 0.67 else 'center'
    ve = 'upper' if ry < 0.33 else 'lower' if ry > 0.67 else ''
    return (f'{h} {v}'.strip(), f'{ve} {he}'.strip())

def josa(word, a, b):  # 받침 있으면 a, 없으면 b
    ch = re.sub(r"[\s'\")\]]+$", '', word)[-1:]
    if '가' <= ch <= '힣': return a if (ord(ch) - 0xAC00) % 28 else b
    return a if ch in '013678LMNR' else b

# ---------- 3. 해석 조각 → 문장 ----------
def ko_sentence(it):
    p = [s.strip() for s in re.split(r',\s*(?![^()]*\))', it['ko'])]
    out = []
    for s in p:
        if (m := re.match(r'^(지름|길이|반지름|두께) ([\d.]+)$', s)):
            out.append(f'{m[1]} {m[2]}mm 치수다.')
        elif (m := re.match(r'^양측 공차 ±([\d.]+)$', s)):
            out.append(f'공차는 위아래로 같은 ±{m[1]}mm다.')
        elif (m := re.match(r'^위 공차 ([+\-\d.]+) / 아래 공차 ([+\-\d.]+)$', s)):
            out.append(f'위 공차는 {m[1]}mm, 아래 공차는 {m[2]}mm다.')
        elif (m := re.match(r'^합격 범위 ([\d.]+) ~ ([\d.]+)$', s)):
            out.append(f'따라서 {m[1]}mm 이상 {m[2]}mm 이하이면 합격이다.')
        elif s.startswith('공차 미기입'):
            out.append('도면에 공차가 따로 적혀 있지 않아 일반공차를 적용해야 한다.')
        elif (m := re.match(r'^모따기 ([\d.]+) \(45°\)$', s)):
            out.append(f'모서리를 45°로 {m[1]}mm 깎는 모따기다.')
        elif (m := re.match(r'^미터 (보통|가는) 나사$', s)):
            out.append(f'미터 {m[1]} 나사다.')
        elif (m := re.match(r'^호칭 지름 ([\d.]+)(?: \(피치 생략 → 보통 나사 피치 ([\d.]+)\))?$', s)):
            out.append(f'호칭 지름은 {m[1]}mm' + (f'이고, 피치가 생략되어 보통 나사 피치 {m[2]}mm로 본다.' if m[2] else '다.'))
        elif (m := re.match(r'^피치 ([\d.]+)$', s)):
            out.append(f'피치는 {m[1]}mm다.')
        elif s.startswith('나사 등급 표기 없음'):
            out.append('나사 등급이 적혀 있지 않으므로 나사 게이지(통과·정지)로 판정한다.')
        elif (m := re.match(r'^끼워맞춤 공차 표기 (\S+) \((구멍|축), IT(\d+)급\)(.*)$', s)):
            out.append(f'끼워맞춤 공차 {m[1]}가 적용된 {m[2]}이며, 정밀도는 IT{m[3]}급이다.' + (f' {m[4].strip(" ()")}.' if m[4].strip() else ''))
        elif (m := re.match(r'^(\d+)개$', s)):
            out.append(f'같은 형상이 {m[1]}개 있다.')
        elif (m := re.match(r'^(.+?) ([\d.]+)( \(지름 공차역\))? 이내$', s)):
            out.append(f'{m[1]} 공차로, 오차가 {"지름 " if m[3] else ""}{m[2]}mm 이내여야 한다.')
        elif s.startswith('기준 없음'):
            out.append('기준(데이텀) 없이 모양 자체만 보는 공차다.')
        elif (m := re.match(r'^기준: (.+)$', s)):
            out.append(f'{m[1]}{josa(m[1], "을", "를")} 기준으로 잰다.')
        elif s.startswith('괄호'):
            out.append('괄호로 묶인 참고 치수라 검사 대상은 아니다.')
        elif s:
            out.append(s.rstrip('.') + '.')
    return ' '.join(out)

def en_sentence(it):
    s = it['en']
    s = s.replace(' → ', ': ')
    s = re.sub(r', accept ([\d.]+) to ([\d.]+)', r'; accepted if between \1 and \2', s)
    return s[0].upper() + s[1:] + ('' if s.endswith('.') else '.')

# 같은 표기 여러 개 찾기
same = {}
for it in view: same.setdefault(it['raw'], []).append(it)

# ---------- 4. 문단 만들기 ----------
KO, EN = [], []
tb = {re.split(r'\s*\|\s*', it['raw'])[0]: it for it in tbl}
def tv(k): return re.split(r'\s*\|\s*', tb[k]['raw'], maxsplit=1)[1] if k in tb else None
def tko(k): return tb[k]['ko'].split(':', 1)[1].strip() if k in tb else None

if tbl:
    s = []
    if tko('PART NAME'): s.append(f"이 도면은 {tko('PART NAME')}" + (f"(부품 번호 {tv('PART NO.')})" if tv('PART NO.') else '') + '의 도면이다.')
    if tko('MATERIAL'): s.append(f"재질은 {tko('MATERIAL')}이고, 수량은 {tv('QTY') or '-'}개다.")
    if tv('SCALE'): s.append(f"척도는 {tko('SCALE')}, 단위는 {tv('UNIT') or 'mm'}, 투상법은 {tko('PROJECTION') or '-'}이다.")
    if tv('DRAWN'): s.append(f"작성일은 {tv('DRAWN')}이다.")
    s.append(f'도면에서 치수 {len(dims)}개와 기하공차 {len(gdts)}개를 읽었다.')
    if note_general: s.append('표제란에 일반공차 표기가 없어서, 공차가 적히지 않은 치수의 허용 범위는 설계자에게 확인해야 한다.')
    KO.append('[도면 개요]\n' + ' '.join(s))
    e = []
    if tv('PART NAME'): e.append(f"This drawing is for {tv('PART NAME').title()}" + (f" (part no. {tv('PART NO.')})" if tv('PART NO.') else '') + '.')
    if tv('MATERIAL'): e.append(f"Material is {tv('MATERIAL')}, quantity {tv('QTY') or '-'}.")
    if tv('SCALE'): e.append(f"Scale {tv('SCALE')}, unit {tv('UNIT') or 'mm'}, {tv('PROJECTION') or '-'} projection.")
    if tv('DRAWN'): e.append(f"Drawn on {tv('DRAWN')}.")
    e.append(f'{len(dims)} dimensions and {len(gdts)} geometric tolerances were read.')
    if note_general: e.append('No general tolerance is given in the title block, so untoleranced dimensions must be confirmed with the designer.')
    EN.append('[Drawing overview]\n' + ' '.join(e))

for title_ko, title_en, group in [('치수', 'Dimensions', dims), ('기하공차', 'Geometric tolerances', gdts)]:
    if not group: continue
    KO.append(f'[{title_ko}]'); EN.append(f'[{title_en}]')
    for it in group:
        wk, we = where(it)
        dup = same.get(it['raw'], [])
        dup_ko = f" 같은 표기가 도면에 {len(dup)}곳 있다." if len(dup) > 1 else ''
        dup_en = f" The same callout appears {len(dup)} times on the drawing." if len(dup) > 1 else ''
        q = f"'{it['raw']}'"
        KO.append(f"{it['no']}. 도면 {wk}[{it['x']}, {it['y']}]의 {q}{josa(it['raw'], '은', '는')} {ko_sentence(it)}{dup_ko}")
        EN.append(f"{it['no']}. {q} at the {we} of the drawing [{it['x']}, {it['y']}]: {en_sentence(it)}{dup_en}")

name = os.path.splitext(src)[0]
out = f'{name}_줄글.txt'
text = '\n\n'.join(KO) + '\n\n' + '=' * 80 + '\n\n' + '\n\n'.join(EN) + '\n'
text = re.sub(r'\n(\d+\. )', r'\n\1', text)
open(out, 'w', encoding='utf-8').write(text)
print(text)
print('저장:', out)
