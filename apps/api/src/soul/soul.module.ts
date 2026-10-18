/**
 * Soul module (SeldonFrame U7): white-label identity inheritance.
 */

import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { SoulService } from "./soul.service";
import { SoulController } from "./soul.controller";

@Module({
	imports: [DatabaseModule],
	providers: [SoulService],
	controllers: [SoulController],
	exports: [SoulService],
})
export class SoulModule {}
