import test from "node:test";
import assert from "node:assert/strict";
import { AIRDROP, CLAIM_TOPIC, createStatsReader, formatPih, summarizeClaims, startStats } from "../stats.js";
import { AMOUNT, TOKEN, SELECTOR } from "../airdrop.js";
import { setLanguage } from "../i18n.js";

const word = (n) => "0x" + BigInt(n).toString(16).padStart(64, "0");
const config = { chainId: "0x1", contract: AIRDROP, token: TOKEN, deploymentBlock: 10 };
function claim(recipient = "11", amount = AMOUNT, block = 12, transaction = "aa") {
  return { address: AIRDROP, topics: [CLAIM_TOPIC, "0x" + recipient.repeat(20).padStart(64, "0")], data: word(amount), blockNumber: "0x" + block.toString(16), transactionHash: "0x" + transaction.repeat(32), logIndex: "0x0", removed: false };
}
function chainFixture() {
  const state = { head: 22, logs: [claim()], balance: 9n * AMOUNT, blockHash: "0x" + "bb".repeat(32), fail: false, failOnce: false, mismatch: false, requests: [] };
  async function fetcher(url, options) {
    if (url === "airdrop-config.json") return { ok: true, json: async () => config };
    const req = JSON.parse(options.body); state.requests.push({ url, ...req });
    if (state.fail || (state.failOnce && !state.failedOnce)) { state.failedOnce = true; throw new Error("Offline"); }
    let result;
    switch (req.method) {
      case "eth_chainId": result = "0x1"; break;
      case "eth_getBlockByNumber": result = { number: req.params[0] === "latest" ? "0x" + state.head.toString(16) : req.params[0], hash: state.blockHash }; break;
      case "eth_getLogs": result = state.logs.filter((log) => BigInt(log.blockNumber) >= BigInt(req.params[0].fromBlock) && BigInt(log.blockNumber) <= BigInt(req.params[0].toBlock)); break;
      case "eth_call": {
        const data = req.params[0].data;
        if (data.startsWith("0x70a08231")) result = word(state.balance);
        else if (data === SELECTOR.available) result = word(state.balance / AMOUNT + (state.mismatch ? 1n : 0n));
        else if (data === SELECTOR.amount) result = word(AMOUNT);
        else if (data === SELECTOR.token) result = "0x" + TOKEN.slice(2).padStart(64, "0");
        else throw new Error("Unexpected call");
        break;
      }
      default: throw new Error("Unexpected method");
    }
    return { ok: true, json: async () => ({ jsonrpc: "2.0", id: 1, result }) };
  }
  return { state, fetcher };
}

test("PIH formatting retains exact tiny amounts without floating point", () => {
  assert.equal(formatPih(1n, "en-US"), "0.000000000000000001");
  assert.equal(formatPih(AMOUNT, "ru-RU"), "0,000001");
  assert.equal(formatPih(10n ** 18n, "en-US"), "1");
});
test("count successful addresses and amounts, deduplicating RPC log duplicates", () => {
  const a = claim(), b = claim("22", AMOUNT, 13, "cc");
  assert.deepEqual(summarizeClaims([a, a, b], AIRDROP, 10, 20), { claimed: 2, distributed: 2n * AMOUNT });
  assert.deepEqual(summarizeClaims([{ ...a, removed: true }], AIRDROP, 10, 20), { claimed: 0, distributed: 0n });
});
test("reject foreign, malformed, out-of-range, or inconsistent claim events", () => {
  for (const change of [{ address: TOKEN }, { data: word(AMOUNT + 1n) }, { blockNumber: "0x1" }, { transactionHash: "not a hash" }, { topics: [] }]) {
    assert.throws(() => summarizeClaims([{ ...claim(), ...change }], AIRDROP, 10, 20));
  }
  assert.throws(() => summarizeClaims([claim(), claim("11", AMOUNT, 13, "cc")], AIRDROP, 10, 20));
});
test("withdrawals and top-ups cannot fabricate claimed wallets; all calls share a block", async () => {
  const f = chainFixture(), load = createStatsReader(f.fetcher);
  const before = await load(config);
  f.state.balance = 4n * AMOUNT;
  const after = await load(config);
  assert.equal(before.claimed, 1); assert.equal(after.claimed, 1);
  assert.equal(after.distributed, AMOUNT); assert.equal(after.available, 4n); assert.equal(after.remaining, 4n * AMOUNT);
  assert.ok(f.state.requests.filter((r) => r.method === "eth_call").every((r) => r.params[1] === "0x14"));
  assert.ok(f.state.requests.filter((r) => r.method === "eth_getLogs").every((r) => r.params[0].topics[0] === CLAIM_TOPIC));
});
test("a transient RPC failure restarts a whole verified snapshot", async () => {
  const f = chainFixture(); f.state.failOnce = true;
  const result = await createStatsReader(f.fetcher)(config);
  assert.equal(result.claimed, 1); assert.match(result.endpoint, /publicnode/);
});
test("a reorg invalidates cached claims instead of accumulating phantom claims", async () => {
  const f = chainFixture(), load = createStatsReader(f.fetcher);
  assert.equal((await load(config)).claimed, 1);
  f.state.blockHash = "0x" + "dd".repeat(32); f.state.logs = [];
  assert.equal((await load(config)).claimed, 0);
});
test("matching block anchors allow incremental scans", async () => {
  const f = chainFixture(), load = createStatsReader(f.fetcher);
  await load(config);
  f.state.head = 24; f.state.logs.push(claim("22", AMOUNT, 21, "cc"));
  const result = await load(config);
  assert.equal(result.claimed, 2);
  const ranges = f.state.requests.filter((r) => r.method === "eth_getLogs");
  assert.equal(ranges[1].params[0].fromBlock, "0x15");
});
test("unavailable or mismatching RPC data never becomes a fabricated zero snapshot", async () => {
  const f = chainFixture(); f.state.fail = true;
  await assert.rejects(createStatsReader(f.fetcher)(config));
  f.state.fail = false; f.state.mismatch = true;
  await assert.rejects(createStatsReader(f.fetcher)(config));
});
test("a failed refresh retains the prior snapshot with an explicit stale label", async () => {
  setLanguage("en", { doc: null, win: null });
  const f = chainFixture(); const elements = new Map();
  const doc = { visibilityState: "visible", getElementById(id) { if (!elements.has(id)) elements.set(id, { textContent: "—", addEventListener() {} }); return elements.get(id); } };
  const win = { addEventListener() {}, setInterval() { return 1; }, clearInterval() {} };
  const view = await startStats({ win, doc, fetcher: f.fetcher });
  const before = doc.getElementById("stats-claimed").textContent;
  f.state.fail = true; await view.update();
  assert.equal(doc.getElementById("stats-claimed").textContent, before);
  assert.match(doc.getElementById("stats-status").textContent, /last verified snapshot/);
});
