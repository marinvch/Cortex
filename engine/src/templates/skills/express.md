# Express / Node.js API Patterns — {{PROJECT_NAME}}

## Route Structure

```typescript
// routes/items.ts — one file per resource
import { Router } from 'express';
import { ItemController } from '../controllers/ItemController';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { createItemSchema } from '../validators/items';

const router = Router();
router.get('/', authenticate, ItemController.list);
router.post('/', authenticate, validate(createItemSchema), ItemController.create);
export default router;
```

## Controller Pattern

```typescript
// controllers/ItemController.ts — thin, delegates to service
export class ItemController {
  static list = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const items = await ItemService.list(req.user.id);
      res.json(items);
    } catch (err) {
      next(err); // centralized error handler
    }
  };
}
```

## Validation (Zod)

```typescript
import { z } from 'zod';
import { Request, Response, NextFunction } from 'express';

export const createItemSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().optional(),
});

export const validate = (schema: z.ZodType) =>
  (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) return res.status(400).json({ errors: result.error.errors });
    req.body = result.data;
    next();
  };
```

## Error Handler Middleware

```typescript
// middleware/errorHandler.ts — last app.use()
export function errorHandler(err: Error, req: Request, res: Response, next: NextFunction) {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({ error: { code: err.code, message: err.message } });
  }
  console.error(err);
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
}
```
