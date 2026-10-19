"""Keras 3 .keras 안의 가중치를 기존 eDOCr2 모델에 읽는다."""
import io
import json
import re
import zipfile
from collections import defaultdict
from pathlib import Path

import h5py
import numpy as np


class WeightCompatibilityError(ValueError):
    pass


def _snake(name):
    name = re.sub(r"\W+", "", name)
    name = re.sub(r"(.)([A-Z][a-z]+)", r"\1_\2", name)
    return re.sub(r"([a-z])([A-Z])", r"\1_\2", name).lower()


def load_keras3_weights(model, filename):
    filename = Path(filename)

    if not filename.is_file():
        raise FileNotFoundError(f"모델 파일 없음: {filename}")

    if not zipfile.is_zipfile(filename):
        raise WeightCompatibilityError(
            "Keras 3 ZIP 형식의 .keras 파일이 아닙니다."
        )

    with zipfile.ZipFile(filename) as archive:
        config = json.loads(archive.read("config.json"))
        metadata = json.loads(archive.read("metadata.json"))

        if not str(metadata.get("keras_version", "")).startswith("3."):
            raise WeightCompatibilityError(
                "이 로더는 Keras 3 저장 파일용입니다."
            )

        weights_bytes = archive.read("model.weights.h5")

    if config.get("class_name") not in ("Functional", "Sequential"):
        raise WeightCompatibilityError(
            "지원하지 않는 모델 구조입니다."
        )

    staged = []
    consumed = set()

    allowed = {
        "Conv2D": (
            "filters", "kernel_size", "strides", "padding",
            "data_format", "dilation_rate", "groups",
            "activation", "use_bias",
        ),
        "Dense": (
            "units", "activation", "use_bias",
        ),
        "BatchNormalization": (
            "axis", "momentum", "epsilon", "center", "scale",
        ),
        "LSTM": (
            "units", "activation", "recurrent_activation",
            "use_bias", "return_sequences", "return_state",
            "go_backwards", "stateful", "unroll",
        ),
    }

    weightless = {
        "InputLayer", "Permute", "Lambda", "MaxPooling2D",
        "Flatten", "Reshape", "Add", "Concatenate",
        "Dropout", "Activation",
    }

    def normalized(value):
        if isinstance(value, tuple):
            return list(value)
        return value

    def same_setting(key, left, right, rank=None):
        if key == "axis":
            if isinstance(left, (list, tuple)) and len(left) == 1:
                left = left[0]

            if isinstance(right, (list, tuple)) and len(right) == 1:
                right = right[0]

            if (
                rank is not None
                and isinstance(left, int)
                and isinstance(right, int)
            ):
                left, right = left % rank, right % rank

        return normalized(left) == normalized(right)

    with h5py.File(io.BytesIO(weights_bytes), "r") as store:

        def walk(target, source, prefix=""):
            source_layers = source.get("config", {}).get("layers")

            if not isinstance(source_layers, list):
                raise WeightCompatibilityError(
                    f"레이어 설정 없음: {prefix}"
                )

            target_layers = target.layers

            if len(source_layers) != len(target_layers):
                raise WeightCompatibilityError(
                    f"레이어 수 불일치: {prefix} "
                    f"저장={len(source_layers)}, "
                    f"현재={len(target_layers)}"
                )

            counts = defaultdict(int)

            for saved, layer in zip(source_layers, target_layers):
                kind = saved.get("class_name")
                target_kind = layer.__class__.__name__

                if kind != target_kind:
                    raise WeightCompatibilityError(
                        f"레이어 순서/종류 불일치: "
                        f"{saved.get('config', {}).get('name')} "
                        f"({kind}) / {layer.name} ({target_kind})"
                    )

                base = _snake(kind)
                index = counts[base]
                counts[base] += 1

                group_name = base if index == 0 else f"{base}_{index}"
                group_path = f"{prefix}layers/{group_name}"

                source_config = saved.get("config", {})
                target_config = layer.get_config()

                if kind in ("Functional", "Sequential"):
                    walk(layer, saved, group_path + "/")
                    continue

                if kind not in allowed:
                    if kind not in weightless or layer.get_weights():
                        raise WeightCompatibilityError(
                            f"지원하지 않는 레이어: {kind}"
                        )

                    for key in (
                        "pool_size", "strides", "padding",
                        "target_shape", "dims", "axis",
                    ):
                        if (
                            key in source_config
                            and key in target_config
                            and not same_setting(
                                key,
                                source_config[key],
                                target_config[key],
                            )
                        ):
                            raise WeightCompatibilityError(
                                f"구조 설정 불일치: {layer.name}.{key}"
                            )

                    continue

                for key in allowed[kind]:
                    rank = (
                        len(layer.input_shape)
                        if key == "axis"
                        else None
                    )

                    if (
                        key in source_config
                        and key in target_config
                        and not same_setting(
                            key,
                            source_config[key],
                            target_config[key],
                            rank,
                        )
                    ):
                        raise WeightCompatibilityError(
                            f"레이어 설정 불일치: {layer.name}.{key}"
                        )

                vars_path = group_path + (
                    "/cell/vars" if kind == "LSTM" else "/vars"
                )

                if vars_path not in store:
                    raise WeightCompatibilityError(
                        f"가중치 그룹 없음: {vars_path}"
                    )

                group = store[vars_path]
                expected = layer.get_weights()

                if set(group.keys()) != {
                    str(i) for i in range(len(expected))
                }:
                    raise WeightCompatibilityError(
                        f"가중치 개수 불일치: {layer.name}"
                    )

                arrays = []

                for i, old in enumerate(expected):
                    dataset = group[str(i)]
                    new = np.asarray(dataset)

                    if (
                        new.shape != old.shape
                        or new.dtype != old.dtype
                        or not np.isfinite(new).all()
                    ):
                        raise WeightCompatibilityError(
                            f"가중치 불일치: {layer.name}[{i}] "
                            f"저장={new.shape}/{new.dtype}, "
                            f"현재={old.shape}/{old.dtype}"
                        )

                    arrays.append(new)
                    consumed.add(dataset.name.lstrip("/"))

                staged.append((layer, arrays))

        walk(model, config)

        datasets = set()

        def collect(name, obj):
            if (
                isinstance(obj, h5py.Dataset)
                and not name.startswith("optimizer/")
            ):
                datasets.add(name)

        store.visititems(collect)

        if datasets != consumed:
            raise WeightCompatibilityError(
                f"연결되지 않은 저장 가중치: "
                f"{sorted(datasets - consumed)}"
            )

    if sum(len(values) for _, values in staged) != len(model.get_weights()):
        raise WeightCompatibilityError(
            "현재 모델의 가중치를 모두 연결하지 못했습니다."
        )

    # 전체 검증이 끝난 경우에만 실제 모델에 적용한다.
    for layer, arrays in staged:
        layer.set_weights(arrays)

    count = sum(len(values) for _, values in staged)

    print(
        f"[OK] {filename.name}: 가중치 {count}개 로딩 완료 / NPZ 미사용",
        flush=True,
    )