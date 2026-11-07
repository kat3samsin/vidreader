# ChatGPT sign-in DevKit

`siwc-local-0.1.0.tgz` is the unmodified `@siwc/local` package built from OpenAI's [sign-in-with-chatgpt-devkit](https://github.com/openai/sign-in-with-chatgpt-devkit) at commit `0a36fefeb913055c8c7a1a29b63d82b96b2e841a`.

The package is not published on npm. VidReader keeps a pinned archive so `npm ci` can install it without a separate source checkout. Its compiled code, source maps, license, dependency inventory, and third-party notices are included in the archive. npm's lockfile records its integrity.

Build the upstream package with `npm install --ignore-scripts --workspace @siwc/local --include-workspace-root`, `npm run build --workspace @siwc/local`, and `npm pack --workspace @siwc/local`.

The DevKit is distributed under the [Sign-in with ChatGPT DevKit Noncommercial License](CHATGPT-DEVKIT-LICENSE). It permits personal noncommercial use. Commercial use requires a separate agreement with OpenAI. VidReader's independently authored code is separate from the unmodified DevKit.
