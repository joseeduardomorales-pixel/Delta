// POST /api/uploads
// -----------------
// Multipart endpoint that accepts up to 5 image files per request,
// validates mime + size, uploads to staging/{user_id}/{uuid}.{ext},
// and returns the staging paths. Client then includes those paths in
// the next /api/chat call.
//
// Body: multipart/form-data with field name `files` (one or more).
// Response: { uploads: [{ staging_path, mimetype, size }], rejected: [...] }

import { Router } from 'express';
import multer from 'multer';
import { requireAuth } from '../middleware/auth.js';
import {
  uploadToStaging,
  validateUpload,
} from '../services/storage.js';
import { logger } from '../logger.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024, // 25MB per file
    files: 5,
    fields: 5,
  },
});

export const uploadsRouter = Router();

uploadsRouter.post(
  '/api/uploads',
  requireAuth,
  upload.array('files', 5),
  async (req, res) => {
    const files = req.files || [];
    if (!files.length) {
      return res.status(400).json({ error: 'no_files' });
    }

    const uploads = [];
    const rejected = [];
    for (const f of files) {
      const v = validateUpload({ mimetype: f.mimetype, size: f.size });
      if (!v.ok) {
        rejected.push({ name: f.originalname, reason: v.reason });
        continue;
      }
      try {
        const out = await uploadToStaging({
          userId: req.user.id,
          buffer: f.buffer,
          mimetype: f.mimetype,
          originalName: f.originalname,
        });
        uploads.push(out);
      } catch (e) {
        rejected.push({ name: f.originalname, reason: e.message });
      }
    }

    logger.info(
      { userId: req.user.id, accepted: uploads.length, rejected: rejected.length },
      'uploads: batch processed',
    );

    res.json({ uploads, rejected });
  },
);

// Multer error handler — surfaces file-size / file-count limits cleanly.
uploadsRouter.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: 'upload_rejected', reason: err.code });
  }
  next(err);
});
