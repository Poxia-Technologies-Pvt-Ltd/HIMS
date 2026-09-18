
import React, { useState } from "react";
import axios from "axios";
import "../../assets/CSS/BarcodeGenerator.css";
import "../../assets/CSS/App.css";
import '../../assets/CSS/BillingPackages.css';
import '../../assets/CSS/StaffManagement.css';

const BarcodeGenerator = () => {
    const [prefix, setPrefix] = useState("RX-JH");
    const [year, setYear] = useState(new Date().getFullYear());
    const [count, setCount] = useState(10);
    const [startNumber, setStartNumber] = useState(1);

    const [barcodes, setBarcodes] = useState([]);
    const [loading, setLoading] = useState(false);

    const API_BASE = import.meta.env.VITE_API_URL || '';

    const generateBarcodes = async () => {
        try {
            setLoading(true);

            const response = await axios.post(
                `${API_BASE}/api/barcodes/generate`,
                {
                    prefix,
                    year,
                    count,
                    startNumber,
                }
            );

            setBarcodes(response.data.barcodes);
        } catch (err) {
            console.error(err);
            alert("Failed to generate barcodes");
        } finally {
            setLoading(false);
        }
    };

    const printPage = () => {
        window.print();
    };

    return (
        <div className="p-6 bg-gray-100 min-h-screen">
            <div className="bg-white shadow rounded-xl p-6 mb-6">
                <h1 className="heading">
                    Barcode Generator
                </h1>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <input
                        type="text"
                        placeholder="Prefix"
                        value={prefix}
                        onChange={(e) => setPrefix(e.target.value)}
                        className="border p-3 rounded-lg"
                    />

                    <input
                        type="number"
                        placeholder="Year"
                        value={year}
                        onChange={(e) => setYear(e.target.value)}
                        className="border p-3 rounded-lg"
                    />

                    <input
                        type="number"
                        placeholder="Count"
                        value={count}
                        onChange={(e) => setCount(e.target.value)}
                        className="border p-3 rounded-lg"
                    />

                    <input
                        type="number"
                        placeholder="Start Number"
                        value={startNumber}
                        onChange={(e) => setStartNumber(e.target.value)}
                        className="border p-3 rounded-lg"
                    />
                </div>

                <div className="flex gap-4 mt-6">
                    <button
                        onClick={generateBarcodes}
                        className="bg-blue-600 text-white px-6 py-3 rounded-lg"
                    >
                        {loading ? "Generating..." : "Generate"}
                    </button>

                    <button
                        onClick={printPage}
                        className="bg-green-600 text-white px-6 py-3 rounded-lg"
                    >
                        Print
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                {barcodes.map((item, index) => (
                    <div
                        key={index}
                        className="bg-white border rounded-xl p-4 text-center shadow"
                    >
                        <img
                            src={item.barcodeImage}
                            alt="barcode"
                            className="w-full h-20 object-contain"
                        />

                        <div className="font-bold mt-2">
                            {item.barcodeId}
                        </div>

                        <img
                            src={item.qrImage}
                            alt="qr"
                            className="w-24 h-24 mx-auto mt-3"
                        />
                    </div>
                ))}
            </div>
        </div>
    );
};

export default BarcodeGenerator;