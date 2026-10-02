import { app } from "./app";
import { env } from "./config/env";
import { logger } from "./config/logger";
import { prisma } from "./config/prisma";
import { publishDueNews } from "./modules/news/news.service";
import { expireFeatured } from "./modules/business/business.service";

const server = app.listen(env.port, () => {
  logger.info(`API listening on http://localhost:${env.port}`);
});

server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.error(`\nPort ${env.port} is already in use — another copy of the API is probably running.\nStop it (Ctrl+C in its terminal) or change PORT in .env.\n`);
    process.exit(1);
  }
  throw err;
});

// Minute sweep: scheduled stories go live and expired paid placements end. The SQL is atomic, so every instance may run it.
async function sweepScheduled() {
  try {
    const [published, unfeatured] = await Promise.all([publishDueNews(), expireFeatured()]);
    if (published > 0) logger.info({ published }, "scheduled stories published");
    if (unfeatured > 0) logger.info({ unfeatured }, "expired featured listings");
  } catch (err) {
    logger.error({ err }, "scheduled sweep failed");
  }
}
void sweepScheduled();
const timer = setInterval(sweepScheduled, 60_000);
timer.unref();

async function shutdown(signal: string) {
  logger.info({ signal }, "shutting down");
  clearInterval(timer);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref(); // never hang on stuck connections
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("unhandledRejection", (reason) => logger.error({ reason }, "unhandled rejection"));
