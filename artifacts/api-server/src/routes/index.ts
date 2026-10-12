import { Router, type IRouter } from "express";
import healthRouter from "./health";
import analysisRouter from "./analysis";
import voiceTriageRouter from "./voice-triage";
import phoneTriageRouter from "./phone-triage";

const router: IRouter = Router();

router.use(healthRouter);
router.use(analysisRouter);
router.use(voiceTriageRouter);
router.use(phoneTriageRouter);

export default router;
