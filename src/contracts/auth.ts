import { eg, type TypeFromCodec } from "@cloudflare/util-en-garde";

import { UserSummary } from "@/contracts/common";

export const GetMeResponse = eg.exactStrict(
  eg.object({
    user: UserSummary,
  }),
);
export type GetMeResponse = TypeFromCodec<typeof GetMeResponse>;

export const PublicAppConfigResponse = eg.exactStrict(eg.object({}));
export type PublicAppConfigResponse = TypeFromCodec<typeof PublicAppConfigResponse>;
