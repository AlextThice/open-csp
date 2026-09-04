import { z } from 'zod';
import { profileDraftSchema } from '../ipc/workspace';
import { s3ProfileDraftSchema } from './s3-profile';

export const profileArchiveSchema = z.strictObject({
  version: z.literal(1),
  profiles: z
    .array(
      z.discriminatedUnion('kind', [
        z.strictObject({
          kind: z.literal('sftp'),
          profile: profileDraftSchema.refine((profile) => profile.id === null),
          group: z.string().max(100),
        }),
        z.strictObject({
          kind: z.literal('s3'),
          profile: s3ProfileDraftSchema.refine((profile) => profile.id === null),
          group: z.string().max(100),
        }),
      ]),
    )
    .max(1000),
});
