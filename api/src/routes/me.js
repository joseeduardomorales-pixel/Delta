// GET /me — returns the caller's profile + role.
// Behind requireAuth. Used by the web client to render "Hello, X"
// and to know which admin screens to show.

import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';

export const meRouter = Router();

meRouter.get('/me', requireAuth, (req, res) => {
  res.json({
    id: req.user.id,
    email: req.user.email,
    fullName: req.user.fullName,
    role: req.user.role,
    handle: req.user.handle,
  });
});
