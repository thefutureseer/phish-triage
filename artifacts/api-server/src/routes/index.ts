import { Router, type IRouter } from "express";
import healthRouter from "./health";
import analysisRouter from "./analysis";
import voiceTriageRouter from "./voice-triage";

const router: IRouter = Router();

router.use(healthRouter);
router.use(analysisRouter);
router.use(voiceTriageRouter);

export default router;
