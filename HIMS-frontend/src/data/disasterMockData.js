export const JHARKHAND_DATA = [
  { 
    district: "Ranchi", disease: "Dengue", cases: 120, trend: "+18%", 
    hospitals: ["RIMS Ranchi", "Orchid Medical", "MGM Hospital"],
    resources: { kits: "LOW", oxygen: "NORMAL", beds: "MEDIUM" }
  },
  { 
    district: "Dhanbad", disease: "Malaria", cases: 80, trend: "+8%", 
    hospitals: ["PMCH Dhanbad", "Jalan Hospital", "Central Hospital"],
    resources: { kits: "NORMAL", oxygen: "NORMAL", beds: "LOW" }
  },
  { 
    district: "Bokaro", disease: "Typhoid", cases: 45, trend: "-5%", 
    hospitals: ["Bokaro General", "KM Memorial", "Muskan Hospital"],
    resources: { kits: "NORMAL", oxygen: "NORMAL", beds: "NORMAL" }
  },
  { 
    district: "East Singhbhum", districtKey: "Jamshedpur", disease: "Dengue", cases: 95, trend: "+12%", 
    hospitals: ["TMH Jamshedpur", "Tata Main", "Mercy Hospital"],
    resources: { kits: "LOW", oxygen: "HIGH", beds: "LOW" }
  },
  { 
    district: "Hazaribagh", disease: "Malaria", cases: 60, trend: "+15%", 
    hospitals: ["Hazaribagh Medical College", "Arogyam", "SJM Hospital"],
    resources: { kits: "MEDIUM", oxygen: "NORMAL", beds: "NORMAL" }
  },
  { 
    district: "Palamu", disease: "Typhoid", cases: 110, trend: "+22%", 
    hospitals: ["Palamu Medical College", "Sadar Hospital", "Care Hospital"],
    resources: { kits: "LOW", oxygen: "LOW", beds: "LOW" }
  },
];

export const ALERTS = [
  { id: 1, type: "CRITICAL", msg: "Dengue spike detected in Ranchi (Zone 4)", time: "10 mins ago" },
  { id: 2, type: "WARNING", msg: "Malaria diagnostic kits low in Dhanbad", time: "1 hour ago" },
  { id: 3, type: "INFO", msg: "Mobile health unit deployed to Hazaribagh", time: "2 hours ago" },
  { id: 4, type: "CRITICAL", msg: "Unusual Typhoid clustering in Palamu North", time: "4 hours ago" }
];

export const getRiskLevel = (cases) => {
  if (cases > 100) return { label: "HIGH", color: "#ef4444", class: "bg-red-500" };
  if (cases >= 50) return { label: "MEDIUM", color: "#eab308", class: "bg-yellow-500" };
  return { label: "LOW", color: "#22c55e", class: "bg-green-500" };
};
