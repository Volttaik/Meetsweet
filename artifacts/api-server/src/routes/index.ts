import { Router, type IRouter } from "express";
import healthRouter from "./health";
import exploreRouter from "./explore";

const router: IRouter = Router();

router.use(healthRouter);
router.use(exploreRouter);

export default router;
