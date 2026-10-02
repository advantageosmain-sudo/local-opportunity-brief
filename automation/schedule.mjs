import { appendFile } from "node:fs/promises";
import { weeklyScheduleGuard } from "./lib/schedule.mjs";
const result = weeklyScheduleGuard({ eventName: process.env.GITHUB_EVENT_NAME, scheduledCron: process.env.SCHEDULED_CRON });
if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `enabled=${result.enabled}\nas_of=${result.asOf}\n`);
console.log(JSON.stringify(result, null, 2));
