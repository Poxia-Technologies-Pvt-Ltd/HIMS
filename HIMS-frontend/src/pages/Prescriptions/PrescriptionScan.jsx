import React, { useRef, useState } from 'react';
import Webcam from 'react-webcam';
import axios from 'axios';

const PrescriptionScan = () => {
    const webcamRef = useRef(null);
    const [barcodeId, setBarcodeId] = useState('');
    const [image, setImage] = useState(null);
    const [preview, setPreview] = useState('');
    const [loading, setLoading] = useState(false);
    const [proposedData, setProposedData] = useState(null);
    const [isFinalizing, setIsFinalizing] = useState(false);

    const API_BASE = import.meta.env.VITE_API_URL || '';

    const captureImage = async () => {
        const screenshot = webcamRef.current.getScreenshot();
        const blob = await fetch(screenshot).then(r => r.blob());
        const file = new File([blob], 'prescription.jpg', { type: 'image/jpeg' });
        setImage(file);
        setPreview(screenshot);
        setProposedData(null); // Reset proposed data on new capture
    };

    const handleFileUpload = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        setImage(file);
        setPreview(URL.createObjectURL(file));
        setProposedData(null); // Reset proposed data on new upload
    };

    const processAI = async () => {
        if (!barcodeId || !image) {
            return alert('Barcode and image required');
        }

        try {
            setLoading(true);
            const formData = new FormData();
            formData.append('barcodeId', barcodeId);
            formData.append('image', image);

            const response = await axios.post(`${API_BASE}/api/prescriptions/process-ai`, formData, {
                headers: { 'Content-Type': 'multipart/form-data', Authorization: `Bearer ${localStorage.getItem('hims_token')}` },
            });

            if (response.data.success) {
                setProposedData(response.data.proposedData);
            } else {
                alert('Notice: ' + (response.data.message || 'AI Extraction completed but billing could not be finalized.'));
            }
        } catch (err) {
            console.error(err);
            alert('AI Processing Failed');
        } finally {
            setLoading(false);
        }
    };

    const finalizeBilling = async () => {
        try {
            setIsFinalizing(true);
            const response = await axios.post(`${API_BASE}/api/prescriptions/finalize-billing`, proposedData, {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('hims_token')}` }
            });

            if (response.data.success) {
                alert(`Billing Completed!\nBill No: ${response.data.data.billNumber}\nTotal: ₹${response.data.data.totalAmount}`);
                // Reset state
                setProposedData(null);
                setBarcodeId('');
                setImage(null);
                setPreview('');
            }
        } catch (err) {
            console.error(err);
            alert('Finalizing Billing Failed');
        } finally {
            setIsFinalizing(false);
        }
    };

    return (
        <div className="p-6 bg-gray-50 min-h-screen">
            <div className="max-w-4xl mx-auto">
                <div className="bg-white rounded-2xl shadow-xl overflow-hidden">
                    <div className="bg-blue-600 p-6 text-white">
                        <h1 className="text-2xl font-bold">AI Prescription Scanner</h1>
                        <p className="text-blue-100 mt-1">Scan barcode and capture prescription to automate billing</p>
                    </div>

                    <div className="p-8 grid grid-cols-1 md:grid-cols-2 gap-8">
                        {/* Left Side: Inputs */}
                        <div>
                            <div className="mb-6">
                                <label className="block text-sm font-bold text-gray-700 mb-2 uppercase tracking-wider">
                                    1. Scan Barcode ID
                                </label>
                                <input
                                    type="text"
                                    value={barcodeId}
                                    onChange={(e) => setBarcodeId(e.target.value)}
                                    placeholder="Enter or Scan Barcode"
                                    className="w-full border-2 border-gray-200 p-4 rounded-xl focus:border-blue-500 focus:ring-0 transition-all text-lg font-mono"
                                />
                            </div>

                            <div className="mb-6">
                                <label className="block text-sm font-bold text-gray-700 mb-2 uppercase tracking-wider">
                                    2. Prescription Image
                                </label>
                                <div className="relative rounded-2xl overflow-hidden bg-gray-900 shadow-inner group">
                                    <Webcam
                                        ref={webcamRef}
                                        screenshotFormat="image/jpeg"
                                        className="w-full aspect-video object-cover"
                                    />
                                    <div className="absolute bottom-4 left-0 right-0 flex justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button
                                            onClick={captureImage}
                                            className="bg-white text-blue-600 font-bold px-6 py-2 rounded-full shadow-lg hover:bg-blue-50 transition-colors"
                                        >
                                            Take Photo
                                        </button>
                                    </div>
                                </div>
                                <div className="mt-4 flex items-center justify-between">
                                    <input
                                        type="file"
                                        accept="image/*"
                                        onChange={handleFileUpload}
                                        className="hidden"
                                        id="file-upload"
                                    />
                                    <label
                                        htmlFor="file-upload"
                                        className="text-blue-600 hover:text-blue-700 font-medium cursor-pointer flex items-center gap-2"
                                    >
                                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
                                        </svg>
                                        Upload instead
                                    </label>
                                    <button
                                        onClick={captureImage}
                                        className="bg-blue-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-blue-700"
                                    >
                                        Capture
                                    </button>
                                </div>
                            </div>

                            <button
                                onClick={processAI}
                                disabled={loading || !image || !barcodeId}
                                className={`w-full py-4 rounded-xl font-bold text-lg shadow-lg transition-all ${loading || !image || !barcodeId
                                    ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                                    : 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white hover:scale-[1.02] active:scale-95'
                                    }`}
                            >
                                {loading ? (
                                    <span className="flex items-center justify-center gap-2">
                                        <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                        </svg>
                                        Extracting Data...
                                    </span>
                                ) : 'Start AI Analysis'}
                            </button>
                        </div>

                        {/* Right Side: Verification/Preview */}
                        <div className="bg-gray-50 rounded-2xl p-6 border-2 border-dashed border-gray-200 flex flex-col h-full">
                            {!proposedData && !preview && (
                                <div className="flex-1 flex flex-col items-center justify-center text-gray-400 text-center">
                                    <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" className="mb-4">
                                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /><polyline points="10 9 9 9 8 9" />
                                    </svg>
                                    <p>AI results will appear here for verification</p>
                                </div>
                            )}

                            {preview && !proposedData && (
                                <div className="flex-1">
                                    <h3 className="font-bold text-gray-700 mb-3">Image Preview</h3>
                                    <img src={preview} alt="preview" className="rounded-xl w-full object-contain border shadow-sm max-h-[400px]" />
                                </div>
                            )}

                            {proposedData && (
                                <div className="flex-1 animate-in fade-in slide-in-from-right-4 duration-500">
                                    <div className="flex items-center justify-between mb-4">
                                        <h3 className="text-lg font-bold text-gray-800">Verify AI Extraction</h3>
                                        <span className="bg-green-100 text-green-700 text-xs font-bold px-2 py-1 rounded">Success</span>
                                    </div>

                                    <div className="space-y-4">
                                        <div className="bg-white p-4 rounded-xl border shadow-sm">
                                            <p className="text-xs text-gray-500 uppercase font-bold mb-1">Patient Name</p>
                                            <p className="text-gray-900 font-semibold">{proposedData.patientName || 'Not Found'}</p>
                                        </div>

                                        <div className="bg-white p-4 rounded-xl border shadow-sm">
                                            <p className="text-xs text-gray-500 uppercase font-bold mb-1">Matched Tests</p>
                                            <div className="space-y-2 mt-2">
                                                {proposedData.tests.map((test, i) => (
                                                    <div key={i} className="flex justify-between items-center text-sm bg-blue-50 p-2 rounded-lg border border-blue-100">
                                                        <span className="text-blue-900 font-medium">{test.service_name}</span>
                                                        <span className="text-blue-700 font-bold">₹{test.price}</span>
                                                    </div>
                                                ))}
                                                {proposedData.tests.length === 0 && (
                                                    <p className="text-red-500 text-sm italic">No tests matched in database</p>
                                                )}
                                            </div>
                                        </div>

                                        <div className="mt-6 pt-6 border-t border-gray-200">
                                            <div className="flex justify-between items-center mb-6">
                                                <span className="text-gray-600 font-bold">Total Amount</span>
                                                <span className="text-3xl font-black text-gray-900">₹{proposedData.totalAmount}</span>
                                            </div>

                                            <button
                                                onClick={finalizeBilling}
                                                disabled={isFinalizing || proposedData.tests.length === 0}
                                                className={`w-full py-4 rounded-xl font-black text-lg shadow-xl transition-all ${isFinalizing || proposedData.tests.length === 0
                                                    ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                                                    : 'bg-green-600 text-white hover:bg-green-700 hover:shadow-green-200'
                                                    }`}
                                            >
                                                {isFinalizing ? 'Finalizing Bill...' : 'Confirm & Generate Bill'}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default PrescriptionScan;