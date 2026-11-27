import { initLanguage } from "./i18n.js";
import { startAirdrop } from "./airdrop.js?v=philosophy-1";
import { startStats } from "./stats.js";

initLanguage();
startAirdrop().catch(() => { /* The claim controller renders its own failure state. */ });
startStats().catch(() => { /* Statistics remain unavailable instead of showing invented data. */ });
