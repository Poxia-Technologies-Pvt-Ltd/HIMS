import React, { useState, useEffect } from 'react';
import { X, Plus, Trash2, Save, FileText, Activity, Pill } from 'lucide-react';
import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || '';

const ConsultationModal = ({ appointment, onClose, onSaved }) => {
  const [activeTab, setActiveTab] = useState('vitals');
  const [loading, setLoading] = useState(false);

  // Form State
  const [vitals, setVitals] = useState({
    height: '', weight: '', bp_systolic: '', bp_diastolic: '', pulse: '', temperature: '', spo2: ''
  });
  const [clinicalNotes, setClinicalNotes] = useState({
    chiefComplaints: '', diagnosis: '', notes: ''
  });
  const [prescriptions, setPrescriptions] = useState([]);

  useEffect(() => {
    // Fetch existing consultation details if they exist
    const fetchDetails = async () => {
      try {
        const { data } = await axios.get(`${API_URL}/api/consultations/${appointment.appointment_id}`);
        if (data.success && data.consultation) {
          setClinicalNotes({
            chiefComplaints: data.consultation.chief_complaints || '',
            diagnosis: data.consultation.diagnosis || '',
            notes: data.consultation.notes || ''
          });
          if (data.consultation.vitals) {
            setVitals(data.consultation.vitals);
          }
          if (data.consultation.prescriptions) {
            setPrescriptions(data.consultation.prescriptions);
          }
        }
      } catch (err) {
        console.error('Error fetching consultation details:', err);
      }
    };
    fetchDetails();
  }, [appointment.appointment_id]);

  const handleAddPrescription = () => {
    setPrescriptions([...prescriptions, { medicine_name: '', dosage: '', frequency: '', duration: '', instructions: '' }]);
  };

  const handleRemovePrescription = (index) => {
    setPrescriptions(prescriptions.filter((_, i) => i !== index));
  };

  const handlePrescriptionChange = (index, field, value) => {
    const updated = [...prescriptions];
    updated[index][field] = value;
    setPrescriptions(updated);
  };

  const handleSave = async () => {
    setLoading(true);
    try {
      const payload = {
        appointmentId: appointment.appointment_id,
        doctorId: null, // Depending on auth setup, might pass logged in doctor ID
        patientRegNo: appointment.reg_no,
        ...clinicalNotes,
        vitals,
        prescriptions: prescriptions.filter(p => p.medicine_name.trim() !== '')
      };

      const { data } = await axios.post(`${API_URL}/api/consultations`, payload);
      if (data.success) {
        onSaved();
      } else {
        alert(data.message || 'Failed to save');
      }
    } catch (err) {
      console.error(err);
      alert('An error occurred while saving.');
    }
    setLoading(false);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl h-[90vh] flex flex-col overflow-hidden">
        
        {/* Header */}
        <div className="flex justify-between items-center p-6 border-b bg-gray-50">
          <div>
            <h2 className="text-2xl font-bold text-gray-800">Consultation</h2>
            <p className="text-sm text-gray-500 mt-1">
              {appointment.first_name} {appointment.last_name} | {appointment.reg_no} | {appointment.gender}, {new Date().getFullYear() - new Date(appointment.dob).getFullYear()} yrs
            </p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-200 rounded-full transition-colors">
            <X className="w-6 h-6 text-gray-500" />
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar Tabs */}
          <div className="w-64 border-r bg-gray-50 p-4 flex flex-col gap-2">
            <button
              onClick={() => setActiveTab('vitals')}
              className={`flex items-center gap-3 p-3 rounded-lg text-left transition-colors ${activeTab === 'vitals' ? 'bg-indigo-50 text-indigo-700 font-semibold' : 'hover:bg-gray-100 text-gray-600'}`}
            >
              <Activity className="w-5 h-5" /> Vitals
            </button>
            <button
              onClick={() => setActiveTab('notes')}
              className={`flex items-center gap-3 p-3 rounded-lg text-left transition-colors ${activeTab === 'notes' ? 'bg-indigo-50 text-indigo-700 font-semibold' : 'hover:bg-gray-100 text-gray-600'}`}
            >
              <FileText className="w-5 h-5" /> Clinical Notes
            </button>
            <button
              onClick={() => setActiveTab('prescriptions')}
              className={`flex items-center gap-3 p-3 rounded-lg text-left transition-colors ${activeTab === 'prescriptions' ? 'bg-indigo-50 text-indigo-700 font-semibold' : 'hover:bg-gray-100 text-gray-600'}`}
            >
              <Pill className="w-5 h-5" /> Prescriptions
            </button>
          </div>

          {/* Content Area */}
          <div className="flex-1 overflow-y-auto p-8 bg-white">
            
            {activeTab === 'vitals' && (
              <div className="space-y-6 animate-fadeIn">
                <h3 className="text-lg font-semibold text-gray-800 border-b pb-2">Record Vitals</h3>
                <div className="grid grid-cols-2 gap-6">
                  <div><label className="block text-sm text-gray-600 mb-1">Height (cm)</label><input type="number" value={vitals.height} onChange={(e) => setVitals({...vitals, height: e.target.value})} className="w-full border rounded-lg p-2.5 focus:ring-2 focus:ring-indigo-500 outline-none" /></div>
                  <div><label className="block text-sm text-gray-600 mb-1">Weight (kg)</label><input type="number" value={vitals.weight} onChange={(e) => setVitals({...vitals, weight: e.target.value})} className="w-full border rounded-lg p-2.5 focus:ring-2 focus:ring-indigo-500 outline-none" /></div>
                  <div><label className="block text-sm text-gray-600 mb-1">BP Systolic (mmHg)</label><input type="number" value={vitals.bp_systolic} onChange={(e) => setVitals({...vitals, bp_systolic: e.target.value})} className="w-full border rounded-lg p-2.5 focus:ring-2 focus:ring-indigo-500 outline-none" /></div>
                  <div><label className="block text-sm text-gray-600 mb-1">BP Diastolic (mmHg)</label><input type="number" value={vitals.bp_diastolic} onChange={(e) => setVitals({...vitals, bp_diastolic: e.target.value})} className="w-full border rounded-lg p-2.5 focus:ring-2 focus:ring-indigo-500 outline-none" /></div>
                  <div><label className="block text-sm text-gray-600 mb-1">Pulse (bpm)</label><input type="number" value={vitals.pulse} onChange={(e) => setVitals({...vitals, pulse: e.target.value})} className="w-full border rounded-lg p-2.5 focus:ring-2 focus:ring-indigo-500 outline-none" /></div>
                  <div><label className="block text-sm text-gray-600 mb-1">Temperature (°F)</label><input type="number" value={vitals.temperature} onChange={(e) => setVitals({...vitals, temperature: e.target.value})} className="w-full border rounded-lg p-2.5 focus:ring-2 focus:ring-indigo-500 outline-none" /></div>
                  <div><label className="block text-sm text-gray-600 mb-1">SpO2 (%)</label><input type="number" value={vitals.spo2} onChange={(e) => setVitals({...vitals, spo2: e.target.value})} className="w-full border rounded-lg p-2.5 focus:ring-2 focus:ring-indigo-500 outline-none" /></div>
                </div>
              </div>
            )}

            {activeTab === 'notes' && (
              <div className="space-y-6 animate-fadeIn">
                <h3 className="text-lg font-semibold text-gray-800 border-b pb-2">Clinical Notes</h3>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Chief Complaints</label>
                  <textarea rows="4" value={clinicalNotes.chiefComplaints} onChange={(e) => setClinicalNotes({...clinicalNotes, chiefComplaints: e.target.value})} className="w-full border rounded-lg p-3 focus:ring-2 focus:ring-indigo-500 outline-none" placeholder="Patient symptoms..."></textarea>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Diagnosis</label>
                  <textarea rows="3" value={clinicalNotes.diagnosis} onChange={(e) => setClinicalNotes({...clinicalNotes, diagnosis: e.target.value})} className="w-full border rounded-lg p-3 focus:ring-2 focus:ring-indigo-500 outline-none" placeholder="Primary diagnosis..."></textarea>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Additional Notes / Advised Lab Tests</label>
                  <textarea rows="3" value={clinicalNotes.notes} onChange={(e) => setClinicalNotes({...clinicalNotes, notes: e.target.value})} className="w-full border rounded-lg p-3 focus:ring-2 focus:ring-indigo-500 outline-none" placeholder="Follow-up instructions, lab tests to perform..."></textarea>
                </div>
              </div>
            )}

            {activeTab === 'prescriptions' && (
              <div className="space-y-6 animate-fadeIn">
                <div className="flex justify-between items-center border-b pb-2">
                  <h3 className="text-lg font-semibold text-gray-800">Digital Prescriptions</h3>
                  <button onClick={handleAddPrescription} className="flex items-center gap-2 bg-indigo-50 text-indigo-600 px-3 py-1.5 rounded-lg hover:bg-indigo-100 transition-colors text-sm font-medium">
                    <Plus className="w-4 h-4" /> Add Medicine
                  </button>
                </div>
                
                {prescriptions.length === 0 ? (
                  <div className="text-center py-12 text-gray-400 bg-gray-50 rounded-xl border-2 border-dashed">
                    <Pill className="w-12 h-12 mx-auto mb-3 opacity-50" />
                    <p>No medicines added yet.</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {prescriptions.map((rx, idx) => (
                      <div key={idx} className="bg-white border rounded-xl p-4 shadow-sm flex gap-4 items-start relative group">
                        <div className="flex-1 grid grid-cols-12 gap-4">
                          <div className="col-span-12 md:col-span-4">
                            <label className="block text-xs text-gray-500 mb-1">Medicine Name</label>
                            <input type="text" value={rx.medicine_name} onChange={(e) => handlePrescriptionChange(idx, 'medicine_name', e.target.value)} className="w-full border-b pb-1 focus:border-indigo-500 outline-none font-medium text-gray-800" placeholder="e.g. Paracetamol 500mg" />
                          </div>
                          <div className="col-span-6 md:col-span-2">
                            <label className="block text-xs text-gray-500 mb-1">Dosage</label>
                            <input type="text" value={rx.dosage} onChange={(e) => handlePrescriptionChange(idx, 'dosage', e.target.value)} className="w-full border-b pb-1 focus:border-indigo-500 outline-none text-gray-700" placeholder="e.g. 1 Tablet" />
                          </div>
                          <div className="col-span-6 md:col-span-3">
                            <label className="block text-xs text-gray-500 mb-1">Frequency</label>
                            <input type="text" value={rx.frequency} onChange={(e) => handlePrescriptionChange(idx, 'frequency', e.target.value)} className="w-full border-b pb-1 focus:border-indigo-500 outline-none text-gray-700" placeholder="e.g. 1-0-1 (After Food)" />
                          </div>
                          <div className="col-span-6 md:col-span-3">
                            <label className="block text-xs text-gray-500 mb-1">Duration</label>
                            <input type="text" value={rx.duration} onChange={(e) => handlePrescriptionChange(idx, 'duration', e.target.value)} className="w-full border-b pb-1 focus:border-indigo-500 outline-none text-gray-700" placeholder="e.g. 5 Days" />
                          </div>
                          <div className="col-span-12">
                            <input type="text" value={rx.instructions} onChange={(e) => handlePrescriptionChange(idx, 'instructions', e.target.value)} className="w-full text-sm text-gray-500 italic outline-none border-b border-transparent focus:border-gray-300 pb-1" placeholder="Additional instructions..." />
                          </div>
                        </div>
                        <button onClick={() => handleRemovePrescription(idx)} className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                          <Trash2 className="w-5 h-5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t bg-gray-50 flex justify-end gap-3">
          <button onClick={onClose} className="px-6 py-2 rounded-lg text-gray-600 hover:bg-gray-200 transition-colors font-medium">
            Cancel
          </button>
          <button onClick={handleSave} disabled={loading} className="px-6 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-colors font-medium flex items-center gap-2">
            {loading ? 'Saving...' : <><Save className="w-5 h-5" /> Save Consultation</>}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConsultationModal;
