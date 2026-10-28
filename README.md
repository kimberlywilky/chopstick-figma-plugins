# Chopstick Figma Plugins

A collection of custom Figma plugins built for the Chopstick design system. These plugins extend Figma's native capabilities to support specific workflows and tooling needs.

Each plugin lives in its own folder under `plugins/` with its own dependencies, build setup, and documentation. Shared styles and utilities live in `packages/shared/`.

## Plugins

| Plugin | Description |
|--------|-------------|
| [token-export](./plugins/token-export/) | Exports Figma variables and text/effect styles as DTCG-compliant JSON, ready for Style Dictionary v4. |


## Shared Package

| Package | Description |
|---------|-------------|
| [shared](./packages/shared/) | Common CSS base styles, UI component styles, and TypeScript utilities (status messages, ZIP downloads). |


## Getting Started

Each plugin is self-contained. Navigate to the plugin folder and follow the instructions in its README.

To install any plugin in Figma:

1. Open Figma Desktop
2. Go to Plugins > Development > Import plugin from manifest
3. Select the `manifest.json` file from the plugin folder


## Repository Structure

```
chopstick-figma-plugins/
├── packages/
│   └── shared/            Shared styles and utilities (see its README)
├── plugins/
│   └── token-export/      Token export plugin (see its README)
├── .gitignore
└── README.md
```


## Contributing

When adding a new plugin:

1. Create a new folder under `plugins/` with its own `package.json`, `manifest.json`, and `src/` directory
2. Import shared styles and utilities from `packages/shared/`
3. Include a `README.md` documenting what the plugin does, how to run it, and any export rules or conventions it follows
4. Add the plugin to the table above
