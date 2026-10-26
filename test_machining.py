"""부품제작 황삭·중삭·정삭: 템플릿 위치 맞추기, 단계 기준, 순서 잠금.

실행 (backend 폴더에서): python -m unittest tests.test_machining -v
"""
import sys
import unittest
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from machining_api import judge_allowance, match_template, stage_criteria, stage_status  # noqa: E402
from machining_templates import TEMPLATES, part_key_for  # noqa: E402

W, H = 2339, 1654


def document_from(template, shift=0.0, rename=None, drop_diameter=False):
    items = []
    for n, entry in enumerate(template["items"], start=1):
        text = (rename or {}).get(entry["key"], entry["text"])
        if drop_diameter:
            text = text.replace("Ø", "")
        items.append({
            "id": f"{'GDT' if entry['sig'] == 'G' else 'DIMENSION'}_{n:03d}",
            "category": "GDT" if entry["sig"] == "G" else "DIMENSION",
            "raw_text": text.replace(" ", "|") if entry["sig"] == "G" else text,
            "position": {"x": (entry["pos"][0] + shift) * W, "y": (entry["pos"][1] + shift) * H},
        })
    return {"image": {"width_px": W, "height_px": H}, "items": items}


class Matching(unittest.TestCase):
    def test_reference_drawings_match_every_item(self):
        for key, template in TEMPLATES.items():
            matched = match_template(document_from(template), template)
            self.assertEqual(len(matched), len(template["items"]), key)

    def test_same_shape_new_dimensions_small_shift(self):
        template = TEMPLATES["PR"]
        doc = document_from(template, shift=0.015, rename={"PR-D400": "Ø420"})
        matched = match_template(doc, template)
        self.assertEqual(len(matched), len(template["items"]))
        by_key = {entry["key"]: item_id for item_id, entry in matched.items()}
        self.assertEqual({i["id"]: i["raw_text"] for i in doc["items"]}[by_key["PR-D400"]], "Ø420")

    def test_dropped_diameter_symbol(self):
        template = TEMPLATES["CS"]
        self.assertEqual(len(match_template(document_from(template, drop_diameter=True), template)),
                         len(template["items"]))

    def test_part_names(self):
        self.assertEqual(part_key_for("피스톤 로드"), "PR")
        self.assertEqual(part_key_for("", "CRANK SHAFT"), "CS")
        self.assertIsNone(part_key_for("크로스헤드"))


class Criteria(unittest.TestCase):
    item = {"id": "D", "category": "DIMENSION", "measurement_mode": "numeric",
            "nominal_value": 680.0, "lower_limit": 679.2, "upper_limit": 680.8}

    def test_hole_targets_follow_the_drawing(self):
        stages = TEMPLATES["CR"]["items"][8]["stages"]          # 대단부 Ø680, 구멍
        self.assertEqual(stages, {"1": -4.0, "2": -0.5, "3": 0.0})
        rough = stage_criteria(self.item, stages, "1")
        self.assertEqual((rough["target"], rough["lower_limit"], rough["upper_limit"]), (676.0, 675.0, 677.0))
        mid = stage_criteria(self.item, stages, "2")
        self.assertEqual((mid["target"], mid["lower_limit"], mid["upper_limit"]), (679.5, 679.4, 679.6))
        final = stage_criteria(self.item, stages, "3")
        self.assertEqual((final["role"], final["lower_limit"]), ("final", 679.2))

    def test_new_nominal_moves_target(self):
        item = {**self.item, "nominal_value": 700.0}
        self.assertEqual(stage_criteria(item, {"1": -4.0}, "1")["target"], 696.0)

    def test_overcut_and_too_much_stock(self):
        hole = stage_criteria(self.item, {"1": -4.0}, "1")
        self.assertIn("과절삭", judge_allowance(hole, Decimal("680"), "황삭")[1])
        self.assertIn("너무 많", judge_allowance(hole, Decimal("670"), "황삭")[1])
        shaft = stage_criteria({**self.item, "nominal_value": 400.0}, {"1": 4.0}, "1")
        self.assertIn("과절삭", judge_allowance(shaft, Decimal("400"), "황삭")[1])

    def test_not_measured_stage(self):
        self.assertIsNone(stage_criteria(self.item, {"1": 0.0}, "3"))


class Gating(unittest.TestCase):
    plan = {"items": [
        {"item_id": "A", "stages": {"1": {"role": "finish"}, "2": None, "3": None}},
        {"item_id": "B", "stages": {"1": {"role": "allowance"}, "2": {"role": "allowance"}, "3": {"role": "final"}}},
        {"item_id": "C", "stages": {"1": None, "2": None, "3": {"role": "final"}}},
    ]}

    def rec(self, item_id, stage, status="completed", judgement="pass"):
        return {"item_id": item_id, "stage": stage, "status": status, "judgement": judgement}

    def test_each_stage_waits_for_the_previous(self):
        status = stage_status(self.plan, [self.rec("A", "1"), self.rec("B", "1", "remeasure", "fail")])
        self.assertEqual([status[s]["unlocked"] for s in "123"], [True, False, False])
        status = stage_status(self.plan, [self.rec("A", "1"), self.rec("B", "1")])
        self.assertEqual([status[s]["unlocked"] for s in "123"], [True, True, False])
        status = stage_status(self.plan, [self.rec("A", "1"), self.rec("B", "1"), self.rec("B", "2")])
        self.assertTrue(status["3"]["unlocked"])
        self.assertEqual(status["3"]["required"], 2)   # B, C


if __name__ == "__main__":
    unittest.main()
