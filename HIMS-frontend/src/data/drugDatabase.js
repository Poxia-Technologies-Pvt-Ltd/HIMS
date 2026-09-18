// Drug database with generic names, categories, common dosages, and interaction flags
// interactions: array of generic name keywords that this drug interacts with (warn if both prescribed)

export const DRUG_DATABASE = [
  // ─── Analgesics / NSAIDs ────────────────────────────────────────────────────
  { name: 'Paracetamol 500mg', generic: 'Paracetamol', category: 'Analgesic', forms: ['Tablet', 'Syrup', 'Suspension'], commonDosages: ['250mg', '500mg', '650mg', '1000mg'], interactions: ['Warfarin', 'Alcohol'] },
  { name: 'Paracetamol 650mg', generic: 'Paracetamol', category: 'Analgesic', forms: ['Tablet'], commonDosages: ['650mg'], interactions: ['Warfarin'] },
  { name: 'Ibuprofen 400mg', generic: 'Ibuprofen', category: 'NSAID', forms: ['Tablet', 'Syrup'], commonDosages: ['200mg', '400mg', '600mg'], interactions: ['Warfarin', 'Aspirin', 'ACE inhibitor', 'Diuretic', 'Lithium'] },
  { name: 'Diclofenac 50mg', generic: 'Diclofenac', category: 'NSAID', forms: ['Tablet', 'Injection', 'Gel'], commonDosages: ['50mg', '75mg', '100mg'], interactions: ['Warfarin', 'Aspirin', 'Lithium', 'Methotrexate'] },
  { name: 'Diclofenac 75mg', generic: 'Diclofenac', category: 'NSAID', forms: ['Tablet'], commonDosages: ['75mg'], interactions: ['Warfarin', 'Aspirin'] },
  { name: 'Aceclofenac 100mg', generic: 'Aceclofenac', category: 'NSAID', forms: ['Tablet'], commonDosages: ['100mg'], interactions: ['Warfarin', 'Methotrexate'] },
  { name: 'Naproxen 250mg', generic: 'Naproxen', category: 'NSAID', forms: ['Tablet'], commonDosages: ['250mg', '500mg'], interactions: ['Warfarin', 'Aspirin', 'Lithium'] },
  { name: 'Mefenamic Acid 250mg', generic: 'Mefenamic Acid', category: 'NSAID', forms: ['Tablet', 'Capsule'], commonDosages: ['250mg', '500mg'], interactions: ['Warfarin'] },
  { name: 'Etoricoxib 60mg', generic: 'Etoricoxib', category: 'COX-2 Inhibitor', forms: ['Tablet'], commonDosages: ['60mg', '90mg', '120mg'], interactions: ['Warfarin', 'Lithium'] },
  { name: 'Celecoxib 200mg', generic: 'Celecoxib', category: 'COX-2 Inhibitor', forms: ['Capsule'], commonDosages: ['100mg', '200mg'], interactions: ['Warfarin', 'Lithium'] },
  { name: 'Tramadol 50mg', generic: 'Tramadol', category: 'Opioid Analgesic', forms: ['Tablet', 'Capsule', 'Injection'], commonDosages: ['50mg', '100mg'], interactions: ['SSRI', 'MAO inhibitor', 'Ondansetron', 'Benzodiazepine'] },
  { name: 'Ketorolac 10mg', generic: 'Ketorolac', category: 'NSAID', forms: ['Tablet', 'Injection'], commonDosages: ['10mg', '30mg'], interactions: ['Warfarin', 'Aspirin'] },

  // ─── Antipyretics ───────────────────────────────────────────────────────────
  { name: 'Nimesulide 100mg', generic: 'Nimesulide', category: 'NSAID / Antipyretic', forms: ['Tablet', 'Granules'], commonDosages: ['100mg'], interactions: ['Warfarin', 'Lithium'] },

  // ─── Antibiotics ────────────────────────────────────────────────────────────
  { name: 'Amoxicillin 250mg', generic: 'Amoxicillin', category: 'Antibiotic (Penicillin)', forms: ['Tablet', 'Capsule', 'Syrup'], commonDosages: ['250mg', '500mg', '875mg'], interactions: ['Warfarin', 'Methotrexate'] },
  { name: 'Amoxicillin 500mg', generic: 'Amoxicillin', category: 'Antibiotic (Penicillin)', forms: ['Capsule'], commonDosages: ['500mg'], interactions: ['Warfarin'] },
  { name: 'Amoxicillin-Clavulanate 625mg', generic: 'Amoxicillin-Clavulanate', category: 'Antibiotic (Penicillin)', forms: ['Tablet'], commonDosages: ['375mg', '625mg', '1g'], interactions: ['Warfarin'] },
  { name: 'Azithromycin 250mg', generic: 'Azithromycin', category: 'Antibiotic (Macrolide)', forms: ['Tablet', 'Syrup'], commonDosages: ['250mg', '500mg'], interactions: ['Warfarin', 'QT prolonging drugs'] },
  { name: 'Azithromycin 500mg', generic: 'Azithromycin', category: 'Antibiotic (Macrolide)', forms: ['Tablet'], commonDosages: ['500mg'], interactions: ['Warfarin'] },
  { name: 'Clarithromycin 500mg', generic: 'Clarithromycin', category: 'Antibiotic (Macrolide)', forms: ['Tablet'], commonDosages: ['250mg', '500mg'], interactions: ['Warfarin', 'Statin', 'Digoxin'] },
  { name: 'Erythromycin 500mg', generic: 'Erythromycin', category: 'Antibiotic (Macrolide)', forms: ['Tablet'], commonDosages: ['250mg', '500mg'], interactions: ['Warfarin', 'Statin'] },
  { name: 'Ciprofloxacin 500mg', generic: 'Ciprofloxacin', category: 'Antibiotic (Fluoroquinolone)', forms: ['Tablet', 'Injection'], commonDosages: ['250mg', '500mg', '750mg'], interactions: ['Antacid', 'Warfarin', 'Theophylline', 'Tizanidine'] },
  { name: 'Levofloxacin 500mg', generic: 'Levofloxacin', category: 'Antibiotic (Fluoroquinolone)', forms: ['Tablet', 'Injection'], commonDosages: ['250mg', '500mg', '750mg'], interactions: ['Antacid', 'Warfarin', 'QT prolonging drugs'] },
  { name: 'Ofloxacin 200mg', generic: 'Ofloxacin', category: 'Antibiotic (Fluoroquinolone)', forms: ['Tablet'], commonDosages: ['200mg', '400mg'], interactions: ['Antacid', 'Warfarin'] },
  { name: 'Norfloxacin 400mg', generic: 'Norfloxacin', category: 'Antibiotic (Fluoroquinolone)', forms: ['Tablet'], commonDosages: ['400mg'], interactions: ['Antacid', 'Warfarin'] },
  { name: 'Doxycycline 100mg', generic: 'Doxycycline', category: 'Antibiotic (Tetracycline)', forms: ['Capsule', 'Tablet'], commonDosages: ['100mg'], interactions: ['Antacid', 'Warfarin', 'Penicillin'] },
  { name: 'Tetracycline 250mg', generic: 'Tetracycline', category: 'Antibiotic (Tetracycline)', forms: ['Capsule'], commonDosages: ['250mg', '500mg'], interactions: ['Antacid', 'Warfarin'] },
  { name: 'Cephalexin 500mg', generic: 'Cephalexin', category: 'Antibiotic (Cephalosporin)', forms: ['Capsule', 'Tablet'], commonDosages: ['250mg', '500mg'], interactions: ['Warfarin'] },
  { name: 'Cefuroxime 250mg', generic: 'Cefuroxime', category: 'Antibiotic (Cephalosporin)', forms: ['Tablet', 'Injection'], commonDosages: ['250mg', '500mg'], interactions: [] },
  { name: 'Cefpodoxime 200mg', generic: 'Cefpodoxime', category: 'Antibiotic (Cephalosporin)', forms: ['Tablet'], commonDosages: ['100mg', '200mg'], interactions: [] },
  { name: 'Ceftriaxone 1g', generic: 'Ceftriaxone', category: 'Antibiotic (Cephalosporin)', forms: ['Injection'], commonDosages: ['500mg', '1g', '2g'], interactions: ['Calcium (IV)'] },
  { name: 'Metronidazole 400mg', generic: 'Metronidazole', category: 'Antibiotic (Nitroimidazole)', forms: ['Tablet', 'Injection', 'Gel'], commonDosages: ['200mg', '400mg', '500mg'], interactions: ['Warfarin', 'Alcohol', 'Lithium'] },
  { name: 'Tinidazole 500mg', generic: 'Tinidazole', category: 'Antibiotic (Nitroimidazole)', forms: ['Tablet'], commonDosages: ['500mg', '1g'], interactions: ['Warfarin', 'Alcohol'] },
  { name: 'Nitrofurantoin 100mg', generic: 'Nitrofurantoin', category: 'Antibiotic (UTI)', forms: ['Tablet', 'Capsule'], commonDosages: ['50mg', '100mg'], interactions: ['Antacid'] },
  { name: 'Trimethoprim-Sulfamethoxazole 480mg', generic: 'Co-trimoxazole', category: 'Antibiotic (Sulphonamide)', forms: ['Tablet'], commonDosages: ['480mg', '960mg'], interactions: ['Warfarin', 'Methotrexate', 'ACE inhibitor'] },
  { name: 'Clindamycin 300mg', generic: 'Clindamycin', category: 'Antibiotic (Lincosamide)', forms: ['Capsule', 'Injection'], commonDosages: ['150mg', '300mg'], interactions: [] },
  { name: 'Vancomycin 500mg', generic: 'Vancomycin', category: 'Antibiotic (Glycopeptide)', forms: ['Injection'], commonDosages: ['500mg', '1g'], interactions: ['Aminoglycoside'] },
  { name: 'Gentamicin 80mg', generic: 'Gentamicin', category: 'Antibiotic (Aminoglycoside)', forms: ['Injection', 'Eye drops'], commonDosages: ['40mg', '80mg'], interactions: ['Vancomycin', 'Loop diuretic'] },
  { name: 'Isoniazid 300mg', generic: 'Isoniazid', category: 'Anti-TB', forms: ['Tablet'], commonDosages: ['100mg', '300mg'], interactions: ['Antacid', 'Rifampicin', 'Phenytoin'] },
  { name: 'Rifampicin 450mg', generic: 'Rifampicin', category: 'Anti-TB', forms: ['Capsule'], commonDosages: ['150mg', '300mg', '450mg', '600mg'], interactions: ['OCP', 'Warfarin', 'Antifungal', 'HIV antiretrovirals'] },

  // ─── Antifungals ────────────────────────────────────────────────────────────
  { name: 'Fluconazole 150mg', generic: 'Fluconazole', category: 'Antifungal', forms: ['Capsule', 'Tablet'], commonDosages: ['50mg', '100mg', '150mg', '200mg'], interactions: ['Warfarin', 'Statin', 'Cisapride', 'QT prolonging drugs'] },
  { name: 'Itraconazole 100mg', generic: 'Itraconazole', category: 'Antifungal', forms: ['Capsule'], commonDosages: ['100mg', '200mg'], interactions: ['Statin', 'Digoxin', 'Warfarin'] },
  { name: 'Clotrimazole Cream 1%', generic: 'Clotrimazole', category: 'Antifungal (Topical)', forms: ['Cream', 'Lotion', 'Pessary'], commonDosages: ['1%'], interactions: [] },
  { name: 'Terbinafine 250mg', generic: 'Terbinafine', category: 'Antifungal', forms: ['Tablet', 'Cream'], commonDosages: ['250mg'], interactions: ['Warfarin', 'Cyclosporin'] },

  // ─── Antivirals ─────────────────────────────────────────────────────────────
  { name: 'Acyclovir 400mg', generic: 'Acyclovir', category: 'Antiviral', forms: ['Tablet', 'Cream', 'Injection'], commonDosages: ['200mg', '400mg', '800mg'], interactions: ['Probenecid', 'Nephrotoxic drugs'] },
  { name: 'Valacyclovir 500mg', generic: 'Valacyclovir', category: 'Antiviral', forms: ['Tablet'], commonDosages: ['500mg', '1g'], interactions: [] },

  // ─── Antiparasitics ─────────────────────────────────────────────────────────
  { name: 'Albendazole 400mg', generic: 'Albendazole', category: 'Antiparasitic', forms: ['Tablet', 'Syrup'], commonDosages: ['400mg'], interactions: ['Dexamethasone', 'Praziquantel'] },
  { name: 'Mebendazole 100mg', generic: 'Mebendazole', category: 'Antiparasitic', forms: ['Tablet'], commonDosages: ['100mg', '500mg'], interactions: [] },
  { name: 'Ivermectin 6mg', generic: 'Ivermectin', category: 'Antiparasitic', forms: ['Tablet'], commonDosages: ['3mg', '6mg', '12mg'], interactions: ['Warfarin'] },

  // ─── Antimalarials ──────────────────────────────────────────────────────────
  { name: 'Chloroquine 250mg', generic: 'Chloroquine', category: 'Antimalarial', forms: ['Tablet'], commonDosages: ['250mg'], interactions: ['Antacid', 'QT prolonging drugs'] },
  { name: 'Hydroxychloroquine 200mg', generic: 'Hydroxychloroquine', category: 'Antimalarial / DMARD', forms: ['Tablet'], commonDosages: ['200mg', '400mg'], interactions: ['QT prolonging drugs', 'Digoxin'] },
  { name: 'Artemether-Lumefantrine', generic: 'Artemether-Lumefantrine', category: 'Antimalarial', forms: ['Tablet'], commonDosages: ['20mg+120mg'], interactions: ['QT prolonging drugs'] },
  { name: 'Primaquine 15mg', generic: 'Primaquine', category: 'Antimalarial', forms: ['Tablet'], commonDosages: ['7.5mg', '15mg'], interactions: [] },

  // ─── Cardiovascular ─────────────────────────────────────────────────────────
  { name: 'Amlodipine 5mg', generic: 'Amlodipine', category: 'Antihypertensive (CCB)', forms: ['Tablet'], commonDosages: ['2.5mg', '5mg', '10mg'], interactions: ['Statin (high dose)', 'Cyclosporin'] },
  { name: 'Amlodipine 10mg', generic: 'Amlodipine', category: 'Antihypertensive (CCB)', forms: ['Tablet'], commonDosages: ['10mg'], interactions: ['Statin'] },
  { name: 'Nifedipine 10mg', generic: 'Nifedipine', category: 'Antihypertensive (CCB)', forms: ['Tablet', 'Capsule'], commonDosages: ['10mg', '20mg', '30mg'], interactions: ['Grapefruit', 'Digoxin'] },
  { name: 'Felodipine 5mg', generic: 'Felodipine', category: 'Antihypertensive (CCB)', forms: ['Tablet'], commonDosages: ['5mg', '10mg'], interactions: ['Grapefruit'] },
  { name: 'Enalapril 5mg', generic: 'Enalapril', category: 'Antihypertensive (ACE Inhibitor)', forms: ['Tablet'], commonDosages: ['2.5mg', '5mg', '10mg', '20mg'], interactions: ['Potassium', 'Spironolactone', 'NSAID', 'Lithium'] },
  { name: 'Ramipril 5mg', generic: 'Ramipril', category: 'Antihypertensive (ACE Inhibitor)', forms: ['Tablet', 'Capsule'], commonDosages: ['1.25mg', '2.5mg', '5mg', '10mg'], interactions: ['Potassium', 'NSAID', 'Lithium'] },
  { name: 'Losartan 50mg', generic: 'Losartan', category: 'Antihypertensive (ARB)', forms: ['Tablet'], commonDosages: ['25mg', '50mg', '100mg'], interactions: ['Potassium', 'NSAID', 'Lithium'] },
  { name: 'Telmisartan 40mg', generic: 'Telmisartan', category: 'Antihypertensive (ARB)', forms: ['Tablet'], commonDosages: ['20mg', '40mg', '80mg'], interactions: ['Potassium', 'NSAID', 'Lithium', 'Digoxin'] },
  { name: 'Valsartan 80mg', generic: 'Valsartan', category: 'Antihypertensive (ARB)', forms: ['Tablet'], commonDosages: ['40mg', '80mg', '160mg'], interactions: ['Potassium', 'NSAID'] },
  { name: 'Metoprolol 25mg', generic: 'Metoprolol', category: 'Antihypertensive (Beta-blocker)', forms: ['Tablet'], commonDosages: ['12.5mg', '25mg', '50mg', '100mg'], interactions: ['Verapamil', 'Diltiazem', 'Insulin', 'Clonidine'] },
  { name: 'Atenolol 50mg', generic: 'Atenolol', category: 'Antihypertensive (Beta-blocker)', forms: ['Tablet'], commonDosages: ['25mg', '50mg', '100mg'], interactions: ['Verapamil', 'Insulin', 'Clonidine'] },
  { name: 'Carvedilol 6.25mg', generic: 'Carvedilol', category: 'Antihypertensive (Alpha+Beta blocker)', forms: ['Tablet'], commonDosages: ['3.125mg', '6.25mg', '12.5mg', '25mg'], interactions: ['Verapamil', 'Digoxin', 'Insulin'] },
  { name: 'Bisoprolol 5mg', generic: 'Bisoprolol', category: 'Antihypertensive (Beta-blocker)', forms: ['Tablet'], commonDosages: ['2.5mg', '5mg', '10mg'], interactions: ['Verapamil', 'Clonidine'] },
  { name: 'Furosemide 40mg', generic: 'Furosemide', category: 'Diuretic (Loop)', forms: ['Tablet', 'Injection'], commonDosages: ['20mg', '40mg', '80mg'], interactions: ['Aminoglycoside', 'NSAID', 'Digoxin', 'Lithium'] },
  { name: 'Hydrochlorothiazide 12.5mg', generic: 'Hydrochlorothiazide', category: 'Diuretic (Thiazide)', forms: ['Tablet'], commonDosages: ['12.5mg', '25mg'], interactions: ['NSAID', 'Lithium', 'Digoxin'] },
  { name: 'Spironolactone 25mg', generic: 'Spironolactone', category: 'Diuretic (K-sparing)', forms: ['Tablet'], commonDosages: ['25mg', '50mg', '100mg'], interactions: ['ACE inhibitor', 'ARB', 'Potassium', 'NSAID'] },
  { name: 'Digoxin 0.25mg', generic: 'Digoxin', category: 'Cardiac Glycoside', forms: ['Tablet'], commonDosages: ['0.125mg', '0.25mg'], interactions: ['Amiodarone', 'Verapamil', 'Clarithromycin', 'Furosemide'] },
  { name: 'Amiodarone 200mg', generic: 'Amiodarone', category: 'Antiarrhythmic', forms: ['Tablet', 'Injection'], commonDosages: ['100mg', '200mg'], interactions: ['Warfarin', 'Digoxin', 'Simvastatin', 'QT prolonging drugs'] },
  { name: 'Aspirin 75mg', generic: 'Aspirin', category: 'Antiplatelet', forms: ['Tablet'], commonDosages: ['75mg', '150mg', '325mg'], interactions: ['Warfarin', 'NSAID', 'Methotrexate'] },
  { name: 'Clopidogrel 75mg', generic: 'Clopidogrel', category: 'Antiplatelet', forms: ['Tablet'], commonDosages: ['75mg'], interactions: ['Warfarin', 'NSAID', 'PPI (Omeprazole)'] },
  { name: 'Warfarin 2mg', generic: 'Warfarin', category: 'Anticoagulant', forms: ['Tablet'], commonDosages: ['1mg', '2mg', '5mg'], interactions: ['Aspirin', 'NSAID', 'Amiodarone', 'Clarithromycin', 'Fluconazole', 'Metronidazole'] },
  { name: 'Atorvastatin 10mg', generic: 'Atorvastatin', category: 'Statin (Lipid-lowering)', forms: ['Tablet'], commonDosages: ['10mg', '20mg', '40mg', '80mg'], interactions: ['Amiodarone', 'Gemfibrozil', 'Itraconazole', 'Clarithromycin'] },
  { name: 'Rosuvastatin 10mg', generic: 'Rosuvastatin', category: 'Statin (Lipid-lowering)', forms: ['Tablet'], commonDosages: ['5mg', '10mg', '20mg', '40mg'], interactions: ['Gemfibrozil', 'Antacid', 'Warfarin'] },
  { name: 'Simvastatin 20mg', generic: 'Simvastatin', category: 'Statin (Lipid-lowering)', forms: ['Tablet'], commonDosages: ['10mg', '20mg', '40mg'], interactions: ['Amiodarone', 'Amlodipine (high dose)', 'Gemfibrozil'] },
  { name: 'Fenofibrate 145mg', generic: 'Fenofibrate', category: 'Fibrate (Lipid-lowering)', forms: ['Tablet', 'Capsule'], commonDosages: ['67mg', '145mg', '160mg', '200mg'], interactions: ['Statin', 'Warfarin'] },
  { name: 'Isosorbide Mononitrate 20mg', generic: 'Isosorbide Mononitrate', category: 'Nitrate (Anti-anginal)', forms: ['Tablet'], commonDosages: ['10mg', '20mg', '40mg'], interactions: ['Sildenafil', 'Tadalafil'] },
  { name: 'Glyceryl Trinitrate (GTN) Spray', generic: 'Glyceryl Trinitrate', category: 'Nitrate (Anti-anginal)', forms: ['Spray', 'Patch', 'Tablet SL'], commonDosages: ['0.4mg'], interactions: ['Sildenafil', 'Tadalafil'] },

  // ─── Antidiabetics ──────────────────────────────────────────────────────────
  { name: 'Metformin 500mg', generic: 'Metformin', category: 'Antidiabetic (Biguanide)', forms: ['Tablet'], commonDosages: ['500mg', '850mg', '1000mg'], interactions: ['Contrast dye', 'Alcohol'] },
  { name: 'Metformin 1000mg', generic: 'Metformin', category: 'Antidiabetic (Biguanide)', forms: ['Tablet'], commonDosages: ['1000mg'], interactions: ['Contrast dye', 'Alcohol'] },
  { name: 'Glimepiride 1mg', generic: 'Glimepiride', category: 'Antidiabetic (Sulphonylurea)', forms: ['Tablet'], commonDosages: ['1mg', '2mg', '4mg'], interactions: ['Warfarin', 'Fluconazole', 'NSAID'] },
  { name: 'Glimepiride 2mg', generic: 'Glimepiride', category: 'Antidiabetic (Sulphonylurea)', forms: ['Tablet'], commonDosages: ['2mg'], interactions: ['Warfarin', 'Fluconazole'] },
  { name: 'Glibenclamide 5mg', generic: 'Glibenclamide', category: 'Antidiabetic (Sulphonylurea)', forms: ['Tablet'], commonDosages: ['2.5mg', '5mg'], interactions: ['Warfarin', 'Fluconazole', 'NSAID'] },
  { name: 'Sitagliptin 100mg', generic: 'Sitagliptin', category: 'Antidiabetic (DPP-4 inhibitor)', forms: ['Tablet'], commonDosages: ['25mg', '50mg', '100mg'], interactions: [] },
  { name: 'Vildagliptin 50mg', generic: 'Vildagliptin', category: 'Antidiabetic (DPP-4 inhibitor)', forms: ['Tablet'], commonDosages: ['50mg'], interactions: [] },
  { name: 'Empagliflozin 10mg', generic: 'Empagliflozin', category: 'Antidiabetic (SGLT2 inhibitor)', forms: ['Tablet'], commonDosages: ['10mg', '25mg'], interactions: ['Diuretic', 'Insulin'] },
  { name: 'Dapagliflozin 10mg', generic: 'Dapagliflozin', category: 'Antidiabetic (SGLT2 inhibitor)', forms: ['Tablet'], commonDosages: ['5mg', '10mg'], interactions: ['Diuretic', 'Insulin'] },
  { name: 'Pioglitazone 15mg', generic: 'Pioglitazone', category: 'Antidiabetic (Thiazolidinedione)', forms: ['Tablet'], commonDosages: ['15mg', '30mg', '45mg'], interactions: ['Insulin', 'Gemfibrozil'] },
  { name: 'Human Insulin (Regular) 100IU/mL', generic: 'Insulin Regular', category: 'Antidiabetic (Insulin)', forms: ['Injection'], commonDosages: ['4IU', '6IU', '8IU', '10IU', '12IU'], interactions: ['Beta-blocker', 'ACE inhibitor', 'Corticosteroids', 'Alcohol'] },
  { name: 'Insulin Glargine 100IU/mL', generic: 'Insulin Glargine', category: 'Antidiabetic (Long-acting insulin)', forms: ['Injection'], commonDosages: ['10IU', '20IU', '30IU'], interactions: ['Beta-blocker', 'Corticosteroids'] },

  // ─── Thyroid ────────────────────────────────────────────────────────────────
  { name: 'Levothyroxine 25mcg', generic: 'Levothyroxine', category: 'Thyroid Hormone', forms: ['Tablet'], commonDosages: ['25mcg', '50mcg', '75mcg', '100mcg', '125mcg', '150mcg'], interactions: ['Antacid', 'Calcium', 'Iron', 'Warfarin'] },
  { name: 'Levothyroxine 50mcg', generic: 'Levothyroxine', category: 'Thyroid Hormone', forms: ['Tablet'], commonDosages: ['50mcg'], interactions: ['Antacid', 'Calcium', 'Iron'] },
  { name: 'Carbimazole 5mg', generic: 'Carbimazole', category: 'Antithyroid', forms: ['Tablet'], commonDosages: ['5mg', '10mg', '20mg'], interactions: ['Warfarin'] },
  { name: 'Propylthiouracil 50mg', generic: 'Propylthiouracil', category: 'Antithyroid', forms: ['Tablet'], commonDosages: ['50mg', '100mg'], interactions: ['Warfarin'] },

  // ─── Gastrointestinal ───────────────────────────────────────────────────────
  { name: 'Omeprazole 20mg', generic: 'Omeprazole', category: 'PPI (Antacid)', forms: ['Capsule', 'Injection'], commonDosages: ['10mg', '20mg', '40mg'], interactions: ['Clopidogrel', 'Methotrexate', 'Warfarin'] },
  { name: 'Pantoprazole 40mg', generic: 'Pantoprazole', category: 'PPI (Antacid)', forms: ['Tablet', 'Injection'], commonDosages: ['20mg', '40mg'], interactions: ['Methotrexate'] },
  { name: 'Rabeprazole 20mg', generic: 'Rabeprazole', category: 'PPI (Antacid)', forms: ['Tablet'], commonDosages: ['10mg', '20mg'], interactions: [] },
  { name: 'Esomeprazole 40mg', generic: 'Esomeprazole', category: 'PPI (Antacid)', forms: ['Tablet', 'Capsule'], commonDosages: ['20mg', '40mg'], interactions: ['Clopidogrel'] },
  { name: 'Ranitidine 150mg', generic: 'Ranitidine', category: 'H2-Blocker (Antacid)', forms: ['Tablet', 'Injection'], commonDosages: ['150mg', '300mg'], interactions: [] },
  { name: 'Famotidine 20mg', generic: 'Famotidine', category: 'H2-Blocker (Antacid)', forms: ['Tablet'], commonDosages: ['20mg', '40mg'], interactions: [] },
  { name: 'Antacid Suspension', generic: 'Aluminium Hydroxide + Magnesium Hydroxide', category: 'Antacid', forms: ['Suspension'], commonDosages: ['10mL', '15mL', '30mL'], interactions: ['Fluoroquinolone', 'Tetracycline', 'Iron', 'Levothyroxine'] },
  { name: 'Domperidone 10mg', generic: 'Domperidone', category: 'Prokinetic / Antiemetic', forms: ['Tablet', 'Syrup'], commonDosages: ['10mg'], interactions: ['QT prolonging drugs', 'Erythromycin'] },
  { name: 'Metoclopramide 10mg', generic: 'Metoclopramide', category: 'Prokinetic / Antiemetic', forms: ['Tablet', 'Injection'], commonDosages: ['10mg'], interactions: ['Opioid', 'Digoxin'] },
  { name: 'Ondansetron 4mg', generic: 'Ondansetron', category: 'Antiemetic (5-HT3 antagonist)', forms: ['Tablet', 'Injection', 'Syrup'], commonDosages: ['4mg', '8mg'], interactions: ['Tramadol', 'QT prolonging drugs', 'SSRI'] },
  { name: 'Promethazine 25mg', generic: 'Promethazine', category: 'Antiemetic / Antihistamine', forms: ['Tablet', 'Injection'], commonDosages: ['25mg'], interactions: ['Alcohol', 'CNS depressants'] },
  { name: 'Loperamide 2mg', generic: 'Loperamide', category: 'Antidiarrhoeal', forms: ['Capsule', 'Tablet'], commonDosages: ['2mg'], interactions: ['Rifampicin', 'Antifungal'] },
  { name: 'Lactulose 10g/15mL', generic: 'Lactulose', category: 'Laxative (Osmotic)', forms: ['Syrup'], commonDosages: ['15mL', '30mL'], interactions: ['Antacid'] },
  { name: 'Bisacodyl 5mg', generic: 'Bisacodyl', category: 'Laxative (Stimulant)', forms: ['Tablet', 'Suppository'], commonDosages: ['5mg', '10mg'], interactions: ['Antacid'] },
  { name: 'Psyllium Husk (Isabgol)', generic: 'Psyllium', category: 'Laxative (Bulk-forming)', forms: ['Granules', 'Powder'], commonDosages: ['5g', '10g'], interactions: [] },
  { name: 'Ursodeoxycholic Acid 300mg', generic: 'Ursodeoxycholic Acid', category: 'Hepatoprotective', forms: ['Tablet', 'Capsule'], commonDosages: ['150mg', '300mg'], interactions: ['Antacid', 'Cholestyramine'] },
  { name: 'Silymarin 140mg', generic: 'Silymarin', category: 'Hepatoprotective', forms: ['Tablet', 'Capsule'], commonDosages: ['140mg', '280mg'], interactions: [] },
  { name: 'Drotaverine 40mg', generic: 'Drotaverine', category: 'Antispasmodic', forms: ['Tablet', 'Injection'], commonDosages: ['40mg', '80mg'], interactions: [] },
  { name: 'Mebeverine 135mg', generic: 'Mebeverine', category: 'Antispasmodic (IBS)', forms: ['Tablet'], commonDosages: ['135mg', '200mg'], interactions: [] },
  { name: 'Hyoscine Butylbromide 10mg', generic: 'Hyoscine Butylbromide', category: 'Antispasmodic', forms: ['Tablet', 'Injection'], commonDosages: ['10mg', '20mg'], interactions: [] },

  // ─── Respiratory ────────────────────────────────────────────────────────────
  { name: 'Salbutamol Inhaler 100mcg', generic: 'Salbutamol', category: 'Bronchodilator (SABA)', forms: ['Inhaler', 'Nebulization', 'Tablet'], commonDosages: ['2 puffs', '2.5mg neb'], interactions: ['Beta-blocker'] },
  { name: 'Levosalbutamol Inhaler 50mcg', generic: 'Levosalbutamol', category: 'Bronchodilator (SABA)', forms: ['Inhaler'], commonDosages: ['2 puffs'], interactions: ['Beta-blocker'] },
  { name: 'Ipratropium Bromide Inhaler', generic: 'Ipratropium', category: 'Bronchodilator (SAMA)', forms: ['Inhaler', 'Nebulization'], commonDosages: ['2 puffs', '0.5mg neb'], interactions: [] },
  { name: 'Tiotropium Inhaler 18mcg', generic: 'Tiotropium', category: 'Bronchodilator (LAMA) - COPD', forms: ['Inhaler (Handihaler)'], commonDosages: ['18mcg'], interactions: [] },
  { name: 'Salmeterol-Fluticasone Inhaler', generic: 'Salmeterol+Fluticasone', category: 'ICS+LABA (Asthma/COPD)', forms: ['Inhaler'], commonDosages: ['25/125mcg', '25/250mcg', '50/250mcg'], interactions: ['Beta-blocker'] },
  { name: 'Budesonide Inhaler 200mcg', generic: 'Budesonide', category: 'Inhaled Corticosteroid', forms: ['Inhaler'], commonDosages: ['100mcg', '200mcg', '400mcg'], interactions: [] },
  { name: 'Montelukast 10mg', generic: 'Montelukast', category: 'Leukotriene Receptor Antagonist (Asthma)', forms: ['Tablet'], commonDosages: ['4mg', '5mg', '10mg'], interactions: [] },
  { name: 'Theophylline 200mg', generic: 'Theophylline', category: 'Bronchodilator (Xanthine)', forms: ['Tablet'], commonDosages: ['100mg', '200mg', '300mg'], interactions: ['Fluoroquinolone', 'Macrolide', 'Rifampicin', 'Cimetidine'] },
  { name: 'Ambroxol 30mg', generic: 'Ambroxol', category: 'Mucolytic', forms: ['Tablet', 'Syrup'], commonDosages: ['30mg', '75mg SR'], interactions: [] },
  { name: 'Acetylcysteine 600mg', generic: 'Acetylcysteine', category: 'Mucolytic', forms: ['Tablet', 'Granules', 'Injection'], commonDosages: ['200mg', '600mg'], interactions: ['Nitrates', 'Activated charcoal'] },
  { name: 'Bromhexine 8mg', generic: 'Bromhexine', category: 'Mucolytic', forms: ['Tablet', 'Syrup'], commonDosages: ['4mg', '8mg'], interactions: ['Antibiotic (enhances penetration)'] },
  { name: 'Dextromethorphan 15mg', generic: 'Dextromethorphan', category: 'Cough Suppressant', forms: ['Tablet', 'Syrup'], commonDosages: ['15mg', '30mg'], interactions: ['MAO inhibitor', 'SSRI'] },
  { name: 'Codeine Linctus 10mg/5mL', generic: 'Codeine', category: 'Cough Suppressant (Opioid)', forms: ['Syrup'], commonDosages: ['10mL', '15mL'], interactions: ['MAO inhibitor', 'CNS depressants'] },
  { name: 'Guaifenesin 100mg', generic: 'Guaifenesin', category: 'Expectorant', forms: ['Tablet', 'Syrup'], commonDosages: ['100mg', '200mg'], interactions: [] },

  // ─── Antihistamines / Allergy ────────────────────────────────────────────────
  { name: 'Cetirizine 10mg', generic: 'Cetirizine', category: 'Antihistamine (2nd gen)', forms: ['Tablet', 'Syrup'], commonDosages: ['5mg', '10mg'], interactions: ['Alcohol', 'CNS depressants'] },
  { name: 'Loratadine 10mg', generic: 'Loratadine', category: 'Antihistamine (2nd gen)', forms: ['Tablet', 'Syrup'], commonDosages: ['5mg', '10mg'], interactions: [] },
  { name: 'Fexofenadine 120mg', generic: 'Fexofenadine', category: 'Antihistamine (2nd gen)', forms: ['Tablet'], commonDosages: ['60mg', '120mg', '180mg'], interactions: ['Antacid'] },
  { name: 'Levocetirizine 5mg', generic: 'Levocetirizine', category: 'Antihistamine (2nd gen)', forms: ['Tablet', 'Syrup'], commonDosages: ['2.5mg', '5mg'], interactions: ['Alcohol'] },
  { name: 'Chlorpheniramine 4mg', generic: 'Chlorpheniramine', category: 'Antihistamine (1st gen - sedating)', forms: ['Tablet'], commonDosages: ['4mg'], interactions: ['Alcohol', 'CNS depressants', 'MAO inhibitor'] },
  { name: 'Hydroxyzine 25mg', generic: 'Hydroxyzine', category: 'Antihistamine / Anxiolytic', forms: ['Tablet'], commonDosages: ['10mg', '25mg', '50mg'], interactions: ['Alcohol', 'CNS depressants', 'QT prolonging drugs'] },

  // ─── Corticosteroids ─────────────────────────────────────────────────────────
  { name: 'Prednisolone 5mg', generic: 'Prednisolone', category: 'Corticosteroid', forms: ['Tablet'], commonDosages: ['5mg', '10mg', '20mg', '40mg', '60mg'], interactions: ['NSAID', 'Warfarin', 'Insulin', 'Antidiabetic'] },
  { name: 'Dexamethasone 0.5mg', generic: 'Dexamethasone', category: 'Corticosteroid', forms: ['Tablet', 'Injection'], commonDosages: ['0.5mg', '4mg', '8mg'], interactions: ['NSAID', 'Warfarin', 'Insulin'] },
  { name: 'Methylprednisolone 4mg', generic: 'Methylprednisolone', category: 'Corticosteroid', forms: ['Tablet', 'Injection'], commonDosages: ['4mg', '8mg', '16mg'], interactions: ['NSAID', 'Warfarin', 'Insulin'] },
  { name: 'Betamethasone 0.5mg', generic: 'Betamethasone', category: 'Corticosteroid', forms: ['Tablet', 'Injection', 'Cream'], commonDosages: ['0.5mg'], interactions: ['NSAID', 'Insulin'] },
  { name: 'Hydrocortisone 100mg', generic: 'Hydrocortisone', category: 'Corticosteroid', forms: ['Injection', 'Cream'], commonDosages: ['100mg', '200mg'], interactions: ['NSAID', 'Insulin'] },

  // ─── CNS / Neurological ─────────────────────────────────────────────────────
  { name: 'Phenytoin 100mg', generic: 'Phenytoin', category: 'Antiepileptic', forms: ['Tablet', 'Injection'], commonDosages: ['100mg'], interactions: ['Warfarin', 'Oral contraceptive', 'Isoniazid', 'Valproate'] },
  { name: 'Valproic Acid 200mg', generic: 'Valproic Acid', category: 'Antiepileptic / Mood Stabilizer', forms: ['Tablet', 'Syrup'], commonDosages: ['200mg', '500mg', '500mg CR'], interactions: ['Aspirin', 'Warfarin', 'Phenytoin', 'Carbamazepine'] },
  { name: 'Carbamazepine 200mg', generic: 'Carbamazepine', category: 'Antiepileptic / Mood Stabilizer', forms: ['Tablet'], commonDosages: ['100mg', '200mg', '400mg'], interactions: ['OCP', 'Warfarin', 'Valproate', 'Macrolide'] },
  { name: 'Levetiracetam 500mg', generic: 'Levetiracetam', category: 'Antiepileptic', forms: ['Tablet', 'Injection'], commonDosages: ['250mg', '500mg', '1000mg'], interactions: [] },
  { name: 'Clonazepam 0.5mg', generic: 'Clonazepam', category: 'Benzodiazepine / Antiepileptic', forms: ['Tablet'], commonDosages: ['0.25mg', '0.5mg', '1mg', '2mg'], interactions: ['Alcohol', 'CNS depressants', 'Opioids'] },
  { name: 'Diazepam 5mg', generic: 'Diazepam', category: 'Benzodiazepine / Anxiolytic', forms: ['Tablet', 'Injection'], commonDosages: ['2mg', '5mg', '10mg'], interactions: ['Alcohol', 'CNS depressants', 'Opioids'] },
  { name: 'Alprazolam 0.25mg', generic: 'Alprazolam', category: 'Benzodiazepine / Anxiolytic', forms: ['Tablet'], commonDosages: ['0.25mg', '0.5mg', '1mg'], interactions: ['Alcohol', 'CNS depressants', 'Opioids', 'Itraconazole'] },
  { name: 'Lorazepam 1mg', generic: 'Lorazepam', category: 'Benzodiazepine / Anxiolytic', forms: ['Tablet', 'Injection'], commonDosages: ['0.5mg', '1mg', '2mg'], interactions: ['Alcohol', 'CNS depressants', 'Opioids'] },
  { name: 'Sertraline 50mg', generic: 'Sertraline', category: 'Antidepressant (SSRI)', forms: ['Tablet'], commonDosages: ['25mg', '50mg', '100mg'], interactions: ['MAO inhibitor', 'Tramadol', 'Ondansetron', 'Warfarin'] },
  { name: 'Escitalopram 10mg', generic: 'Escitalopram', category: 'Antidepressant (SSRI)', forms: ['Tablet'], commonDosages: ['5mg', '10mg', '20mg'], interactions: ['MAO inhibitor', 'Tramadol', 'Ondansetron'] },
  { name: 'Fluoxetine 20mg', generic: 'Fluoxetine', category: 'Antidepressant (SSRI)', forms: ['Capsule'], commonDosages: ['10mg', '20mg', '40mg'], interactions: ['MAO inhibitor', 'Tramadol', 'Warfarin'] },
  { name: 'Amitriptyline 10mg', generic: 'Amitriptyline', category: 'Antidepressant (TCA) / Neuropathic pain', forms: ['Tablet'], commonDosages: ['10mg', '25mg', '50mg'], interactions: ['MAO inhibitor', 'Alcohol', 'QT prolonging drugs', 'Anticholinergics'] },
  { name: 'Pregabalin 75mg', generic: 'Pregabalin', category: 'Neuropathic pain / Antiepileptic', forms: ['Capsule'], commonDosages: ['25mg', '75mg', '150mg', '300mg'], interactions: ['Alcohol', 'CNS depressants', 'Benzodiazepine'] },
  { name: 'Gabapentin 300mg', generic: 'Gabapentin', category: 'Neuropathic pain / Antiepileptic', forms: ['Capsule'], commonDosages: ['100mg', '300mg', '400mg'], interactions: ['Alcohol', 'Opioids', 'Antacid'] },
  { name: 'Sumatriptan 50mg', generic: 'Sumatriptan', category: 'Triptan (Migraine)', forms: ['Tablet', 'Injection', 'Nasal spray'], commonDosages: ['50mg', '100mg'], interactions: ['MAO inhibitor', 'SSRI', 'Ergotamine'] },
  { name: 'Cinnarizine 25mg', generic: 'Cinnarizine', category: 'Antivertigo', forms: ['Tablet'], commonDosages: ['25mg'], interactions: ['Alcohol', 'CNS depressants'] },
  { name: 'Betahistine 8mg', generic: 'Betahistine', category: 'Antivertigo (Meniere\'s)', forms: ['Tablet'], commonDosages: ['8mg', '16mg', '24mg'], interactions: ['Antihistamine'] },
  { name: 'Levodopa-Carbidopa 100/25mg', generic: 'Levodopa+Carbidopa', category: 'Anti-Parkinson', forms: ['Tablet'], commonDosages: ['100/25mg', '250/25mg'], interactions: ['MAO inhibitor', 'Antipsychotic', 'Iron'] },
  { name: 'Donepezil 5mg', generic: 'Donepezil', category: 'Cholinesterase inhibitor (Dementia)', forms: ['Tablet'], commonDosages: ['5mg', '10mg'], interactions: ['Anticholinergics', 'NSAIDs'] },
  { name: 'Rivastigmine 1.5mg', generic: 'Rivastigmine', category: 'Cholinesterase inhibitor (Dementia)', forms: ['Capsule', 'Patch'], commonDosages: ['1.5mg', '3mg', '4.5mg', '6mg'], interactions: ['Anticholinergics'] },
  { name: 'Haloperidol 5mg', generic: 'Haloperidol', category: 'Antipsychotic (Typical)', forms: ['Tablet', 'Injection'], commonDosages: ['0.5mg', '1mg', '2mg', '5mg'], interactions: ['QT prolonging drugs', 'Lithium', 'CNS depressants'] },
  { name: 'Risperidone 2mg', generic: 'Risperidone', category: 'Antipsychotic (Atypical)', forms: ['Tablet'], commonDosages: ['0.5mg', '1mg', '2mg', '4mg'], interactions: ['QT prolonging drugs', 'CNS depressants'] },
  { name: 'Quetiapine 25mg', generic: 'Quetiapine', category: 'Antipsychotic (Atypical)', forms: ['Tablet'], commonDosages: ['25mg', '50mg', '100mg', '200mg'], interactions: ['QT prolonging drugs', 'Alcohol', 'CNS depressants'] },
  { name: 'Lithium Carbonate 300mg', generic: 'Lithium', category: 'Mood Stabilizer', forms: ['Tablet'], commonDosages: ['300mg'], interactions: ['NSAID', 'ACE inhibitor', 'Diuretic', 'Metronidazole'] },
  { name: 'Zolpidem 10mg', generic: 'Zolpidem', category: 'Hypnotic (sleep aid)', forms: ['Tablet'], commonDosages: ['5mg', '10mg'], interactions: ['Alcohol', 'CNS depressants', 'Opioids'] },
  { name: 'Melatonin 3mg', generic: 'Melatonin', category: 'Sleep Aid (Chronobiotic)', forms: ['Tablet'], commonDosages: ['3mg', '5mg', '10mg'], interactions: ['Warfarin', 'Fluvoxamine'] },

  // ─── Vitamins & Supplements ──────────────────────────────────────────────────
  { name: 'Vitamin D3 60,000IU', generic: 'Cholecalciferol', category: 'Vitamin / Supplement', forms: ['Tablet', 'Sachet', 'Drops'], commonDosages: ['1000IU', '2000IU', '60000IU'], interactions: ['Thiazide diuretic', 'Digoxin'] },
  { name: 'Vitamin B12 1500mcg', generic: 'Methylcobalamin', category: 'Vitamin / Supplement', forms: ['Tablet', 'Injection'], commonDosages: ['500mcg', '1500mcg'], interactions: [] },
  { name: 'Folic Acid 5mg', generic: 'Folic Acid', category: 'Vitamin / Supplement', forms: ['Tablet'], commonDosages: ['0.4mg', '1mg', '5mg'], interactions: ['Methotrexate'] },
  { name: 'Ferrous Sulphate 325mg', generic: 'Ferrous Sulphate', category: 'Iron Supplement', forms: ['Tablet', 'Syrup'], commonDosages: ['150mg elemental Fe', '325mg'], interactions: ['Fluoroquinolone', 'Tetracycline', 'Levothyroxine', 'Antacid'] },
  { name: 'Iron Sucrose 100mg IV', generic: 'Iron Sucrose', category: 'IV Iron', forms: ['Injection'], commonDosages: ['100mg', '200mg'], interactions: ['Oral iron'] },
  { name: 'Calcium Carbonate 500mg', generic: 'Calcium Carbonate', category: 'Calcium Supplement', forms: ['Tablet'], commonDosages: ['500mg', '1000mg'], interactions: ['Fluoroquinolone', 'Iron', 'Levothyroxine', 'Digoxin'] },
  { name: 'Zinc 10mg', generic: 'Zinc Sulphate', category: 'Mineral Supplement', forms: ['Tablet', 'Syrup'], commonDosages: ['10mg', '20mg'], interactions: ['Fluoroquinolone', 'Iron'] },
  { name: 'Vitamin C 500mg', generic: 'Ascorbic Acid', category: 'Vitamin', forms: ['Tablet'], commonDosages: ['250mg', '500mg', '1000mg'], interactions: [] },
  { name: 'Omega-3 Fatty Acids 1000mg', generic: 'Omega-3', category: 'Supplement (Lipid-lowering)', forms: ['Capsule'], commonDosages: ['1000mg', '2000mg'], interactions: ['Warfarin', 'Aspirin'] },

  // ─── Musculoskeletal ─────────────────────────────────────────────────────────
  { name: 'Thiocolchicoside 4mg', generic: 'Thiocolchicoside', category: 'Muscle Relaxant', forms: ['Tablet'], commonDosages: ['4mg', '8mg'], interactions: ['Alcohol', 'CNS depressants'] },
  { name: 'Methocarbamol 750mg', generic: 'Methocarbamol', category: 'Muscle Relaxant', forms: ['Tablet'], commonDosages: ['750mg', '1500mg'], interactions: ['Alcohol', 'CNS depressants'] },
  { name: 'Baclofen 10mg', generic: 'Baclofen', category: 'Muscle Relaxant (Spasticity)', forms: ['Tablet'], commonDosages: ['5mg', '10mg', '20mg'], interactions: ['Alcohol', 'CNS depressants'] },
  { name: 'Alendronate 70mg', generic: 'Alendronate', category: 'Bisphosphonate (Osteoporosis)', forms: ['Tablet'], commonDosages: ['10mg', '70mg'], interactions: ['Calcium', 'Antacid', 'NSAID'] },
  { name: 'Risedronate 35mg', generic: 'Risedronate', category: 'Bisphosphonate (Osteoporosis)', forms: ['Tablet'], commonDosages: ['5mg', '35mg'], interactions: ['Calcium', 'Antacid'] },
  { name: 'Methotrexate 2.5mg', generic: 'Methotrexate', category: 'DMARD (Rheumatoid Arthritis)', forms: ['Tablet', 'Injection'], commonDosages: ['2.5mg', '7.5mg/week', '15mg/week'], interactions: ['NSAID', 'Aspirin', 'TMP-SMX', 'Folic acid (required)'] },
  { name: 'Colchicine 0.5mg', generic: 'Colchicine', category: 'Antigout', forms: ['Tablet'], commonDosages: ['0.5mg', '1mg'], interactions: ['Statin', 'Clarithromycin', 'Cyclosporin'] },
  { name: 'Allopurinol 100mg', generic: 'Allopurinol', category: 'Uricosuric (Gout prophylaxis)', forms: ['Tablet'], commonDosages: ['100mg', '200mg', '300mg'], interactions: ['Azathioprine', 'Warfarin', 'ACE inhibitor'] },
  { name: 'Febuxostat 40mg', generic: 'Febuxostat', category: 'Uricosuric (Gout prophylaxis)', forms: ['Tablet'], commonDosages: ['40mg', '80mg', '120mg'], interactions: ['Azathioprine', '6-Mercaptopurine'] },

  // ─── Urology ─────────────────────────────────────────────────────────────────
  { name: 'Tamsulosin 0.4mg', generic: 'Tamsulosin', category: 'Alpha-blocker (BPH)', forms: ['Capsule'], commonDosages: ['0.2mg', '0.4mg'], interactions: ['Antihypertensive'] },
  { name: 'Alfuzosin 10mg', generic: 'Alfuzosin', category: 'Alpha-blocker (BPH)', forms: ['Tablet'], commonDosages: ['5mg', '10mg'], interactions: ['Antihypertensive', 'QT prolonging drugs'] },
  { name: 'Finasteride 5mg', generic: 'Finasteride', category: '5-alpha Reductase Inhibitor (BPH)', forms: ['Tablet'], commonDosages: ['1mg', '5mg'], interactions: [] },
  { name: 'Oxybutynin 5mg', generic: 'Oxybutynin', category: 'Anticholinergic (Overactive bladder)', forms: ['Tablet'], commonDosages: ['5mg'], interactions: ['Anticholinergics', 'CNS depressants'] },

  // ─── Gynaecology / Hormones ─────────────────────────────────────────────────
  { name: 'OCP (Ethinyl Estradiol + Levonorgestrel)', generic: 'Combined OCP', category: 'Oral Contraceptive Pill', forms: ['Tablet'], commonDosages: ['30mcg+150mcg'], interactions: ['Rifampicin', 'Carbamazepine', 'Phenytoin'] },
  { name: 'Norethisterone 5mg', generic: 'Norethisterone', category: 'Progestogen', forms: ['Tablet'], commonDosages: ['5mg', '10mg'], interactions: [] },
  { name: 'Micronized Progesterone 100mg', generic: 'Progesterone', category: 'Progestogen', forms: ['Tablet', 'Capsule', 'Gel'], commonDosages: ['100mg', '200mg'], interactions: [] },
  { name: 'Clomiphene 50mg', generic: 'Clomiphene', category: 'Ovulation Induction', forms: ['Tablet'], commonDosages: ['50mg', '100mg'], interactions: [] },
  { name: 'Mifepristone 200mg', generic: 'Mifepristone', category: 'Antiprogesterone', forms: ['Tablet'], commonDosages: ['200mg'], interactions: ['NSAID'] },
  { name: 'Misoprostol 200mcg', generic: 'Misoprostol', category: 'Prostaglandin', forms: ['Tablet'], commonDosages: ['200mcg'], interactions: ['Antacid'] },
  { name: 'Tranexamic Acid 500mg', generic: 'Tranexamic Acid', category: 'Antifibrinolytic (menorrhagia)', forms: ['Tablet', 'Injection'], commonDosages: ['250mg', '500mg'], interactions: ['Oral contraceptive', 'Factor IX'] },

  // ─── Topicals ───────────────────────────────────────────────────────────────
  { name: 'Mupirocin 2% Ointment', generic: 'Mupirocin', category: 'Topical Antibiotic', forms: ['Ointment'], commonDosages: ['2%'], interactions: [] },
  { name: 'Fusidic Acid Cream 2%', generic: 'Fusidic Acid', category: 'Topical Antibiotic', forms: ['Cream'], commonDosages: ['2%'], interactions: [] },
  { name: 'Hydrocortisone Cream 1%', generic: 'Hydrocortisone', category: 'Topical Corticosteroid (mild)', forms: ['Cream'], commonDosages: ['1%'], interactions: [] },
  { name: 'Betamethasone 0.1% Cream', generic: 'Betamethasone', category: 'Topical Corticosteroid (potent)', forms: ['Cream', 'Ointment'], commonDosages: ['0.05%', '0.1%'], interactions: [] },
  { name: 'Clobetasol 0.05% Cream', generic: 'Clobetasol', category: 'Topical Corticosteroid (very potent)', forms: ['Cream', 'Ointment'], commonDosages: ['0.05%'], interactions: [] },
  { name: 'Calamine Lotion', generic: 'Calamine', category: 'Topical Soothing / Antipruritic', forms: ['Lotion'], commonDosages: ['topical'], interactions: [] },
  { name: 'Povidone Iodine 5% Solution', generic: 'Povidone Iodine', category: 'Antiseptic', forms: ['Solution', 'Ointment'], commonDosages: ['5%', '10%'], interactions: [] },
  { name: 'Silver Sulfadiazine 1% Cream', generic: 'Silver Sulfadiazine', category: 'Topical Antibiotic (Burns)', forms: ['Cream'], commonDosages: ['1%'], interactions: [] },

  // ─── Eye / Ear / Nasal ──────────────────────────────────────────────────────
  { name: 'Ciprofloxacin Eye Drops 0.3%', generic: 'Ciprofloxacin', category: 'Eye Drops (Antibiotic)', forms: ['Eye drops'], commonDosages: ['0.3%'], interactions: [] },
  { name: 'Chloramphenicol Eye Drops 0.5%', generic: 'Chloramphenicol', category: 'Eye Drops (Antibiotic)', forms: ['Eye drops', 'Eye ointment'], commonDosages: ['0.5%'], interactions: [] },
  { name: 'Tobramycin Eye Drops 0.3%', generic: 'Tobramycin', category: 'Eye Drops (Antibiotic)', forms: ['Eye drops'], commonDosages: ['0.3%'], interactions: [] },
  { name: 'Prednisolone Eye Drops 1%', generic: 'Prednisolone', category: 'Eye Drops (Steroid)', forms: ['Eye drops'], commonDosages: ['1%'], interactions: [] },
  { name: 'Latanoprost Eye Drops 0.005%', generic: 'Latanoprost', category: 'Eye Drops (Glaucoma)', forms: ['Eye drops'], commonDosages: ['0.005%'], interactions: [] },
  { name: 'Timolol Eye Drops 0.5%', generic: 'Timolol', category: 'Eye Drops (Glaucoma - Beta-blocker)', forms: ['Eye drops'], commonDosages: ['0.25%', '0.5%'], interactions: ['Beta-blocker (systemic)'] },
  { name: 'Artificial Tears / Lubricant Eye Drops', generic: 'Carboxymethylcellulose / Hyaluronic Acid', category: 'Eye lubricant', forms: ['Eye drops'], commonDosages: ['0.5%', '1%'], interactions: [] },
  { name: 'Ciprofloxacin Ear Drops 0.3%', generic: 'Ciprofloxacin', category: 'Ear Drops (Antibiotic)', forms: ['Ear drops'], commonDosages: ['0.3%'], interactions: [] },
  { name: 'Betamethasone + Clotrimazole Ear Drops', generic: 'Betamethasone+Clotrimazole', category: 'Ear Drops (Steroid+Antifungal)', forms: ['Ear drops'], commonDosages: ['combination'], interactions: [] },
  { name: 'Xylometazoline Nasal Drops 0.1%', generic: 'Xylometazoline', category: 'Nasal Decongestant', forms: ['Nasal drops', 'Nasal spray'], commonDosages: ['0.05%', '0.1%'], interactions: ['MAO inhibitor', 'Beta-blocker'] },
  { name: 'Fluticasone Nasal Spray 50mcg', generic: 'Fluticasone', category: 'Nasal Corticosteroid (Allergic rhinitis)', forms: ['Nasal spray'], commonDosages: ['50mcg/spray'], interactions: [] },
  { name: 'Mometasone Nasal Spray 50mcg', generic: 'Mometasone', category: 'Nasal Corticosteroid', forms: ['Nasal spray'], commonDosages: ['50mcg/spray'], interactions: [] },

  // ─── ORS / IV Fluids ─────────────────────────────────────────────────────────
  { name: 'ORS Sachet', generic: 'Oral Rehydration Salts', category: 'Rehydration', forms: ['Sachet'], commonDosages: ['1 sachet in 1L water'], interactions: [] },
  { name: 'Normal Saline (NS) 500mL IV', generic: 'Sodium Chloride 0.9%', category: 'IV Fluid', forms: ['IV Bag'], commonDosages: ['500mL', '1000mL'], interactions: [] },
  { name: 'Ringer Lactate 500mL IV', generic: 'Lactated Ringer', category: 'IV Fluid', forms: ['IV Bag'], commonDosages: ['500mL', '1000mL'], interactions: [] },
  { name: 'Dextrose 5% 500mL IV', generic: 'Dextrose 5%', category: 'IV Fluid', forms: ['IV Bag'], commonDosages: ['500mL', '1000mL'], interactions: ['Insulin'] },
];

// Drug search function - returns up to 10 matches
export function searchDrugs(query) {
  if (!query || query.length < 2) return [];
  const q = query.toLowerCase();
  return DRUG_DATABASE.filter(
    d => d.name.toLowerCase().includes(q) ||
         d.generic.toLowerCase().includes(q) ||
         d.category.toLowerCase().includes(q)
  ).slice(0, 10);
}

// Check interactions between a list of prescribed medicines
// Returns array of {drug1, drug2, reason} warnings
export function checkInteractions(rxList) {
  const warnings = [];
  for (let i = 0; i < rxList.length; i++) {
    const drugA = DRUG_DATABASE.find(d => d.name === rxList[i].medicine_name);
    if (!drugA) continue;
    for (let j = i + 1; j < rxList.length; j++) {
      const drugBName = rxList[j].medicine_name;
      const drugBData = DRUG_DATABASE.find(d => d.name === drugBName);
      // Check if A has B's generic in its interaction list
      const aIntB = drugBData && drugA.interactions.some(inter =>
        drugBData.generic.toLowerCase().includes(inter.toLowerCase()) ||
        drugBData.category.toLowerCase().includes(inter.toLowerCase())
      );
      // Check if B has A's generic in its interaction list
      const bIntA = drugBData && drugBData.interactions.some(inter =>
        drugA.generic.toLowerCase().includes(inter.toLowerCase()) ||
        drugA.category.toLowerCase().includes(inter.toLowerCase())
      );
      if (aIntB || bIntA) {
        warnings.push({
          drug1: rxList[i].medicine_name,
          drug2: drugBName,
          severity: 'moderate',
        });
      }
    }
  }
  return warnings;
}

// Helper: get drug info by name
export function getDrugInfo(name) {
  return DRUG_DATABASE.find(d => d.name === name) || null;
}
