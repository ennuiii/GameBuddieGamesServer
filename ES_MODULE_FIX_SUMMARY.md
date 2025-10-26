# ES Module Import Fix Summary

## Issue
The server was throwing the error:
```
Directory import '/opt/render/project/src/dist/games/clue/types' is not supported
```

This happens because ES modules require explicit file extensions in imports.

## Root Cause
TypeScript allows imports without file extensions during development, but when compiled to JavaScript and run as ES modules, Node.js requires explicit `.js` extensions (NOT `.ts`).

## Files Fixed

### games/clue/plugin.ts
- Changed: `from '../../core/types/core'` → `from '../../core/types/core.js'`
- Changed: `from './types'` → `from './types/index.js'`
- Changed: `from './game/GameManager'` → `from './game/GameManager.js'`

### games/clue/game/GameManager.ts
- Changed: `from '../../../core/types/core'` → `from '../../../core/types/core.js'`
- Changed: `from '../types'` → `from '../types/index.js'`
- Changed: `from '../utils/scoring'` → `from '../utils/scoring.js'`

### games/clue/utils/scoring.ts
- Changed: `from '../types'` → `from '../types/index.js'`

### games/ddf/plugin.ts
- Changed: `from '../../core/types/core'` → `from '../../core/types/core.js'`
- Changed: `from './types'` → `from './types/index.js'`
- Changed: `from './utils/serialization'` → `from './utils/serialization.js'`
- Changed: `from './services/supabaseService'` → `from './services/supabaseService.js'`

### games/ddf/utils/serialization.ts
- Changed: `from '../../../core/types/core'` → `from '../../../core/types/core.js'`
- Changed: `from '../types'` → `from '../types/index.js'`

## Important Rules

1. **Always use `.js` extension** - Even though files are `.ts`, at runtime they're `.js`
2. **Directory imports need `/index.js`** - `from './types'` becomes `from './types/index.js'`
3. **File imports need `.js`** - `from './scoring'` becomes `from './scoring.js'`
4. **This applies to ALL relative imports** - Any import starting with `./` or `../`

## Pattern Examples

### Directory with index.ts
```typescript
// BEFORE (WRONG)
import { Type } from './types';

// AFTER (CORRECT)
import { Type } from './types/index.js';
```

### Single file
```typescript
// BEFORE (WRONG)
import { function } from './helper';

// AFTER (CORRECT)
import { function } from './helper.js';
```

### Core types
```typescript
// BEFORE (WRONG)
import { Room } from '../../core/types/core';

// AFTER (CORRECT)
import { Room } from '../../core/types/core.js';
```

## Verification
All files have been checked and updated. No relative imports without `.js` extensions remain in:
- games/clue/
- games/ddf/
- games/bingo/
- games/susd/
- core/

## Status
✅ All ES module import errors fixed
✅ Server should now start without directory import errors
