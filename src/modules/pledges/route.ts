import { Router } from "express";
import { pledgesRouter } from "./pledges/route";
import { redemptionsRouter } from "./redemptions/route";
import { pledgePaymentsRouter } from "./payments/route";

const router = Router();
// Member-facing payment routes are mounted alongside the staff ones. They are
// all literal paths, so ordering is not load-bearing; keeping the member
// surface first makes the permission split easy to audit.
router.use(pledgePaymentsRouter);
router.use(pledgesRouter);
router.use(redemptionsRouter);

export { router as pledgesModuleRouter };
