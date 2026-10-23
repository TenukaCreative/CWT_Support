import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import * as health from '../controllers/health.controller.js';

const router = Router();

router.get('/', health.liveness);
router.get('/ready', asyncHandler(health.readiness));

export default router;
