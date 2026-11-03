# models/

Mongoose models live here, one file per collection. The fields and indexes are in PRD v1.5, section 8.

Day 1 tasks (PRD section 11.1):

| File | Lane |
|---|---|
| `User.js`, `Link.js` | B |
| `Click.js`, `ApiKey.js`, `DailyStat.js` | D |

Always export models like this, so hot reload does not throw `OverwriteModelError`:

```js
import { Schema, model, models } from "mongoose";

const linkSchema = new Schema(
  {
    code: { type: String, required: true, unique: true, lowercase: true },
    // ...other fields from the PRD
  },
  { timestamps: true },
);

export const LinkModel = models.Link || model("Link", linkSchema);
```

Before using a model in a route handler, call `await connectDB()` from `@/lib/db`.
