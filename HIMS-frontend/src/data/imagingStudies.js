// Imaging studies a doctor can order, grouped by modality. Modality names
// match radiology_orders.modality; studies are the common OPD requests.
export const IMAGING_MODALITIES = [
  {
    id: 'X-Ray', label: 'X-Ray', icon: '🩻',
    studies: ['Chest PA', 'Chest AP', 'Abdomen erect', 'KUB', 'Cervical spine AP/Lat', 'Lumbar spine AP/Lat', 'Pelvis AP',
      'Knee AP/Lat', 'Shoulder AP', 'Hand AP/Oblique', 'Wrist AP/Lat', 'Ankle AP/Lat', 'Foot AP/Oblique', 'Skull AP/Lat', 'PNS (Waters view)'],
  },
  {
    id: 'Ultrasound', label: 'Ultrasound', icon: '🔊',
    studies: ['Abdomen & Pelvis', 'Upper abdomen', 'KUB', 'Obstetric (pregnancy)', 'Pelvis (TVS)', 'Thyroid / Neck', 'Breast',
      'Scrotum', 'Soft tissue swelling', 'Doppler – lower limb', 'Doppler – carotid'],
  },
  { id: 'ECG', label: 'ECG', icon: '❤️', studies: ['12-lead ECG'] },
  { id: 'Echo', label: 'Echo', icon: '💓', studies: ['2D Echo', 'Echo with Doppler'] },
  {
    id: 'CT', label: 'CT scan', icon: '🌀',
    studies: ['Brain plain', 'Brain contrast', 'Chest (HRCT)', 'Abdomen & Pelvis contrast', 'KUB (stone protocol)', 'PNS', 'Cervical spine', 'CT angiography'],
  },
  {
    id: 'MRI', label: 'MRI', icon: '🧲',
    studies: ['Brain', 'Cervical spine', 'Lumbar spine', 'Knee', 'Shoulder', 'Abdomen', 'Pelvis', 'MR angiography'],
  },
  { id: 'Mammography', label: 'Mammography', icon: '🎗️', studies: ['Bilateral screening', 'Diagnostic'] },
  { id: 'DEXA Scan', label: 'Bone density', icon: '🦴', studies: ['DEXA – spine & hip'] },
];
