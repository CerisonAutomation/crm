/**
 * Brain module (SeldonFrame U6): organizational memory.
 */

import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { BrainController } from "./brain.controller";
import { BrainService } from "./brain.service";

@Module({
	imports: [DatabaseModule],
	providers: [BrainService],
	controllers: [BrainController],
	exports: [BrainService],
})
export class BrainModule {}
