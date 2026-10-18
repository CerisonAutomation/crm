import { db } from "@/lib/db";
import { DomainError } from "@/lib/domain/states";

export interface CreateAvailabilityInput {
  orgId: string;
  userId: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  timezone?: string;
}

export interface UpdateAvailabilityInput {
  dayOfWeek?: number;
  startTime?: string;
  endTime?: string;
  timezone?: string;
}

export async function createAvailability(input: CreateAvailabilityInput) {
  try {
    return await db.availability.create({
      data: {
        orgId: input.orgId,
        userId: input.userId,
        dayOfWeek: input.dayOfWeek,
        startTime: input.startTime,
        endTime: input.endTime,
        timezone: input.timezone ?? "Europe/Zurich",
      },
    });
  } catch (err) {
    throw new DomainError("Failed to create availability", 500, { cause: err });
  }
}

export async function getAvailability(id: string) {
  try {
    return await db.availability.findUnique({
      where: { id },
    });
  } catch (err) {
    throw new DomainError("Failed to get availability", 500, { cause: err });
  }
}

export async function getAvailabilities(orgId: string, filters?: {
  userId?: string;
  dayOfWeek?: number;
}) {
  try {
    return await db.availability.findMany({
      where: {
        orgId,
        ...(filters?.userId ? { userId: filters.userId } : undefined),
        ...(filters?.dayOfWeek !== undefined ? { dayOfWeek: filters.dayOfWeek } : undefined),
      },
      orderBy: [{ dayOfWeek: "asc" }, { startTime: "asc" }],
    });
  } catch (err) {
    throw new DomainError("Failed to get availabilities", 500, { cause: err });
  }
}

export async function updateAvailability(id: string, input: UpdateAvailabilityInput) {
  try {
    return await db.availability.update({
      where: { id },
      data: input,
    });
  } catch (err) {
    throw new DomainError("Failed to update availability", 500, { cause: err });
  }
}

export async function deleteAvailability(id: string) {
  try {
    return await db.availability.delete({
      where: { id },
    });
  } catch (err) {
    throw new DomainError("Failed to delete availability", 500, { cause: err });
  }
}
