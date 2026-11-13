import { z } from 'zod';

/**
 * Data contracts (validated server-side; the client mirrors these in src/lib/contracts.js).
 * Dates are date-only strings "YYYY-MM-DD" (or null to clear on update).
 */
const title = z.string().trim().min(1, 'Title is required').max(140);
const description = z.string().trim().max(2000);
const dateOnly = z.iso.date();

export const MOVIE_STATUSES = ['active', 'completed', 'archived'];
export const CLIP_STATUSES = ['todo', 'in_progress', 'completed'];
export const PRIORITIES = ['low', 'medium', 'high'];
export const MAX_FOCUS = 3;

export const movieCreate = z.strictObject({
  title,
  description: description.optional(),
  targetDate: dateOnly.nullish(),
});

export const movieUpdate = z
  .strictObject({
    title: title.optional(),
    description: description.optional(),
    targetDate: dateOnly.nullable().optional(),
    status: z.enum(MOVIE_STATUSES).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field to update.');

export const clipCreate = z.strictObject({
  title,
  description: description.optional(),
  status: z.enum(CLIP_STATUSES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  dueDate: dateOnly.nullish(),
});

export const clipUpdate = z
  .strictObject({
    title: title.optional(),
    description: description.optional(),
    status: z.enum(CLIP_STATUSES).optional(),
    priority: z.enum(PRIORITIES).optional(),
    dueDate: dateOnly.nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field to update.');

export const focusUpdate = z.strictObject({
  date: dateOnly,
  clipIds: z.array(z.string()).max(MAX_FOCUS, `Today's Focus allows at most ${MAX_FOCUS} clips.`),
});

/**
 * A plan proposed by the AI coach. It is only a proposal until the user approves it;
 * the same schema validates the tool call arguments and the approval request.
 */
export const proposal = z.strictObject({
  movie: z.strictObject({
    title,
    description: description.optional(),
    targetDate: dateOnly.nullish(),
  }),
  clips: z
    .array(
      z.strictObject({
        title,
        description: description.optional(),
        priority: z.enum(PRIORITIES).optional(),
        dueDate: dateOnly.nullish(),
      }),
    )
    .min(1, 'A proposal needs at least one clip.')
    .max(15, 'A proposal may contain at most 15 clips.'),
});
