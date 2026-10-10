import "./polyfills"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "@fontsource/instrument-sans/400.css"
import "@fontsource/instrument-sans/500.css"
import "@fontsource/instrument-sans/600.css"
import "@fontsource/instrument-sans/700.css"
import "@fontsource/ibm-plex-mono/400.css"
import "@fontsource/ibm-plex-mono/500.css"
import "./styles.css"
import App from "./App"

const root = createRoot(document.getElementById("root")!)

// Dev-only: /?reset makes this browser forget its Vault and Swissquote session (for a fresh demo).
if (import.meta.env.DEV && new URLSearchParams(location.search).has("reset")) {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith("swissquote-vault")) localStorage.removeItem(k)
    sessionStorage.clear()
  } catch {
    /* storage blocked: nothing to clear */
  }
  location.replace("/")
}

// Dev-only design preview (sample data, no passkey or blockchain): /?preview=home
if (import.meta.env.DEV && new URLSearchParams(location.search).has("preview")) {
  import("./preview").then(({ Preview }) => root.render(<Preview />))
} else {
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
