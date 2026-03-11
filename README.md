# Kairo

**Kairo (回路)** means "circuit" in Japanese — symbolizing a system of connections.

Kairo is a ScriptAPI-based framework for Minecraft Bedrock Edition that **enables communication between multiple behavior packs** by leveraging the `ScriptAPI` as a communication layer.

Kairo is developed using **Node.js** and **TypeScript**, but it can also be used in projects written in plain **JavaScript**.

> Note: JavaScript development lacks proper type inference and editor support compared to TypeScript.

---

Kairoは統合版マインクラフトの`ScriptAPI`を利用して、**複数のビヘイビアーパック間での通信を可能とする**フレームワークです。
Kairoは**Node.js**と**TypeScript**を用いて開発されていますが、通常の**JavaScript**からでも利用可能です。
※JavaScriptでは型補完やエディタの支援が不十分である点にご注意ください。

## Supported Minecraft Script API

Kairo is built using the stable Script API:

- `@minecraft/server` - v2.5.0
- `@minecraft/server-ui` - v2.5.0

## Requirements

- Node.js (for development and TypeScript build)
- pnpm 10.31.0

## Setup && Build

This project bundles scripts with **esbuild** via `build.mjs`.

1. Install dependencies:
    ```bash
    pnpm install
    ```
2. Deploy
    ```bash
    pnpm run build
    ```

## Contributions Welcome!

Feel free to fork this repository and open a pull request.  
Bug fixes, documentation improvements, and feature suggestions are all appreciated!

## Credits

- Concept by: [@ucyuta](https://github.com/ucyuta)
- Development by: [@shizuku86](https://github.com/shizuku86)
