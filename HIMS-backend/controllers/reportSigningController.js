import { PDFDocument, StandardFonts } from 'pdf-lib';
import { dscStatus, signPdf, verifyPdfSignature, dscConfigured, DscError } from '../utils/dscSigner.js';

// Admin view of the digital signing certificate (tender #36).

// GET /api/lab/report-signing/status
export const getReportSigningStatus = (req, res) => res.json({ success: true, ...dscStatus() });

// POST /api/lab/report-signing/test — signs a small sample PDF with the configured
// certificate and verifies the result, so an admin can confirm it works before relying on it.
export const testReportSigning = async (req, res) => {
  try {
    if (!dscConfigured()) return res.status(409).json({ success: false, message: 'No signing certificate is configured on the server.' });
    const doc = await PDFDocument.create();
    const page = doc.addPage([595, 842]);
    page.drawText('HMIS — digital signature test', { x: 50, y: 780, size: 16, font: await doc.embedFont(StandardFonts.Helvetica) });
    const signed = await signPdf(Buffer.from(await doc.save()), { reason: 'Signing test', location: 'HMIS' });
    const check = verifyPdfSignature(signed);
    res.json({ success: true, ok: !!check.valid, check, message: check.valid ? 'The certificate signed a test PDF and the signature verified.' : 'A test PDF was signed but did not verify.' });
  } catch (error) {
    if (error instanceof DscError) return res.status(409).json({ success: false, message: error.message });
    console.error('Report signing test failed:', error);
    res.status(500).json({ success: false, message: 'Server error testing the signature' });
  }
};
