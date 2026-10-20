"""eDOCr2 결과 TXT 읽기/고치기.

원칙: 원본 TXT의 줄을 최대한 그대로 두고, 바뀐 줄만 고친다.
그래서 수정이 test_drawing.py가 만든 형식(구버전/신버전 모두)을 그대로 유지한다.

지원하는 형식 예
    [ DIMENSIONS ]
    No   Text                        Position (x, y)
    1    C2                          [156, 135]
    Detected dimensions : 17

    [ GD&T ]
    01. ['⏥|0.035|A\\n⫽|0.012', (868, 854)]
    Detected GD&T : 5

    [ OTHER TEXT ]
    01. ['RS', [1272, 610]]

    [ TITLE / TABLE ]
      table 1: [{'text': 'PART', 'left': 1479, ...}]

    Image size : 2339 x 1654 px, position = text center, origin top-left
"""
from __future__ import annotations

import ast
import re
from dataclasses import dataclass, field
from typing import List, Optional, Tuple

SECTION_RE = re.compile(r"^\s*\[\s*(.+?)\s*\]\s*$")
DIM_RE = re.compile(r"^\s*(\d+)\s+(.+?)\s+(\[[^\[\]]*\]|\([^()]*\))\s*$")
ENTRY_RE = re.compile(r"^\s*(\d+)\.\s+(.*\S)\s*$")
TABLE_RE = re.compile(r"^\s*table\s+(\d+)\s*:\s*(.*)$", re.I)
COUNT_RE = re.compile(r"^\s*Detected\s+(dimensions|GD&T|other text)\s*:\s*(\d+)\s*$", re.I)
SIZE_RE = re.compile(r"^\s*Image size\s*:\s*(\d+)\s*x\s*(\d+)\s*px", re.I)
DPI_RE = re.compile(r"(\d+)\s*dpi", re.I)
FRAME_RE = re.compile(r"^\s*Frame offset\s*:\s*(-?\d+)\s*,\s*(-?\d+)", re.I)
NUMPY_SCALAR_RE = re.compile(r"np\.\w+\((-?[\d.eE+]+)\)")       # numpy 2: np.int64(825)
NUMPY_ARRAY_RE = re.compile(r"array\((\[[^\]]*\])(?:,\s*dtype=[\w.]+)?\)")


class TxtFormatError(ValueError):
    """TXT를 읽을 수 없을 때."""


def _literal(text: str):
    """eDOCr2가 print한 파이썬 리스트를 읽는다 (numpy 표기도 허용)."""
    cleaned = NUMPY_SCALAR_RE.sub(r"\1", text)
    cleaned = NUMPY_ARRAY_RE.sub(r"\1", cleaned)
    return ast.literal_eval(cleaned)


def _xy(value) -> Tuple[int, int]:
    nums = re.findall(r"-?\d+(?:\.\d+)?", str(value))
    if len(nums) < 2:
        raise TxtFormatError(f"좌표를 읽을 수 없음: {value!r}")
    return int(round(float(nums[0]))), int(round(float(nums[1])))


@dataclass
class Dimension:
    no: int
    text: str
    x: int
    y: int
    line: int


@dataclass
class GdtEntry:
    no: int
    text: str            # 여러 줄 틀은 '\n'으로 이어짐: '⏥|0.035|A\n⫽|0.012'
    x: int               # 기하공차 틀의 왼쪽 위 (전체 이미지 기준)
    y: int
    line: int
    literal: str         # 원본 줄에 적힌 텍스트 부분 그대로: "'⏥|0.035|A\\n⫽|0.012'"

    @property
    def rows(self) -> List[str]:
        return self.text.split("\n")


@dataclass
class OtherEntry:
    no: Optional[int]
    text: str
    x: Optional[int]
    y: Optional[int]
    line: int


@dataclass
class TableEntry:
    no: int
    raw: str
    line: int

    def words(self) -> List[dict]:
        try:
            data = _literal(self.raw)
        except (ValueError, SyntaxError):
            return []
        return [w for w in data if isinstance(w, dict)] if isinstance(data, list) else []


@dataclass
class OcrTxt:
    lines: List[str]
    newline: str = "\n"
    ends_with_newline: bool = True
    dims: List[Dimension] = field(default_factory=list)
    gdt: List[GdtEntry] = field(default_factory=list)
    other: List[OtherEntry] = field(default_factory=list)
    tables: List[TableEntry] = field(default_factory=list)
    width: Optional[int] = None
    height: Optional[int] = None
    dpi: Optional[int] = None
    frame_offset: Optional[Tuple[int, int]] = None
    size_line: Optional[int] = None
    dim_header_line: Optional[int] = None
    dim_section_line: Optional[int] = None
    count_lines: dict = field(default_factory=dict)
    warnings: List[str] = field(default_factory=list)

    # ------------------------------------------------------------ 읽기
    @classmethod
    def parse(cls, text: str) -> "OcrTxt":
        if text.startswith("﻿"):
            text = text[1:]
        newline = "\r\n" if "\r\n" in text else "\n"
        ends = text.endswith("\n")
        lines = text.replace("\r\n", "\n").split("\n")
        if ends:
            lines = lines[:-1]
        doc = cls(lines=lines, newline=newline, ends_with_newline=ends)
        doc._scan()
        if doc.dim_section_line is None:
            raise TxtFormatError("[ DIMENSIONS ] 구역이 없음: eDOCr2 결과 TXT가 맞는지 확인")
        return doc

    def _scan(self) -> None:
        section = None
        for i, line in enumerate(self.lines):
            head = SECTION_RE.match(line)
            if head:
                section = head.group(1).upper()
                if section == "DIMENSIONS":
                    self.dim_section_line = i
                continue
            count = COUNT_RE.match(line)
            if count:
                self.count_lines[count.group(1).lower()] = i
                continue
            size = SIZE_RE.match(line)
            if size:
                self.width, self.height = int(size.group(1)), int(size.group(2))
                dpi = DPI_RE.search(line)
                self.dpi = int(dpi.group(1)) if dpi else None
                self.size_line = i
                continue
            frame = FRAME_RE.match(line)
            if frame:
                self.frame_offset = (int(frame.group(1)), int(frame.group(2)))
                continue
            if not line.strip() or set(line.strip()) <= set("-=") :
                continue

            if section == "DIMENSIONS":
                if "Text" in line and "Position" in line:
                    self.dim_header_line = i
                    continue
                m = DIM_RE.match(line)
                if m:
                    x, y = _xy(m.group(3))
                    self.dims.append(Dimension(int(m.group(1)), m.group(2), x, y, i))
                else:
                    self.warnings.append(f"{i + 1}번째 줄 치수 형식 아님: {line.strip()[:60]}")
            elif section == "GD&T":
                m = ENTRY_RE.match(line)
                if not m:
                    if "No GD&T" not in line:
                        self.warnings.append(f"{i + 1}번째 줄 기하공차 형식 아님: {line.strip()[:60]}")
                    continue
                body = m.group(2)
                try:
                    value = _literal(body)
                    gtext, pos = value[0], value[1]
                    if not isinstance(gtext, str):
                        raise ValueError
                except (ValueError, SyntaxError, IndexError, TypeError):
                    self.warnings.append(f"{i + 1}번째 줄 기하공차를 읽을 수 없음: {body[:60]}")
                    continue
                literal = repr(gtext)
                if literal not in line:
                    self.warnings.append(f"{i + 1}번째 줄 기하공차 텍스트 위치를 찾지 못함 (수정 불가)")
                x, y = _xy(pos)
                self.gdt.append(GdtEntry(int(m.group(1)), gtext, x, y, i, literal))
            elif section == "OTHER TEXT":
                m = ENTRY_RE.match(line)
                body, no = (m.group(2), int(m.group(1))) if m else (line.strip(), None)
                try:
                    value = _literal(body)
                    x, y = _xy(value[1])
                    self.other.append(OtherEntry(no, str(value[0]), x, y, i))
                except Exception:  # noqa: BLE001 - 기타 글자는 읽기만 하므로 실패해도 원문 보존
                    self.other.append(OtherEntry(no, body, None, None, i))
            elif section and section.startswith("TITLE"):
                m = TABLE_RE.match(line)
                if m:
                    self.tables.append(TableEntry(int(m.group(1)), m.group(2), i))

    # ------------------------------------------------------------ 쓰기
    def text(self) -> str:
        out = self.newline.join(self.lines)
        return out + self.newline if self.ends_with_newline else out

    def set_gdt_text(self, entry: GdtEntry, new_text: str) -> None:
        line = self.lines[entry.line]
        if entry.literal not in line:
            raise TxtFormatError(f"기하공차 {entry.no:02d}번 줄을 고칠 수 없음 (원본 텍스트 위치 불명)")
        new_literal = repr(new_text)
        self.lines[entry.line] = line.replace(entry.literal, new_literal, 1)
        entry.text, entry.literal = new_text, new_literal

    def set_dimension_text(self, dim: Dimension, new_text: str) -> None:
        """치수 한 줄의 글자만 바꾼다 (번호·좌표·열 폭은 그대로)."""
        if "\n" in new_text or not new_text.strip():
            raise TxtFormatError("치수 텍스트가 비었거나 줄바꿈이 있음")
        line = self.lines[dim.line]
        m = re.match(r"^(\s*\d+\s+)(.+?)(\s+)(\[.*)$", line)
        if not m or m.group(2) != dim.text:
            raise TxtFormatError(f"치수 {dim.no}번 줄을 고칠 수 없음 (원본 형식 불명)")
        head, _, gap, pos = m.groups()
        width = len(dim.text) + len(gap)                      # 원래 좌표 열 위치 유지
        self.lines[dim.line] = head + new_text.ljust(max(width, len(new_text) + 1)) + pos
        dim.text = new_text

    def add_dimension(self, text: str, x: int, y: int) -> Dimension:
        if "\n" in text:
            raise TxtFormatError("치수 텍스트에 줄바꿈 불가")
        no = max([d.no for d in self.dims], default=0) + 1
        text_col, pos_col = self._dim_columns()
        cell_no = f"{no}".ljust(text_col)
        cell_text = text.ljust(max(pos_col - text_col, len(text) + 1))
        new_line = f"{cell_no}{cell_text}[{x}, {y}]"
        if self.dims:
            at = self.dims[-1].line + 1
        elif self.dim_header_line is not None:
            at = self.dim_header_line + 1
        else:
            at = self.dim_section_line + 1
        self._insert_line(at, new_line)
        dim = Dimension(no, text, x, y, at)
        self.dims.append(dim)
        self._set_count("dimensions", len(self.dims))
        return dim

    def ensure_dpi(self, dpi: int) -> bool:
        """Image size 줄에 dpi가 없으면 ' (PDF 200 dpi)'를 붙인다. 바꿨으면 True."""
        if self.size_line is None or self.dpi is not None:
            return False
        line = self.lines[self.size_line]
        self.lines[self.size_line] = re.sub(r"(\d+\s*px)", rf"\1 (PDF {dpi} dpi)", line, count=1)
        self.dpi = dpi
        return True

    # ------------------------------------------------------------ 내부
    def _dim_columns(self) -> Tuple[int, int]:
        if self.dim_header_line is not None:
            header = self.lines[self.dim_header_line]
            text_col = header.find("Recognized Text")
            if text_col < 0:
                text_col = header.find("Text")
            pos_col = header.find("Position")
            if 0 < text_col < pos_col:
                return text_col, pos_col
        return 5, 33  # 수정이 test_drawing.py 기본 폭: {i:<5}{text:<28}

    def _insert_line(self, at: int, new_line: str) -> None:
        self.lines.insert(at, new_line)
        for group in (self.dims, self.gdt, self.other, self.tables):
            for item in group:
                if item.line >= at:
                    item.line += 1
        for key, idx in list(self.count_lines.items()):
            if idx >= at:
                self.count_lines[key] = idx + 1
        for name in ("size_line", "dim_header_line"):
            idx = getattr(self, name)
            if idx is not None and idx >= at:
                setattr(self, name, idx + 1)

    def _set_count(self, key: str, value: int) -> None:
        idx = self.count_lines.get(key)
        if idx is None:
            return
        self.lines[idx] = re.sub(r"(:\s*)\d+", rf"\g<1>{value}", self.lines[idx], count=1)
