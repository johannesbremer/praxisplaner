import { z } from "zod";

// Zod is necessary for client side parsing.

export const itemSchema = z.object({
  boardId: z.coerce.string(),
  columnId: z.string().uuid(),
  content: z.string().optional(),
  id: z.string(),
  order: z.coerce.number(),
  title: z.string(),
});

export const deleteItemSchema = itemSchema.pick({ boardId: true, id: true });
