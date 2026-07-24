import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import exploreRouter from "./explore.js";
import authRouter from "./auth.js";
import usersRouter from "./users.js";
import postsRouter from "./posts.js";
import categoriesRouter from "./categories.js";
import walletRouter from "./wallet.js";
import mediaRouter from "./media.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(exploreRouter);
router.use(authRouter);
router.use(usersRouter);
router.use(postsRouter);
router.use(categoriesRouter);
router.use(walletRouter);
router.use(mediaRouter);

export default router;
