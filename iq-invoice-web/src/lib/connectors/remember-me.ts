/**
 * Best-effort tick of Mercedes' "Remember / keep me signed in" switch —
 * port of MercedesPriceSource._try_enable_remember_me. Extends the SSO
 * session as far as Mercedes allows ("login once, use the app all day").
 * Fails silently on any error: if the site's DOM doesn't expose a match,
 * normal manual login still works exactly as before.
 */
import type { Page } from "playwright-core";

import { MERCEDES_REMEMBER_ME } from "./mercedes-config";

const REMEMBER_ME_SELECTORS = [
  "[id*=remember-me-switch]",
  "[id*=rememberMeSwitch]",
  "input[type=checkbox][id*=emember]",
  "input[type=checkbox][id*=ersistent]",
  "input[type=checkbox][id*=keep]",
  "input[type=checkbox][id*=stay]",
];

export async function tryRememberMe(page: Page): Promise<void> {
  if (!MERCEDES_REMEMBER_ME) return;
  try {
    for (const sel of REMEMBER_ME_SELECTORS) {
      const loc = page.locator(sel).first();
      if (!(await loc.count())) continue;
      try {
        const tag = String(await loc.evaluate((el) => el.tagName)).toLowerCase();
        const ctype = ((await loc.getAttribute("type")) || "").toLowerCase();
        if (tag === "input" && ctype === "checkbox") {
          const checked = await loc.isChecked().catch(() => false);
          if (!checked) {
            await loc
              .check({ force: true, timeout: 3000 })
              .catch(() => undefined);
          }
        } else {
          // A labelled switch/wrapper: click it unless already on.
          try {
            const aria = await loc.getAttribute("aria-checked");
            if (aria && aria.toLowerCase() === "false") {
              await loc.click({ timeout: 3000 }).catch(() => undefined);
              break;
            }
            if (aria === null) {
              await loc.click({ timeout: 3000 }).catch(() => undefined);
              break;
            }
          } catch {
            // Best effort.
          }
        }
      } catch {
        // Best effort.
      }
      break;
    }
  } catch {
    // Never let the convenience tick break the login flow.
  }
}
