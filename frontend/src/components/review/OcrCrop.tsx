interface Props {
  imageUrl: string | null;
  imageWidth: number;
  imageHeight: number;
  /** 잘라낼 영역 (원본 이미지 픽셀) */
  box: { x: number; y: number; width: number; height: number };
  label: string;
}

/** 도면 결과 이미지에서 해당 표기 부분만 잘라 크게 보여준다. 값을 원문과 바로 비교하는 용도. */
export default function OcrCrop({ imageUrl, imageWidth, imageHeight, box, label }: Props) {
  if (!imageUrl || !imageWidth || !imageHeight) return null;

  const x = Math.max(0, Math.min(box.x, imageWidth - box.width));
  const y = Math.max(0, Math.min(box.y, imageHeight - box.height));
  const width = Math.min(box.width, imageWidth);
  const height = Math.min(box.height, imageHeight);

  return (
    <figure className="space-y-1">
      <div
        role="img"
        aria-label={label}
        className="w-full overflow-hidden rounded-lg border border-slate-300 bg-white"
        style={{
          aspectRatio: `${width} / ${height}`,
          backgroundImage: `url("${imageUrl}")`,
          backgroundRepeat: "no-repeat",
          backgroundSize: `${(imageWidth / width) * 100}% ${(imageHeight / height) * 100}%`,
          backgroundPosition: `${imageWidth === width ? 0 : (x / (imageWidth - width)) * 100}% ${
            imageHeight === height ? 0 : (y / (imageHeight - height)) * 100
          }%`,
        }}
      />
      <figcaption className="text-[10px] text-slate-500">{label}</figcaption>
    </figure>
  );
}

/** 기하공차 틀: 좌표는 틀의 왼쪽 위. 줄 수만큼 높이를 잡는다. */
export function gdtCropBox(position: { x: number; y: number }, rows: number) {
  return { x: position.x - 14, y: position.y - 14, width: 320, height: 52 * Math.max(1, rows) + 28 };
}

/** 치수: 좌표는 글자 중심. */
export function dimensionCropBox(position: { x: number; y: number }) {
  return { x: position.x - 110, y: position.y - 45, width: 220, height: 90 };
}
