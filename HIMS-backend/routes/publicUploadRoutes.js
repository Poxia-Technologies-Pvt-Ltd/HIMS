import express from 'express';
import multer from 'multer';
import { analyzeUpload, submitUpload } from '../controllers/publicUploadController.js';

// Deliberately unauthenticated (mounted outside the JWT-protected routers) —
// a walk-in patient reaches this before they have any staff/patient session,
// straight off a QR code or link. Rate/abuse limiting for this surface lives
// with whatever global rate-limit middleware server.js already applies.
const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 }, // 12MB — phone camera photos
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image uploads are allowed'));
    }
    cb(null, true);
  },
});

router.post('/analyze', upload.single('image'), analyzeUpload);
router.post('/submit', submitUpload);

export default router;
