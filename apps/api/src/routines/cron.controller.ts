/**
 * Cron tick endpoint (extracted from Customermates `scripts/routines-tick.ts`,
 * which posts `Authorization: Bearer <CRON_SECRET>` to `/api/cron/routines`).
 *
 * Schedule it from system cron, GitHub Actions, Vercel Cron, or the n8n
 * schedule trigger — any caller that holds CRON_SECRET.
 */

import {
	Controller,
	ForbiddenException,
	Headers,
	Post,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { RoutinesService } from "./routines.service";

function cronSecretValid(header: string | undefined): boolean {
	if (!header || !header.toLowerCase().startsWith("bearer ")) return false;
	const presented = header.slice("bearer ".length).trim();
	const secret = process.env.CRON_SECRET;
	if (!secret || secret.length < 16 || presented.length !== secret.length) return false;
	let diff = 0;
	for (let index = 0; index < secret.length; index += 1) {
		diff |= presented.charCodeAt(index) ^ secret.charCodeAt(index);
	}
	return diff === 0;
}

@ApiTags("Cron")
@Controller("api/cron")
export class CronController {
	constructor(private readonly routines: RoutinesService) {}

	@Post("routines")
	@ApiOperation({ summary: "Start due routine runs and run the recovery sweep" })
	@ApiBearerAuth()
	async tick(@Headers("authorization") authorization: string | undefined) {
		if (!cronSecretValid(authorization)) {
			throw new ForbiddenException(
				"Cron endpoints require Authorization: Bearer <CRON_SECRET> (min 16 chars)",
			);
		}
		const summary = await this.routines.tick();
		return {
			ok: true,
			...summary,
			tickedAt: new Date().toISOString(),
		};
	}
}
