---
status: done
assignees: ["fuongz"]
created_at: 2026-08-09 00:00:00Z
priority: high
tags: ["chrome-extension", "settings", "security"]
---

# Review: extension API-key settings

Add a dedicated Chrome extension Options page where the user can save and
remove OpenRouter and Replicate API keys.

**How to review:** flip every `- [ ]` to `- [x]`; write `> notes` below any
item you disagree with. Implementation begins only once all gating boxes are
checked.

## Context

The extension currently has no settings page. It has the `storage` permission
and already uses `chrome.storage.local` for non-syncable cache data. API keys
must be intentionally local: sync storage can propagate them to another signed
in Chrome profile and is not appropriate for credentials.

## Storage and security

- [x] **D1.** Save the two values only in `chrome.storage.local`, under a
      versioned private settings record. Do not put them in `sync`,
      `localStorage`, the manifest, source code, logs, or UI attributes.
      *(Recommended.)*
- [x] **D2.** Use separate optional fields for `OpenRouter API key` and
      `Replicate API key`. Empty values mean the provider is unconfigured.
- [x] **D3.** Mask stored values after a reload; do not return secret text to
      the page merely to prefill its inputs. Show only whether each key has
      been saved, plus a short non-sensitive suffix if available.
- [x] **D4.** Provide an explicit **Remove** action per provider, requiring a
      confirmation before deleting the stored value. *(Recommended.)*

## Page and navigation

- [x] **D5.** Add a Manifest V3 `options_page` and build it as a standalone
      extension page, sharing the existing visual system but not the popup's
      dashboard DOM.
- [x] **D6.** Add a `Settings` action to the popup app bar that opens the
      browser's Options page in its normal tab.
- [x] **D7.** The form uses password inputs, provider documentation links, a
      clear saved/error status, and a primary Save button. It must be usable
      with keyboard navigation and a screen reader.

## Verification

- [x] **D8.** Add deterministic checks that saving writes only to local
      storage, re-opening does not expose the full key, and removal clears the
      provider value after confirmation.
- [x] **D9.** Run workspace typecheck and production build; manually open the
      unpacked extension Options page and verify save, reload, and removal for
      both providers.

## Out of scope

- Calling OpenRouter or Replicate, adding AI features, or sending a key to any
  server.
- Encrypting keys beyond Chrome's profile storage protections.
- Syncing, exporting, importing, or sharing keys across browser profiles.
- Changing existing tool settings or the extension's appearance behavior.

## Files touched

| File | Change |
| --- | --- |
| `apps/chrome-extension/extension/manifest.json` | Register the Options page. |
| `apps/chrome-extension/src/common/api-keys.ts` | New local-only key storage API. |
| `apps/chrome-extension/src/options/*` | New settings page markup, behavior, and styles. |
| `apps/chrome-extension/src/popup/*` | Add the Settings entry point. |
| `apps/chrome-extension/package.json` | Build the Options page assets. |
| `apps/chrome-extension/scripts/preview-*.ts` | Add or extend deterministic UI/storage checks. |
| `README.md` | Document settings and the security boundary. |
