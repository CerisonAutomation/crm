import { db } from "@/lib/db";
import { DomainError } from "@/lib/domain/states";

export interface SetBusinessSettingInput {
  orgId: string;
  key: string;
  value: string;
}

export async function setBusinessSetting(input: SetBusinessSettingInput) {
  try {
    return await db.businessSetting.upsert({
      where: {
        orgId_key: {
          orgId: input.orgId,
          key: input.key,
        },
      },
      create: {
        orgId: input.orgId,
        key: input.key,
        value: input.value,
      },
      update: {
        value: input.value,
      },
    });
  } catch (err) {
    throw new DomainError("Failed to set business setting", 500, { cause: err });
  }
}

export async function getBusinessSetting(orgId: string, key: string) {
  try {
    return await db.businessSetting.findUnique({
      where: {
        orgId_key: {
          orgId,
          key,
        },
      },
    });
  } catch (err) {
    throw new DomainError("Failed to get business setting", 500, { cause: err });
  }
}

export async function getBusinessSettings(orgId: string) {
  try {
    return await db.businessSetting.findMany({
      where: { orgId },
      orderBy: { key: "asc" },
    });
  } catch (err) {
    throw new DomainError("Failed to get business settings", 500, { cause: err });
  }
}

export async function deleteBusinessSetting(orgId: string, key: string) {
  try {
    return await db.businessSetting.delete({
      where: {
        orgId_key: {
          orgId,
          key,
        },
      },
    });
  } catch (err) {
    throw new DomainError("Failed to delete business setting", 500, { cause: err });
  }
}
