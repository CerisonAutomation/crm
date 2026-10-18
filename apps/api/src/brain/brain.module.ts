/**
 * Brain module (SeldonFrame U6): organizational memory.
 */

import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { BrainService } from "./brain.service";
import { BrainController } from "./brain.controller";

@Module({
	imports: [DatabaseModule],
	providers: [BrainService],
	controllers: [BrainController],
	exports: [BrainService],
})
export class BrainModule {}
