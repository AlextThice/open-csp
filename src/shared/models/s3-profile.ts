import { z } from 'zod';

export const s3EndpointSchema = z
  .string()
  .max(2048)
  .refine((value) => {
    if (value === '') return true;
    try {
      const url = new URL(value);
      return (
        (url.protocol === 'https:' ||
          (url.protocol === 'http:' &&
            ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash &&
        url.pathname === '/'
      );
    } catch {
      return false;
    }
  });
export const s3ProfileDraftSchema = z
  .strictObject({
    id: z.string().uuid().nullable(),
    name: z.string().trim().min(1).max(200),
    endpoint: s3EndpointSchema,
    region: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .regex(/^[a-zA-Z0-9-]+$/u),
    bucket: z
      .string()
      .max(63)
      .refine((value) => value === '' || /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/u.test(value)),
    initialPrefix: z
      .string()
      .max(1024)
      .refine((value) => !value.includes('\0')),
    forcePathStyle: z.boolean(),
    accessKeyId: z.string().trim().min(1).max(256),
  })
  .refine((draft) => draft.bucket !== '' || draft.initialPrefix === '');
export const s3CredentialsSchema = z.strictObject({
  secretAccessKey: z.string().min(1).max(65536),
  sessionToken: z.string().max(65536).optional(),
});
