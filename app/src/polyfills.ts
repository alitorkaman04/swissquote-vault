// Some wallet libraries (e.g. @zerodev/webauthn-key) use Node's global `Buffer`.
// Browsers don't have it, so provide the browser implementation before anything else loads.
import { Buffer } from "buffer"

const g = globalThis as unknown as { Buffer?: typeof Buffer }
if (!g.Buffer) g.Buffer = Buffer
