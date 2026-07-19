import { Router } from "express";
import { pledgesRouter } from "./pledges/route";
import { redemptionsRouter } from "./redemptions/route";

const router = Router();
router.use(pledgesRouter);
router.use(redemptionsRouter);

export { router as pledgesModuleRouter };
