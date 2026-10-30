import { mkdir } from "node:fs/promises"
import { join } from "node:path"
import type { BrowserContext } from "playwright-core"

export class CamoufoxLease {
  constructor(
    readonly context: BrowserContext,
    readonly release: () => void,
  ) {}
}

class BrowserSlot {
  context?: BrowserContext
  launching?: Promise<BrowserContext>
  activeLeases = 0
  unloadTimer?: ReturnType<typeof setTimeout>
}

/**
 * Implementation detail of the CamoufoxFetcher.
 *
 * Downloads Camoufox in the background as soon as the instance is created (if it is not installed yet),
 * launches it lazily and unloads it again `idleTimeoutSeconds` after its last use.
 * There are two persistent browser profiles, because JavaScript can only be switched off per browser (Firefox pref),
 * not per page: one with JavaScript and one without. Each is launched / unloaded independently.
 * Cookies live in the profile and are therefore shared between requests (e.g. a Cloudflare clearance cookie gets reused).
 */
export class CamoufoxBrowserManager {
  private readonly slots = { js: new BrowserSlot(), noJs: new BrowserSlot() }

  /** Resolves to an Error if the installation failed. Never rejects. */
  private installation: Promise<Error | undefined>

  constructor(
    private readonly dataDir: string,
    private readonly idleTimeoutSeconds: number,
  ) {
    this.installation = this.install()
  }

  /** Returns an Error instead of throwing if Camoufox is not installed or can't be launched. */
  async acquire(javaScriptEnabled: boolean): Promise<CamoufoxLease | Error> {
    const installError = await this.installation

    if (installError) {
      // retry the installation with the next request
      this.installation = this.install()

      return installError
    }

    const slot = javaScriptEnabled ? this.slots.js : this.slots.noJs

    this.cancelUnload(slot)
    slot.activeLeases++

    // library boundary: camoufox / playwright report problems by throwing
    try {
      const context = await this.ensureLaunched(slot, javaScriptEnabled)
      let released = false

      return new CamoufoxLease(context, () => {
        if (released) {
          return
        }

        released = true
        slot.activeLeases--

        if (slot.activeLeases === 0) {
          this.scheduleUnload(slot)
        }
      })
    } catch (error) {
      slot.activeLeases--
      this.scheduleUnload(slot)

      return error instanceof Error ? error : new Error(String(error))
    }
  }

  /** Closes all browsers immediately, e.g. on shutdown. */
  async close(): Promise<void> {
    await Promise.all([this.unload(this.slots.js, true), this.unload(this.slots.noJs, true)])
  }

  private async install(): Promise<Error | undefined> {
    // library boundary: the installer reports problems by throwing
    try {
      const { ensureCamoufoxInstalled } = await import("camoufox-js/dist/pkgman.js")

      await ensureCamoufoxInstalled()

      return undefined
    } catch (error) {
      console.error("Installing Camoufox failed:", error instanceof Error ? error.message : error)

      return error instanceof Error ? error : new Error(String(error))
    }
  }

  private async ensureLaunched(slot: BrowserSlot, javaScriptEnabled: boolean): Promise<BrowserContext> {
    if (slot.context) {
      return slot.context
    }

    if (!slot.launching) {
      slot.launching = this.launch(javaScriptEnabled)
        .then(context => {
          slot.context = context
          context.on("close", () => {
            if (slot.context === context) {
              slot.context = undefined
            }
          })

          return context
        })
        .finally(() => {
          slot.launching = undefined
        })
    }

    return slot.launching
  }

  private async launch(javaScriptEnabled: boolean): Promise<BrowserContext> {
    const userDataDir = join(this.dataDir, javaScriptEnabled ? "js" : "nojs")

    await mkdir(userDataDir, { recursive: true })

    // imported lazily so that the app starts fast
    const { Camoufox } = await import("camoufox-js")

    console.log(`Launching Camoufox (javaScript=${javaScriptEnabled}, profile=${userDataDir})`)

    return Camoufox({
      headless: true,
      user_data_dir: userDataDir,
      ...(javaScriptEnabled ? {} : { firefox_user_prefs: { "javascript.enabled": false } }),
    })
  }

  private cancelUnload(slot: BrowserSlot): void {
    if (slot.unloadTimer) {
      clearTimeout(slot.unloadTimer)
      slot.unloadTimer = undefined
    }
  }

  private scheduleUnload(slot: BrowserSlot): void {
    this.cancelUnload(slot)

    // unref: a pending unload must not keep the process alive
    slot.unloadTimer = setTimeout(() => void this.unload(slot, false), this.idleTimeoutSeconds * 1000)
    slot.unloadTimer.unref()
  }

  private async unload(slot: BrowserSlot, force: boolean): Promise<void> {
    this.cancelUnload(slot)

    if (!force && slot.activeLeases > 0) {
      return
    }

    const context = slot.context ?? (await slot.launching?.catch(() => undefined))

    slot.context = undefined

    if (!context) {
      return
    }

    console.log("Unloading Camoufox")

    await context.close().catch(error => console.warn("Closing Camoufox failed:", error))
  }
}
