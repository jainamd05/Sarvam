# Code Quality Audit & Improvement Roadmap

This document tracks code quality issues identified during the audit and provides a roadmap for fixes.

## Status Summary

**Completed:**
- ✅ CRITICAL: Refactored system instructions into modular prompts (`src/server/prompts/`)
- ✅ LOW: Removed unused code, organized imports

**In Progress:**
- 🔄 HIGH: Exception handling and type safety improvements

**Not Started:**
- ⏳ HIGH: Browser.py refactoring (complex, 778 lines)
- ⏳ HIGH/MEDIUM: REST endpoint wrapper, tool discovery, duplication elimination
- ⏳ LOW: Documentation improvements

---

## Critical Issues (Resolved)

### 1. System Instructions Unmaintainability
**File:** `src/server/index.ts`  
**Issue:** 800+ line inline system instruction string  
**Status:** ✅ RESOLVED

**Solution:**
Created modular prompt system in `src/server/prompts/`:
- `systemRules.ts` - Core behavior rules
- `avatarPrompts.ts` - Personality and emotional response
- `toolUsage.ts` - Tool documentation and guidelines  
- `memoryPrompts.ts` - Memory system instructions
- `personalityOverrides.ts` - Avatar-specific overrides (ELYSIA/AEGIS)
- `index.ts` - Aggregator with `buildSystemInstruction(avatarStyle, memoryContext)`

**Benefits:**
- Easier to update individual instruction sections
- Version-controllable prompt engineering
- Clear separation of concerns
- Dynamic assembly with user context

---

## High-Priority Issues (Active/Pending)

### 2. Browser.py Exception Handling & Types
**File:** `agent/tools/browser.py`  
**Severity:** HIGH  
**Status:** 🔄 In Progress

**Issues Identified:**
- Lines 80-100: Broad `except Exception` without specific exception types
- Lines 115-155: Missing type annotations on async functions (return `Any` instead of `Page`)
- Lines 165-190: Keyboard input via `pyperclip` + `Ctrl+V` fails on non-US keyboards
- Lines 226-240 vs 248-262: 90% boilerplate duplication in CDP vs managed initialization
- Lines 415-530: Repeated try/except pattern for browser operations (8+ instances)

**Recommended Fixes:**
1. Replace broad exceptions with specific types:
   ```python
   from playwright.async_api import Error as PlaywrightError
   from playwright._impl._errors import TimeoutError as PlaywrightTimeoutError
   ```
2. Use concrete return types:
   ```python
   async def _ensure_browser_cdp_async() -> Page:  # not Any
   ```
3. Replace keyboard injection with direct clipboard:
   ```python
   # Instead of: hotkey("ctrl", "v")
   # Use: page.evaluate(f'document.activeElement.value = "{text}"')
   ```
4. Extract common initialization logic:
   ```python
   async def _ensure_page_from_context() -> Page:
       """Common logic for getting/creating page from context"""
   ```

**Effort:** MEDIUM | **Impact:** HIGH

---

### 3. Browser.py Keyboard Input Vulnerability
**File:** `agent/tools/browser.py` lines 640-665  
**Severity:** HIGH  
**Status:** ⏳ Not Started

**Issue:** Using keyboard shortcuts (`Ctrl+V`) for clipboard injection fails on non-US keyboards and accessibility setups.

**Solution:**
```python
# Instead of pyperclip hotkey approach:
async def _type_with_clipboard(page: Page, selector: str, text: str) -> None:
    """Type text by injecting directly into element instead of using keyboard."""
    await page.fill(selector, text)  # Use Playwright's fill() which is keyboard-independent
    # OR for contenteditable divs:
    await page.evaluate(f'''
        (text) => {{
            const el = document.activeElement;
            if (el.contentEditable === 'true') {{
                el.textContent = text;
            }} else if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {{
                el.value = text;
            }}
        }}
    ''', text)
```

---

### 4. Windows.py Audio Controller Inefficiency
**File:** `agent/backends/windows.py` lines 73-100  
**Severity:** HIGH  
**Status:** ⏳ Not Started

**Issue:** `_init_pycaw()` called repeatedly; should be cached. Subprocess calls use inconsistent flags.

**Solution:**
```python
class WindowsAudioController(AudioController):
    def __init__(self):
        self._pycaw = None
        self._init_attempted = False
    
    def _ensure_pycaw(self):
        """Initialize pycaw once and cache result."""
        if not self._init_attempted:
            try:
                self._pycaw = self._init_pycaw_internal()
                self._init_attempted = True
            except Exception as e:
                log.warning("Pycaw initialization failed: %s", e)
                self._init_attempted = True
        return self._pycaw
    
    def get_volume(self) -> float:
        iface = self._ensure_pycaw()
        if iface is None:
            return 0.5  # Default fallback
        try:
            return float(iface.GetMasterVolumeLevelScalar())
        except Exception as e:
            log.debug("Failed to get volume: %s", e)
            return 0.5
```

---

### 5. DESKTOP_TOOLS Duplication
**File:** `src/server/index.ts` and `agent/registry.py`  
**Severity:** HIGH  
**Status:** ⏳ Not Started

**Issue:** Tool names duplicated in two files; source of truth unclear; breaks when tools added.

**Solution:**
Generate from single source at build time:
1. Keep authoritative list in `agent/registry.py` (Python source of truth)
2. Add build script to extract and generate TypeScript version:
   ```bash
   # scripts/generate-tools.js
   const registry = require('../agent/registry.py');  # Parse Python
   const tools = registry.DESKTOP_TOOL_NAMES;
   fs.writeFileSync('src/types/toolNames.ts', 
     `export const DESKTOP_TOOLS = new Set([${tools.map(t => `"${t}"`).join(', ')}]);`
   );
   ```
3. Import generated file in both places:
   ```typescript
   import { DESKTOP_TOOLS } from './types/toolNames';
   ```

---

## Medium-Priority Issues

### 6. Tool Discovery Hard-Coded
**File:** `agent/registry.py` lines 97-118  
**Severity:** MEDIUM  
**Status:** ⏳ Not Started

**Issue:** `load_all()` hard-codes 22 import statements. Adding a tool requires 3 changes (create file, register, import).

**Solution:**
```python
def load_all() -> None:
    """Dynamically discover and import all tool modules."""
    import importlib
    import pkgutil
    import agent.tools as tools_pkg
    
    for _, module_name, _ in pkgutil.iter_modules(tools_pkg.__path__):
        try:
            importlib.import_module(f'agent.tools.{module_name}')
        except ImportError as e:
            logging.warning(f"Failed to load tool module {module_name}: {e}")
```

**Benefits:**
- Adding a tool = create `agent/tools/my_tool.py` + register decorator
- No manual import changes needed

---

### 7. REST Endpoint Duplication
**File:** `src/server/index.ts` lines 400-700 (approx)  
**Severity:** MEDIUM  
**Status:** ⏳ Not Started

**Issue:** Repeated pattern: load → validate → process → save → respond

**Solution:**
```typescript
/**
 * Generic REST handler wrapper to eliminate boilerplate.
 * Example: createRestHandler(loadMemories, saveMemories)
 */
function createRestHandler<T>(
  loader: () => Promise<T[]>,
  saver: (items: T[]) => Promise<void>
) {
  return {
    get: async (_: Request, res: Response) => {
      try {
        const items = await loader();
        res.json(items);
      } catch (e: any) {
        logError(`Failed to load: ${e.message}`);
        res.status(500).json({ error: e.message });
      }
    },
    post: async (req: Request, res: Response) => {
      try {
        const items = await loader();
        const newItem = processItem(req.body);  // validate + create
        items.push(newItem);
        await saver(items);
        res.status(201).json(newItem);
      } catch (e: any) {
        logError(`Failed to save: ${e.message}`);
        res.status(400).json({ error: e.message });
      }
    },
  };
}

// Usage:
const memoryHandlers = createRestHandler(loadMemories, saveMemories);
app.get('/api/memories', memoryHandlers.get);
app.post('/api/memories', memoryHandlers.post);
```

---

## Low-Priority Issues (Polish)

### 8. Code Organization & Documentation
**Files:** Various  
**Status:** ⏳ Not Started

**Tasks:**
- [ ] Add module-level JSDoc to all server files
- [ ] Extract browser tool handlers into `tools/browser/` subdirectory
- [ ] Add type aliases for common patterns:
  ```typescript
  type ToolArgs = Record<string, unknown>;
  type ToolResult = { result?: unknown; error?: string };
  ```
- [ ] Standardize all imports (no CommonJS `require()` in ES6 files)
- [ ] Add pre-commit hook to lint and format

---

## Code Quality Metrics

| Metric | Current | Target | Status |
|--------|---------|--------|--------|
| Type Coverage | ~60% | 95%+ | 🔄 Improving |
| Documented Functions | 40% | 90%+ | ⏳ Pending |
| Duplication | ~15% | <5% | 🔄 Reducing |
| Avg Exception Specificity | Low | High | 🔄 Improving |
| Build Time | - | <30s | ⏳ Monitor |
| Test Coverage | 0% | 70%+ | ❌ Not Started |

---

## Next Steps (Priority Order)

1. **✅ DONE**: Modularize system instructions
2. **🔄 IN PROGRESS**: Fix browser.py exception handling and types
3. **⏳ TODO (Week 1)**:
   - Extract browser initialization common logic
   - Add cached pycaw initialization
   - Generate tool names from single source
4. **⏳ TODO (Week 2)**:
   - Create REST endpoint wrapper
   - Implement dynamic tool discovery
5. **⏳ TODO (Week 3)**:
   - Add comprehensive documentation
   - Set up linting and pre-commit hooks
   - Plan test coverage expansion

---

## Verification Checklist

Before considering the codebase "production-ready":

- [ ] All functions have JSDoc comments with @param, @returns, @throws
- [ ] All broad `except Exception` replaced with specific exception types
- [ ] All `Any` types replaced with concrete types (Page, Browser, etc.)
- [ ] No code duplication >10 lines without extraction
- [ ] All imports organized (stdlib → third-party → local)
- [ ] All error messages include actionable context
- [ ] Logger usage standardized across all modules
- [ ] Build passes linting and type checking
- [ ] All TODOs have associated GitHub issues

---

## References

- **Audit Report**: Generated via context-gatherer agent
- **System Prompts**: `src/server/prompts/`
- **Build Scripts**: `package.json` scripts
- **Configuration**: `docs/CONFIG.md`
