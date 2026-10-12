export interface PreInspectionNotice {
  id: string;
  numberText: string; // e.g. "주의 01"
  title: string;      // e.g. "측정면 상태 확인"
  description: string;// e.g. "측정면에 이물질이나 버가 남아 있으면 측정값에 오차가 발생할 수 있습니다."
}

export type MeasurementItemType = "DIMENSION" | "GEOMETRIC";

export interface MeasurementItemDef {
  id: string;
  name: string; // e.g. "로드 본체 외경", "피스톤 체결부 외경"
  fullName: string;
  type: MeasurementItemType;
  unit: string;
  nominalValue?: number;
  lowerLimit?: number;
  upperLimit?: number;
  maxAllowed?: number; // for geometric tolerance: value must be <= maxAllowed
  standardDisplay: string;
  toleranceDisplay: string;
  equipment: string;
  defaultPassValue: number;
  defaultNGValue: number;
}

export interface MeasurementPoint {
  id: number;
  displayNumber: number;
  feature: {
    type: "SHAFT" | "PLANE" | "HOLE" | "THREAD" | "LENGTH";
    name: string;
    description: string;
  };
  // Structured measurement items
  items: MeasurementItemDef[];
  // For backwards compatibility and fast table display
  measurementItems: string[];
  dimension: {
    type: "DIAMETER" | "LENGTH" | "PCD" | "GEOMETRIC";
    nominalValue: number;
    unit: string;
    formatted: string;
  };
  dimensionalTolerance: {
    upper: number;
    lower: number;
    unit: string;
    formatted: string;
  };
  geometricTolerance?: {
    type: "CIRCULARITY" | "RUNOUT" | "CONCENTRICITY" | "POSITION" | "FLATNESS";
    label: string;
    symbol: string;
    value: number;
    datum: string;
    unit: string;
    formatted: string;
  };
  datumReferences: string[];
  surfaceFinish: {
    parameter: string;
    value: number;
    unit: string;
  };
  measurement: {
    equipment: string;
    subEquipment?: string;
    samplingMethod: string;
    temperatureCondition: string;
  };
  drawingPosition: {
    xPercent: number; // percentage in SVG coordinate space
    yPercent: number;
    labelOffset?: { x: number; y: number };
  };
  notices: PreInspectionNotice[];
  cadCallout: string;
}

export const MOCK_PART_INFO = {
  partName: "PISTON ROD (유압 피스톤 로드)",
  partNo: "PR-001",
  drawingNo: "DWG-PR-001-M",
  revision: "Rev. A",
  material: "SCM440 (Chrome-Molybdenum Steel)",
  heatTreatment: "Q/T HRC 28~32 + 경질 크롬 도금 (Hard Chrome HRC 58~62)",
  standard: "KS B 0401 / ISO 2768-m",
  unit: "mm",
  drawingType: "Manufacturing Drawing (시연용 Mock Drawing)",
  inspector: "김태호 책임연구원 (QA-1)",
  statusBadges: ["최신 도면", "검사 기준 일치"],
};

export const MOCK_MEASUREMENT_POINTS: MeasurementPoint[] = [
  {
    id: 1,
    displayNumber: 1,
    feature: {
      type: "SHAFT",
      name: "로드 본체 외경",
      description: "고압 유압 실린더 패킹/부싱 접촉 주 가동 로드부",
    },
    items: [
      {
        id: "p1-dia",
        name: "로드 본체 외경",
        fullName: "로드 본체 외경 (Rod Body Ø40)",
        type: "DIMENSION",
        unit: "mm",
        nominalValue: 40.0,
        lowerLimit: 39.990,
        upperLimit: 40.010,
        standardDisplay: "기준 치수: Ø40.000 mm",
        toleranceDisplay: "39.990 ~ 40.010 mm",
        equipment: "외경 마이크로미터 (25-50mm)",
        defaultPassValue: 40.004,
        defaultNGValue: 40.025,
      },
    ],
    measurementItems: ["외경 측정 (Outer Dia)"],
    dimension: {
      type: "DIAMETER",
      nominalValue: 40.0,
      unit: "mm",
      formatted: "Ø40.000",
    },
    dimensionalTolerance: {
      upper: 0.01,
      lower: -0.01,
      unit: "mm",
      formatted: "±0.010",
    },
    datumReferences: ["A", "B"],
    surfaceFinish: {
      parameter: "Ra",
      value: 0.4,
      unit: "μm",
    },
    measurement: {
      equipment: "외경 마이크로미터 (25-50mm)",
      subEquipment: "실린더 게이지 / 광학 외경 측정기",
      samplingMethod: "로드 양단 및 중앙부 3단면 × 90° 교차 2방향 총 6점 측정",
      temperatureCondition: "20 ± 1 °C 항온실 2시간 안착 후 측정",
    },
    drawingPosition: {
      xPercent: 46,
      yPercent: 37,
      labelOffset: { x: 0, y: -45 },
    },
    notices: [
      {
        id: "n1-1",
        numberText: "주의 01",
        title: "측정면 이물질 및 도금 표면 확인",
        description: "경질 크롬 도금 표면에 방청유 잔류물, 미세 스크래치 또는 버(Burr)가 없는지 무수 알코올로 세척 후 점검하세요.",
      },
      {
        id: "n1-2",
        numberText: "주의 02",
        title: "마이크로미터 0점(Zero Setting) 교정",
        description: "25-50mm 외경 마이크로미터를 25mm 기준 블록게이지로 측정 전 영점 교정 상태를 확인하세요.",
      },
      {
        id: "n1-3",
        numberText: "주의 03",
        title: "직각 유지 및 3클릭 래칫 일관 하중",
        description: "축 중심선과 마이크로미터 앤빌의 직각도를 정확히 유지하고 래칫 3클릭 일관 하중으로 접촉하세요.",
      },
      {
        id: "n1-4",
        numberText: "주의 04",
        title: "3단면 반복 측정 권장",
        description: "단차 어깨부 인접 15mm 지점, 중앙부, 축단 인접부 3개 단면에서 3회 이상 측정하여 평균치를 산출하세요.",
      },
    ],
    cadCallout: "Ø40.000 ±0.010 [Ra 0.4]",
  },
  {
    id: 2,
    displayNumber: 2,
    feature: {
      type: "SHAFT",
      name: "피스톤 체결부 외경",
      description: "실린더 피스톤 피팅 및 분할 링 안착 단차 가공부",
    },
    items: [
      {
        id: "p2-mount",
        name: "피스톤 체결부 외경",
        fullName: "피스톤 체결부 외경 (Mounting Neck Ø30)",
        type: "DIMENSION",
        unit: "mm",
        nominalValue: 30.0,
        lowerLimit: 29.985,
        upperLimit: 30.015,
        standardDisplay: "기준 치수: Ø30.000 mm",
        toleranceDisplay: "29.985 ~ 30.015 mm",
        equipment: "외경 마이크로미터 (25-50mm)",
        defaultPassValue: 30.002,
        defaultNGValue: 29.975,
      },
    ],
    measurementItems: ["체결부 외경 측정 (Mounting Neck)"],
    dimension: {
      type: "DIAMETER",
      nominalValue: 30.0,
      unit: "mm",
      formatted: "Ø30.000",
    },
    dimensionalTolerance: {
      upper: 0.015,
      lower: -0.015,
      unit: "mm",
      formatted: "±0.015",
    },
    datumReferences: ["A"],
    surfaceFinish: {
      parameter: "Ra",
      value: 0.8,
      unit: "μm",
    },
    measurement: {
      equipment: "외경 마이크로미터 (25-50mm)",
      subEquipment: "피스톤 링 마스터 게이지",
      samplingMethod: "피스톤 안착부 2단면 직교 4점 실측 및 피스톤 결합 공차 확인",
      temperatureCondition: "20 ± 1 °C",
    },
    drawingPosition: {
      xPercent: 77,
      yPercent: 37,
      labelOffset: { x: 0, y: -45 },
    },
    notices: [
      {
        id: "n2-1",
        numberText: "주의 01",
        title: "어깨부 R필렛(R1.5) 간섭 주의",
        description: "로드 본체와 체결부 사이의 단차 R1.5 필렛 반경부에 마이크로미터 앤빌 코너가 닿지 않도록 주의하세요.",
      },
      {
        id: "n2-2",
        numberText: "주의 02",
        title: "체결면 버(Burr) 및 타흔 확인",
        description: "피스톤 조립 밀착면의 가공 버나 찍힘이 있으면 체결 틈새가 발생하므로 세척 후 육안 검사를 선행하세요.",
      },
      {
        id: "n2-3",
        numberText: "주의 03",
        title: "마이크로미터 스핀들 평행도 확인",
        description: "30mm 단차 측정 시 스핀들 평행도 및 마모 상태를 확인하고 0점을 재검증하세요.",
      },
    ],
    cadCallout: "Ø30.000 ±0.015 [Ra 0.8]",
  },
  {
    id: 3,
    displayNumber: 3,
    feature: {
      type: "LENGTH",
      name: "로드 전체 길이",
      description: "노즈 나사산 단면부터 후단 피스톤 체결 엔드까지 전장",
    },
    items: [
      {
        id: "p3-length",
        name: "로드 전체 길이",
        fullName: "로드 전체 길이 (Total Length L350)",
        type: "DIMENSION",
        unit: "mm",
        nominalValue: 350.0,
        lowerLimit: 349.900,
        upperLimit: 350.100,
        standardDisplay: "기준 치수: 350.000 mm",
        toleranceDisplay: "349.900 ~ 350.100 mm",
        equipment: "정밀 버니어 캘리퍼스 (0-500mm) / 하이트게이지",
        defaultPassValue: 350.030,
        defaultNGValue: 350.180,
      },
    ],
    measurementItems: ["전체 길이 측정 (Total Length)"],
    dimension: {
      type: "LENGTH",
      nominalValue: 350.0,
      unit: "mm",
      formatted: "350.000",
    },
    dimensionalTolerance: {
      upper: 0.1,
      lower: -0.1,
      unit: "mm",
      formatted: "±0.100",
    },
    datumReferences: [],
    surfaceFinish: {
      parameter: "Ra",
      value: 1.6,
      unit: "μm",
    },
    measurement: {
      equipment: "정밀 버니어 캘리퍼스 (0-500mm)",
      subEquipment: "정밀 하이트게이지 / 정반",
      samplingMethod: "정반 위 V블록 안착 후 단면 스토퍼 기준 3회 측정 평균값 산출",
      temperatureCondition: "20 ± 1 °C (길이 열팽창 보정 α=11.8×10⁻⁶/K)",
    },
    drawingPosition: {
      xPercent: 49,
      yPercent: 78,
      labelOffset: { x: 0, y: 30 },
    },
    notices: [
      {
        id: "n3-1",
        numberText: "주의 01",
        title: "축 방향 평행도 및 밀착 확인",
        description: "로드 양단 가공 단면이 캘리퍼스 죠(Jaw)에 완전히 평행 밀착되도록 수평 레벨을 유지하세요.",
      },
      {
        id: "n3-2",
        numberText: "주의 02",
        title: "노즈 단면 모따기(C1.5) 측정 오차 방지",
        description: "양단 모따기 C1.5 경사면이 아닌 가공 기준 단면의 진원 중심축 평면을 접촉 기준으로 삼으세요.",
      },
      {
        id: "n3-3",
        numberText: "주의 03",
        title: "열팽창에 따른 전장 오차 관리",
        description: "350mm 장축 특성상 온도 편차 5°C 시 약 0.02mm 열팽창하므로 20°C 안정화 후 실측하세요.",
      },
    ],
    cadCallout: "350.000 ±0.100 mm",
  },
  {
    id: 4,
    displayNumber: 4,
    feature: {
      type: "SHAFT",
      name: "로드 본체 진원도",
      description: "유압 씰 오일 누유 방지를 위한 로드 본체 단면 형상 정밀도",
    },
    items: [
      {
        id: "p4-cir",
        name: "로드 본체 진원도",
        fullName: "로드 본체 진원도 (Circularity)",
        type: "GEOMETRIC",
        unit: "mm",
        maxAllowed: 0.010,
        standardDisplay: "진원도 기하공차 (○ 0.010)",
        toleranceDisplay: "≤ 0.010 mm",
        equipment: "진원도 측정기 (Talyrond)",
        defaultPassValue: 0.004,
        defaultNGValue: 0.016,
      },
    ],
    measurementItems: ["진원도 기하공차 측정 (Circularity)"],
    dimension: {
      type: "GEOMETRIC",
      nominalValue: 40.0,
      unit: "mm",
      formatted: "○ 0.010",
    },
    dimensionalTolerance: {
      upper: 0.01,
      lower: 0.0,
      unit: "mm",
      formatted: "≤ 0.010",
    },
    geometricTolerance: {
      type: "CIRCULARITY",
      label: "진원도",
      symbol: "○",
      value: 0.01,
      datum: "",
      unit: "mm",
      formatted: "○ 0.010",
    },
    datumReferences: [],
    surfaceFinish: {
      parameter: "Ra",
      value: 0.4,
      unit: "μm",
    },
    measurement: {
      equipment: "진원도 측정기 (Talyrond)",
      subEquipment: "외경 마이크로미터 (간이 3점 측정)",
      samplingMethod: "로드 중앙 및 양단 3개 단면 최소자승원(LSC) 반경 편차 필터링 측정",
      temperatureCondition: "20 ± 0.5 °C 정밀 측정실",
    },
    drawingPosition: {
      xPercent: 33,
      yPercent: 37,
      labelOffset: { x: 0, y: -45 },
    },
    notices: [
      {
        id: "n4-1",
        numberText: "주의 01",
        title: "진원도 측정기 프로브 영점 확인",
        description: "회전 테이블 중심과 로드 중심축 정렬(Centering/Leveling) 오차를 2μm 이내로 사전 보정하세요.",
      },
      {
        id: "n4-2",
        numberText: "주의 02",
        title: "로드 지지 상태 및 자중 처짐 확인",
        description: "장축 로드의 자중 처짐으로 인한 타원형 왜곡을 방지하기 위해 정밀 수직 또는 3점 지지대를 적용하세요.",
      },
      {
        id: "n4-3",
        numberText: "주의 03",
        title: "측정 중 외부 진동 및 편심 확인",
        description: "연삭기 채터 마크(Chatter mark) 또는 바닥 진동이 측정 파형에 유입되지 않도록 에어 마운트를 점검하세요.",
      },
    ],
    cadCallout: "○ 0.010 mm",
  },
  {
    id: 5,
    displayNumber: 5,
    feature: {
      type: "SHAFT",
      name: "로드 축 흔들림",
      description: "양단 기준 중심축선(Datum A-B)에 대한 전장 회전 런아웃 공차",
    },
    items: [
      {
        id: "p5-runout",
        name: "로드 축 흔들림",
        fullName: "로드 축 흔들림 (Runout Datum A-B)",
        type: "GEOMETRIC",
        unit: "mm",
        maxAllowed: 0.020,
        standardDisplay: "원주 흔들림 기하공차 (↗ 0.020 | A-B)",
        toleranceDisplay: "≤ 0.020 mm",
        equipment: "다이얼 인디케이터 (0.001mm) & 정밀 V-블록 / 롤러 게이지",
        defaultPassValue: 0.012,
        defaultNGValue: 0.035,
      },
    ],
    measurementItems: ["원주 흔들림 공차 측정 (Circular Runout)"],
    dimension: {
      type: "GEOMETRIC",
      nominalValue: 40.0,
      unit: "mm",
      formatted: "↗ 0.020 | A-B",
    },
    dimensionalTolerance: {
      upper: 0.02,
      lower: 0.0,
      unit: "mm",
      formatted: "≤ 0.020",
    },
    geometricTolerance: {
      type: "RUNOUT",
      label: "원주 흔들림",
      symbol: "↗",
      value: 0.02,
      datum: "A-B",
      unit: "mm",
      formatted: "↗ 0.020 | A-B",
    },
    datumReferences: ["A", "B"],
    surfaceFinish: {
      parameter: "Ra",
      value: 0.4,
      unit: "μm",
    },
    measurement: {
      equipment: "다이얼 인디케이터 & 정밀 V-블록",
      subEquipment: "벤치 센터(Bench Center) 검사기",
      samplingMethod: "Datum A(체결부) 및 Datum B(단차부) V-블록 거치 후 1회전 전체 지침 변위(TIR) 측정",
      temperatureCondition: "20 ± 1 °C",
    },
    drawingPosition: {
      xPercent: 61,
      yPercent: 37,
      labelOffset: { x: 0, y: -45 },
    },
    notices: [
      {
        id: "n5-1",
        numberText: "주의 01",
        title: "Datum A-B V-블록 기준면 설정 확인",
        description: "양단 기준면 A(피스톤 체결부)와 B(노즈 단차부)가 정밀 V블록에 균등 밀착되었는지 점검하세요.",
      },
      {
        id: "n5-2",
        numberText: "주의 02",
        title: "다이얼 인디케이터 측정자 접촉각 유지",
        description: "측정 침이 축 외경 접선에 정확히 수직(90°)으로 접촉되도록 게이지 홀더를 고정하세요.",
      },
      {
        id: "n5-3",
        numberText: "주의 03",
        title: "로드 회전 시 축방향 유동(Axial Play) 방지",
        description: "손으로 360° 서서히 회전시킬 때 축방향 밀림이 발생하지 않도록 단면 스토퍼를 밀착시키세요.",
      },
    ],
    cadCallout: "↗ 0.020 | A-B",
  },
];
