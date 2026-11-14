# Bundled software

This package redistributes the unmodified Gitea 28.3.0 Windows amd64 binary.

- Project: https://github.com/go-gitea/gitea
- Download and SHA-256: vendor/gitea/manifest.json
- License: MIT; the complete upstream notice is in vendor/gitea/LICENSE.
- The Gitea Authors and The Gogs Authors retain their respective copyrights.

The binary is used as a local service. Its upstream third-party software and
license notices are included in vendor/gitea/THIRD_PARTY_LICENSES.txt and are
also available from the local service at `/assets/licenses.txt`.

The TUI is compiled with babel-preset-solid and imports OpenCode's shared
solid-js and @opentui/solid runtime. Those host modules are not bundled here.
