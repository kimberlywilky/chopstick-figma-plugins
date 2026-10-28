# @chopstick/shared

Shared styles and utilities used across Chopstick Figma plugins.

This package has no design-system-specific logic (no token content, no brand naming). It is pure plugin-UI scaffolding: status messaging, ZIP generation, and base styles.

## Structure

```
shared/
├── css/
│   ├── base.css          Reset, typography, foundational styles
│   └── components.css    Reusable UI components (status, buttons, checkboxes, search)
├── ts/
│   ├── index.ts          Barrel export
│   ├── status.ts         Status message helpers (setStatus, clearStatus)
│   └── zip.ts            ZIP generation and download utility
└── README.md
```

## CSS Usage

Import shared styles at the top of each plugin's `ui.css`:

```css
@import '../../packages/shared/css/base.css';
@import '../../packages/shared/css/components.css';

/* Plugin-specific styles below */
```

## TypeScript Usage

Import shared utilities in each plugin's `ui.ts`:

```typescript
import { setStatus, clearStatus, downloadZip } from '../../packages/shared/ts';
```

## Future: Design Tokens

When Chopstick design system tokens are available, this package is the integration point. CSS custom properties for colors, fonts, and spacing will be defined in `css/base.css` and consumed by all plugins automatically.
