import { IsoDateTime, type IsoDateTime as IsoDateTimeValue } from "@/contracts/common";

type TrustedCodec<T> = {
  is(value: unknown): value is T;
};

export const expectTrusted = <T>(codec: TrustedCodec<T>, value: unknown, label: string): T => {
  if (!codec.is(value)) {
    throw new Error(`Invalid trusted ${label}.`);
  }

  return value;
};

export const nullableTrusted = <T>(codec: TrustedCodec<T>, value: unknown, label: string): T | null =>
  value === null ? null : expectTrusted(codec, value, label);

export const isoDateTimeFromTimestamp = (value: number): IsoDateTimeValue =>
  expectTrusted(IsoDateTime, new Date(value).toISOString(), "IsoDateTime");

export const nullableIsoDateTimeFromTimestamp = (value: number | null): IsoDateTimeValue | null =>
  value === null ? null : isoDateTimeFromTimestamp(value);
