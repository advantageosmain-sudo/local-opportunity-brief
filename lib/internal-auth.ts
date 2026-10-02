import { getRuntimeEnv } from "@/db/runtime";
import { secureStringEqual } from "./security.mjs";
export function isAutomationRequest(request: Request) {
 const expected=getRuntimeEnv().REPORT_SYNC_SECRET;
 const actual=request.headers.get('authorization')?.replace(/^Bearer\s+/i,'');
 return Boolean(expected && actual && secureStringEqual(actual,expected));
}
