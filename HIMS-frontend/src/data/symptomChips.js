// Symptom chips organized by body system for quick-click entry in Chief Complaints
export const SYMPTOM_CHIPS = {
  'General': [
    'Fever', 'Chills', 'Fatigue', 'Weakness', 'Malaise', 'Weight loss', 'Weight gain',
    'Loss of appetite', 'Night sweats', 'Lethargy', 'Generalized body aches',
  ],
  'Respiratory': [
    'Cough', 'Dry cough', 'Productive cough', 'Breathlessness', 'Wheezing',
    'Chest tightness', 'Sore throat', 'Runny nose', 'Nasal congestion',
    'Sneezing', 'Haemoptysis', 'Hoarseness of voice',
  ],
  'Cardiovascular': [
    'Chest pain', 'Palpitations', 'Dyspnoea on exertion', 'Orthopnoea',
    'Pedal oedema', 'Syncope', 'Dizziness', 'Intermittent claudication',
  ],
  'Gastrointestinal': [
    'Nausea', 'Vomiting', 'Abdominal pain', 'Bloating', 'Heartburn',
    'Diarrhoea', 'Constipation', 'Dysphagia', 'Melena', 'Haematochezia',
    'Loss of appetite', 'Jaundice', 'Flatulence', 'Dyspepsia',
  ],
  'Neurological': [
    'Headache', 'Migraine', 'Dizziness', 'Vertigo', 'Seizure', 'Tremor',
    'Numbness', 'Tingling', 'Weakness of limbs', 'Memory loss', 'Confusion',
    'Slurred speech', 'Loss of consciousness',
  ],
  'Musculoskeletal': [
    'Joint pain', 'Knee pain', 'Back pain', 'Neck pain', 'Shoulder pain',
    'Joint swelling', 'Morning stiffness', 'Muscle cramps', 'Limping',
    'Restricted range of motion', 'Sciatica',
  ],
  'Urological': [
    'Burning micturition', 'Frequency of urination', 'Urgency', 'Haematuria',
    'Nocturia', 'Oliguria', 'Polyuria', 'Flank pain', 'Urinary retention',
    'Dribbling of urine', 'Decreased urinary stream',
  ],
  'Gynaecological': [
    'Irregular periods', 'Heavy periods', 'Painful periods', 'Missed period',
    'Vaginal discharge', 'Pelvic pain', 'Hot flushes', 'Breast pain',
    'Intermenstrual bleeding', 'Post-coital bleeding',
  ],
  'Dermatological': [
    'Rash', 'Itching', 'Skin lesion', 'Hair loss', 'Nail changes',
    'Dry skin', 'Pigmentation changes', 'Wound not healing', 'Swelling',
    'Redness', 'Blistering',
  ],
  'ENT': [
    'Ear pain', 'Hearing loss', 'Ear discharge', 'Tinnitus', 'Nasal discharge',
    'Nosebleed', 'Snoring', 'Difficulty swallowing', 'Change in voice',
    'Facial pain', 'Post-nasal drip',
  ],
  'Ophthalmic': [
    'Blurred vision', 'Double vision', 'Eye pain', 'Eye redness',
    'Eye discharge', 'Watering eyes', 'Flashes of light', 'Floaters',
    'Night blindness', 'Photophobia',
  ],
  'Psychiatric': [
    'Anxiety', 'Depression', 'Insomnia', 'Mood swings', 'Irritability',
    'Panic attacks', 'Hallucinations', 'Forgetfulness', 'Social withdrawal',
    'Low motivation', 'Suicidal ideation',
  ],
};

export const ALL_SYSTEMS = Object.keys(SYMPTOM_CHIPS);
