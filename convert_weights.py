
from pathlib import Path
import sys
import numpy as np

project_root = Path(__file__).resolve().parent
sys.path.insert(0, str(project_root / "edocr2"))

from edocr2 import tools
from edocr2.keras_ocr.recognition import Recognizer

models_dir = project_root / "edocr2" / "edocr2" / "models"

for name in ["recognizer_dimensions_2", "recognizer_gdts"]:
    model_base = models_dir / name

    print(f"\n[START] {name}", flush=True)

    alphabet = tools.ocr_pipelines.read_alphabet(str(model_base))
    recognizer = Recognizer(alphabet=alphabet)

    print("[LOADING] Original model weights...", flush=True)
    recognizer.model.load_weights(str(model_base) + ".keras")

    weights = recognizer.model.get_weights()
    print(f"[OK] Extracted {len(weights)} arrays", flush=True)

    output = str(model_base) + "_gpu_weights.npz"

    np.savez_compressed(
        output,
        **{f"arr_{i}": w for i, w in enumerate(weights)}
    )

    print(f"[SAVED] {output}", flush=True)

print("\nExport finished.", flush=True)
