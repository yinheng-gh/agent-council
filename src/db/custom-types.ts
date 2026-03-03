import { customType } from "drizzle-orm/sqlite-core";

export const timestamp = customType<{ data: Date; driverData: string }>({
  dataType() {
    return "text";
  },
  toDriver: (value) => value.toISOString(),
  fromDriver: (value) => new Date(value as string),
});

