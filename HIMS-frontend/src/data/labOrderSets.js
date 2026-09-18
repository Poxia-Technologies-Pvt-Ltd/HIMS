// Pre-defined lab order panels/sets for quick ordering
// test_names are matched against lab_tests.test_name (case-insensitive partial match)
// icd10Suggestions: ICD-10 codes that trigger this panel suggestion in smart suggestions

export const LAB_ORDER_SETS = [
  {
    id: 'cbc',
    name: 'CBC Panel',
    icon: '🩸',
    description: 'Complete Blood Count',
    color: '#dc2626',
    tests: ['Complete Blood Count', 'CBC', 'Haemogram', 'ESR', 'Peripheral Blood Film', 'PBF'],
    icd10Suggestions: ['D50', 'D51', 'D52', 'D64', 'B50', 'B54', 'A09', 'R50', 'B20'],
  },
  {
    id: 'lft',
    name: 'Liver Panel',
    icon: '🫁',
    description: 'Liver Function Tests',
    color: '#d97706',
    tests: ['SGOT', 'SGPT', 'ALP', 'Alkaline Phosphatase', 'Bilirubin Total', 'Bilirubin Direct', 'Bilirubin Indirect', 'Total Protein', 'Albumin', 'Globulin', 'LFT', 'Liver Function'],
    icd10Suggestions: ['K70', 'K72', 'K74', 'K75', 'K76', 'B15', 'B16', 'B17', 'B18', 'R17'],
  },
  {
    id: 'rft',
    name: 'Renal Panel',
    icon: '🫘',
    description: 'Kidney Function Tests',
    color: '#2563eb',
    tests: ['Creatinine', 'Blood Urea', 'BUN', 'Uric Acid', 'Sodium', 'Potassium', 'Chloride', 'eGFR', 'Urine Routine', 'RFT', 'Renal Function'],
    icd10Suggestions: ['N17', 'N18', 'N19', 'N20', 'N23', 'E87'],
  },
  {
    id: 'lipid',
    name: 'Lipid Profile',
    icon: '💛',
    description: 'Cholesterol & Triglycerides',
    color: '#7c3aed',
    tests: ['Total Cholesterol', 'HDL', 'LDL', 'VLDL', 'Triglycerides', 'Lipid Profile'],
    icd10Suggestions: ['E78', 'E78.0', 'E78.1', 'E78.5', 'I10', 'I25', 'E11'],
  },
  {
    id: 'diabetes',
    name: 'Diabetic Panel',
    icon: '🍬',
    description: 'Blood Glucose & HbA1c',
    color: '#059669',
    tests: ['FBS', 'Fasting Blood Sugar', 'PPBS', 'Post Prandial', 'HbA1c', 'Glycosylated Haemoglobin', 'Random Blood Sugar', 'RBS', 'Insulin', 'Urine Microalbumin', 'Urine Sugar'],
    icd10Suggestions: ['E11', 'E10', 'E14', 'R73', 'E66'],
  },
  {
    id: 'thyroid',
    name: 'Thyroid Panel',
    icon: '🦋',
    description: 'Thyroid Function Tests',
    color: '#0891b2',
    tests: ['TSH', 'T3', 'T4', 'Free T3', 'Free T4', 'FT3', 'FT4', 'Thyroid Function'],
    icd10Suggestions: ['E03', 'E04', 'E05', 'E06'],
  },
  {
    id: 'cardiac',
    name: 'Cardiac Panel',
    icon: '🫀',
    description: 'Heart Enzymes & Markers',
    color: '#dc2626',
    tests: ['Troponin', 'Troponin I', 'Troponin T', 'CK-MB', 'LDH', 'CPK', 'Pro-BNP', 'BNP', 'D-Dimer', 'ECG', 'Electrocardiogram'],
    icd10Suggestions: ['I21', 'I20', 'I50', 'I25', 'I26', 'I48'],
  },
  {
    id: 'fever_screen',
    name: 'Fever Screen',
    icon: '🌡️',
    description: 'Infection markers for fever',
    color: '#ea580c',
    tests: ['CBC', 'Complete Blood Count', 'ESR', 'CRP', 'C-Reactive Protein', 'Malaria Antigen', 'Dengue NS1', 'Dengue IgG IgM', 'Widal', 'Blood Culture', 'Urine Routine'],
    icd10Suggestions: ['R50', 'A90', 'A91', 'A01', 'B50', 'B54'],
  },
  {
    id: 'coagulation',
    name: 'Coagulation Panel',
    icon: '🩹',
    description: 'Bleeding & Clotting Tests',
    color: '#be185d',
    tests: ['PT', 'Prothrombin Time', 'INR', 'APTT', 'aPTT', 'Platelet Count', 'Bleeding Time', 'Clotting Time'],
    icd10Suggestions: ['I26', 'D64', 'K70', 'K72'],
  },
  {
    id: 'anemia',
    name: 'Anaemia Panel',
    icon: '🔴',
    description: 'Iron studies & Vitamin deficiencies',
    color: '#b91c1c',
    tests: ['Serum Iron', 'TIBC', 'Transferrin Saturation', 'Ferritin', 'Serum B12', 'Vitamin B12', 'Folic Acid', 'Folate', 'Reticulocyte Count', 'CBC', 'Peripheral Smear'],
    icd10Suggestions: ['D50', 'D51', 'D52', 'D64'],
  },
  {
    id: 'arthritis',
    name: 'Arthritis Panel',
    icon: '🦴',
    description: 'Rheumatology markers',
    color: '#92400e',
    tests: ['RA Factor', 'Rheumatoid Factor', 'CRP', 'ESR', 'Anti-CCP', 'ANA', 'Anti-nuclear Antibody', 'Uric Acid'],
    icd10Suggestions: ['M05', 'M06', 'M10', 'M32'],
  },
  {
    id: 'urine',
    name: 'Urine Panel',
    icon: '🟡',
    description: 'Urine Analysis',
    color: '#ca8a04',
    tests: ['Urine Routine', 'Urine R/M', 'Urine Culture', 'Urine Sensitivity', 'Urine Microalbumin', '24h Urine Protein', 'Urine Pregnancy Test'],
    icd10Suggestions: ['N39.0', 'N30', 'N17', 'N18', 'N20'],
  },
];

// Given a list of ICD-10 codes, return suggested panel ids
export function suggestLabPanels(icd10Codes) {
  if (!icd10Codes || icd10Codes.length === 0) return [];
  const suggested = new Set();
  for (const { code } of icd10Codes) {
    for (const panel of LAB_ORDER_SETS) {
      if (panel.icd10Suggestions.some(s => code.startsWith(s) || s.startsWith(code))) {
        suggested.add(panel.id);
      }
    }
  }
  return [...suggested];
}
