import test from "node:test";
import assert from "node:assert/strict";
import { startAirdrop, TOKEN, AMOUNT, SELECTOR, claimedData, validateConfig } from "../airdrop.js";

import { setLanguage } from "../i18n.js";

const WALLET = "0x1111111111111111111111111111111111111111";
const FAUCET = "0x2222222222222222222222222222222222222222";
const HASH = "0x" + "ab".repeat(32);
const word = (n) => "0x" + BigInt(n).toString(16).padStart(64, "0");

function fixture(settings = {}) {
  setLanguage("en", { doc: null, win: null });
  const state = { claimed: false, available: 1000000n, balance: 10n ** 18n, chain: "0x1", ...settings };
  const elements = new Map();
  const requests = [];
  const doc = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, {
        disabled: id.endsWith("connect") || id.endsWith("claim"), hidden: true, textContent: "", value: "", children: [],
        addEventListener() {}, append(child) { this.children.push(child); },
      });
      return elements.get(id);
    },
    createElement() { return {}; },
  };
  const provider = {
    on() {}, removeListener() {},
    async request(request) {
      requests.push(request);
      switch (request.method) {
        case "eth_requestAccounts":
          if (state.rejectConnect) throw Object.assign(new Error("rejected"), { code: 4001 });
          return [WALLET];
        case "eth_accounts": return [WALLET];
        case "eth_chainId": return state.chain;
        case "wallet_switchEthereumChain": state.chain = request.params[0].chainId; return null;
        case "eth_estimateGas": return "0x13880";
        case "eth_gasPrice": return "0xbebc200";
        case "eth_getBalance": return "0x" + state.balance.toString(16);
        case "eth_sendTransaction":
          if (state.rejectSend) throw Object.assign(new Error("rejected"), { code: 4001 });
          return HASH;
        default: throw new Error("Unexpected wallet request " + request.method);
      }
    },
  };
  const store = new Map();
  const win = { sessionStorage: { setItem: (k, v) => store.set(k, v), getItem: (k) => store.get(k), removeItem: (k) => store.delete(k) }, ethereum: state.noWallet ? undefined : provider, addEventListener() {}, dispatchEvent() {}, Event: class { constructor(type) { this.type = type; } } };
  async function fetcher(url, options) {
    let result;
    if (url === "airdrop-config.json") return { ok: true, json: async () => ({ chainId: "0x1", token: TOKEN, claimAmount: AMOUNT.toString(), contract: state.unlaunched ? null : FAUCET }) };
    const req = JSON.parse(options.body);
    if (req.method === "eth_getCode") result = state.invalidCode ? "0x" : "0x6080";
    else if (req.method === "eth_getTransactionReceipt") {
      if (state.pendingForever) result = null;
      else if (state.receiptStatus === "0x0") result = { status: "0x0" };
      else { state.claimed = true; result = { status: "0x1" }; }
    } else if (req.method === "eth_call") {
      const data = req.params[0].data;
      if (data === SELECTOR.token) result = "0x" + TOKEN.slice(2).padStart(64, "0");
      else if (data === SELECTOR.amount) result = word(AMOUNT);
      else if (data === SELECTOR.available) result = word(state.available);
      else if (data === claimedData(WALLET)) result = word(state.claimed ? 1 : 0);
      else throw new Error("Unexpected eth_call " + data);
    } else throw new Error("Unexpected RPC " + req.method);
    return { ok: true, json: async () => ({ jsonrpc: "2.0", id: 1, result }) };
  }
  return { state, doc, requests, options: { win, doc, fetcher, pause: async () => {} }, el: (key) => doc.getElementById(`airdrop-${key}`) };
}

test("unlaunched configuration never enables transactions", async () => {
  const f = fixture({ unlaunched: true }); const app = await startAirdrop(f.options);
  await app.connect(); await app.claim();
  assert.equal(f.el("claim").disabled, true);
  assert.equal(f.requests.length, 0);
  assert.match(f.el("status").textContent, /being prepared/);
});
test("invalid contract cannot receive a transaction", async () => {
  const f = fixture({ invalidCode: true }); const app = await startAirdrop(f.options);
  await app.connect(); await app.claim();
  assert.equal(f.requests.length, 0);
  assert.equal(f.el("claim").disabled, true);
});
test("claim sends only zero ETH and the fixed claim call; receipt confirms award", async () => {
  const f = fixture(); const app = await startAirdrop(f.options);
  await app.connect(); assert.equal(f.el("claim").disabled, false);
  assert.match(f.el("fee").textContent, /0.0000160000 ETH/);
  await app.claim();
  const sent = f.requests.filter((r) => r.method === "eth_sendTransaction");
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].params, [{ from: WALLET, to: FAUCET, data: SELECTOR.claim, value: "0x0", chainId: "0x1" }]);
  assert.match(f.el("status").textContent, /Received 0.000001 PIH/);
  assert.equal(f.el("transaction").href, `https://etherscan.io/tx/${HASH}`);
  assert.equal(f.el("claim").disabled, true);
  await app.claim(); assert.equal(f.requests.filter((r) => r.method === "eth_sendTransaction").length, 1);
});
test("a repeat recipient is blocked before signing", async () => {
  const f = fixture({ claimed: true }); const app = await startAirdrop(f.options);
  await app.connect(); await app.claim();
  assert.match(f.el("status").textContent, /already received/);
  assert.equal(f.requests.some((r) => r.method === "eth_sendTransaction"), false);
});
test("the wrong network is switched to Ethereum before enabling claim", async () => {
  const f = fixture({ chain: "0x89" }); const app = await startAirdrop(f.options);
  await app.connect();
  assert.equal(f.state.chain, "0x1");
  assert.equal(f.el("claim").disabled, false);
  assert.ok(f.requests.some((r) => r.method === "wallet_switchEthereumChain"));
});
test("network change before signing blocks the claim", async () => {
  const f = fixture(); const app = await startAirdrop(f.options);
  await app.connect(); f.state.chain = "0x89"; await app.claim();
  assert.equal(f.requests.some((r) => r.method === "eth_sendTransaction"), false);
  assert.equal(f.el("claim").disabled, true);
});
test("insufficient gas and empty reserve disable claim", async () => {
  for (const settings of [{ balance: 0n }, { available: 0n }]) {
    const f = fixture(settings); const app = await startAirdrop(f.options);
    await app.connect(); await app.claim();
    assert.equal(f.el("claim").disabled, true);
    assert.equal(f.requests.some((r) => r.method === "eth_sendTransaction"), false);
  }
});
test("wallet rejection restores controls without sending", async () => {
  const f = fixture({ rejectConnect: true }); const app = await startAirdrop(f.options);
  await app.connect();
  assert.match(f.el("status").textContent, /canceled/);
  assert.equal(f.el("connect").disabled, false);
  assert.equal(f.requests.some((r) => r.method === "eth_sendTransaction"), false);
});
test("failed receipt is never reported as tokens received", async () => {
  const f = fixture({ receiptStatus: "0x0" }); const app = await startAirdrop(f.options);
  await app.connect(); await app.claim();
  assert.match(f.el("status").textContent, /failed/);
  assert.equal(f.state.claimed, false);
});
test("an unconfirmed transaction cannot be sent a second time", async () => {
  const f = fixture({ pendingForever: true }); const app = await startAirdrop(f.options);
  await app.connect(); await app.claim();
  assert.equal(f.el("claim").disabled, true);
  await app.claim();
  assert.equal(f.requests.filter((r) => r.method === "eth_sendTransaction").length, 1);
  assert.match(f.el("status").textContent, /still pending/);
  const reloaded = await startAirdrop(f.options);
  await reloaded.connect(); await reloaded.claim();
  assert.equal(f.el("claim").disabled, true);
  assert.equal(f.requests.filter((r) => r.method === "eth_sendTransaction").length, 1);
});
test("no wallet provides browser-wallet instructions", async () => {
  const f = fixture({ noWallet: true }); await startAirdrop(f.options);
  assert.equal(f.el("connect").disabled, true);
  assert.match(f.el("status").textContent, /wallet browser/);
});
test("config cannot redirect claims to another token or network", () => {
  const base = { chainId: "0x1", token: TOKEN, contract: FAUCET, claimAmount: AMOUNT.toString() };
  for (const changes of [{ chainId: "0x89" }, { token: FAUCET }, { claimAmount: "1" }, { contract: "0x" + "0".repeat(40) }]) {
    assert.throws(() => validateConfig({ ...base, ...changes }));
  }
});
