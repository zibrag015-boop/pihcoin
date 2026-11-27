import { initLanguage } from "./i18n.js";
import { startAirdrop } from "./airdrop.js?v=philosophy-2";
import { startStats } from "./stats.js?v=philosophy-2";

initLanguage();
startAirdrop().catch(() => { /* The claim controller renders its own failure state. */ });
startStats().catch(() => { /* Statistics remain unavailable instead of showing invented data. */ });
