import express from "express";
import bwipjs from "bwip-js";
import QRCode from "qrcode";
import { authenticateToken } from "../middleware/auth.js";

const router = express.Router();
router.use(authenticateToken);

const MAX_BARCODE_COUNT = 200;

router.post("/generate", async (req, res) => {
  try {
    const {
      prefix,
      year,
      startNumber,
    } = req.body;
    const count = Number(req.body.count);

    if (!Number.isInteger(count) || count < 1 || count > MAX_BARCODE_COUNT) {
      return res.status(400).json({ success: false, message: `count must be an integer between 1 and ${MAX_BARCODE_COUNT}` });
    }

    const barcodes = [];

    for (let i = 0; i < count; i++) {
      const number = String(startNumber + i).padStart(6, "0");

      const barcodeId = `${prefix}-${year}-${number}`;

      // Barcode Image
      const barcodeBuffer = await bwipjs.toBuffer({
        bcid: "code128",
        text: barcodeId,
        scale: 3,
        height: 10,
        includetext: false,
      });

      const barcodeBase64 =
        `data:image/png;base64,${barcodeBuffer.toString("base64")}`;

      // QR Image
      const qrImage = await QRCode.toDataURL(barcodeId);

      barcodes.push({
        barcodeId,
        barcodeImage: barcodeBase64,
        qrImage,
      });
    }

    res.json({
      success: true,
      barcodes,
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      success: false,
      message: "Barcode generation failed",
    });
  }
});

router.get('/sample/:sampleId', async (req, res) => {
  try {
    const { sampleId } = req.params;
    const fullId = req.query.full_id || sampleId;

    const [barcodeBuffer, qrDataUrl] = await Promise.all([
      bwipjs.toBuffer({
        bcid: 'code128',
        text: sampleId,
        scale: 4,
        height: 25,
        includetext: true,
      }),
      QRCode.toDataURL(fullId, { errorCorrectionLevel: 'M', margin: 1, width: 300 }),
    ]);

    res.json({
      success: true,
      barcodeBase64: `data:image/png;base64,${barcodeBuffer.toString('base64')}`,
      qrBase64: qrDataUrl,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Barcode generation failed' });
  }
});

export default router;